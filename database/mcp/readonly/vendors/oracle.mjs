// Oracle (node-oracledb Thin mode: no Instant Client). Oracle has no read-only session, so every call
// runs inside SET TRANSACTION READ ONLY and ends with a rollback. callTimeout bounds each round trip.
// Oracle reports no source column for a result field, so personal data is matched by column name and
// select-list expression (see piiColumns in sql.mjs); `*` keeps the source names.
// A function with an autonomous transaction can still write from a SELECT: the account's privileges
// are the last line, as on every vendor.
import oracledb from 'oracledb';
import { piiMatcher } from '../config.mjs';
import { DIALECTS, checkStatement, shape, TABLE_NAME } from './sql.mjs';

const dialect = DIALECTS.oracle;

const RULES = {
  first: new Set(['SELECT', 'WITH']),
  dmlChecked: new Set(['WITH']),
  dml: [
    [/\bINSERT\b/, 'INSERT'],
    [/\bUPDATE\b/, 'UPDATE'],
    [/\bDELETE\b/, 'DELETE'],
    [/\bMERGE\b/, 'MERGE'],
  ],
  forbidden: [
    [/^WITH\s+(FUNCTION|PROCEDURE)\b/, 'WITH FUNCTION (inline PL/SQL)'],
    [/\bINTO\b/, 'INTO'],
    [/\bFOR\s+UPDATE\b/, 'FOR UPDATE'],
    [/\.\s*NEXTVAL\b/, 'sequence NEXTVAL'],
  ],
  // Checked with string contents included: DBMS_XMLGEN.GETXML('…') runs SQL given as text.
  forbiddenAnywhere: [
    [/\bDBMS_(?!LOB\b|RANDOM\b)\w+/, 'DBMS_ packages (other than DBMS_LOB, DBMS_RANDOM)'],
    [/\bUTL_(?!RAW\b)\w+/, 'UTL_ packages (other than UTL_RAW)'],
    [/\bHTTPURITYPE\b/, 'HTTPURITYPE'],
  ],
};

export const checkQuery = (sql) => checkStatement(sql, dialect, RULES);

// Large numbers stay exact (strings past 2^53); LOBs come back as text or bytes; dates as Date.
const fetchTypeHandler = (m) => {
  if (m.dbType === oracledb.DB_TYPE_NUMBER)
    return { type: oracledb.STRING, converter: (v) => (v !== null && Number.isSafeInteger(Number(v)) && String(Number(v)) === v ? Number(v) : v) };
  if (m.dbType === oracledb.DB_TYPE_CLOB || m.dbType === oracledb.DB_TYPE_NCLOB) return { type: oracledb.STRING };
  if (m.dbType === oracledb.DB_TYPE_BLOB) return { type: oracledb.BUFFER };
  return undefined;
};

export default function createOracle(cfg) {
  const isPii = piiMatcher(cfg.pii);
  let poolP = null;
  const pool = () =>
    (poolP ??= oracledb.createPool({
      user: cfg.user,
      password: cfg.password,
      connectString: `${cfg.host}:${cfg.port}/${cfg.database}`,
      poolMin: 0,
      poolMax: 4,
      poolIncrement: 1,
    }));

  // fn(conn) runs inside a read-only transaction; the transaction always ends with a rollback.
  async function readOnly(fn) {
    const conn = await (await pool()).getConnection();
    conn.callTimeout = Number(cfg.maxExecutionMs);
    let drop = false;
    try {
      await conn.execute('SET TRANSACTION READ ONLY');
      return await fn(conn);
    } catch (e) {
      drop = !e.errorNum; // a timeout or network error leaves the connection unusable
      throw e;
    } finally {
      await conn.rollback().catch(() => (drop = true));
      await conn.close({ drop }).catch(() => {});
    }
  }

  // Runs sql WITHOUT the statement check (callers check first). Reads maxRows + 1 to tell truncation.
  async function execute(sql, { maxRows = cfg.maxRows } = {}) {
    return readOnly(async (conn) => {
      const started = process.hrtime.bigint();
      const r = await conn.execute(sql, [], { resultSet: true, outFormat: oracledb.OUT_FORMAT_OBJECT, fetchTypeHandler });
      if (!r.resultSet) return { columns: [], rows: [], rowCount: 0, truncated: false, elapsedMs: 0, result: { affectedRows: r.rowsAffected ?? 0 } };
      const rows = await r.resultSet.getRows(Math.min(maxRows + 1, 2 ** 31 - 1));
      await r.resultSet.close();
      const truncated = rows.length > maxRows;
      if (truncated) rows.length = maxRows;
      const fields = r.metaData.map((m) => ({ name: m.name, orgName: '' }));
      return shape({ fields, rows, truncated, started, sql, isPii, dialect });
    });
  }

  async function listTables() {
    return execute(
      'SELECT o.object_name AS "name", CASE o.object_type WHEN \'TABLE\' THEN \'BASE TABLE\' ELSE o.object_type END AS "type", ' +
        't.num_rows AS "approx_rows", c.comments AS "comment" FROM all_objects o ' +
        'LEFT JOIN all_tables t ON t.owner = o.owner AND t.table_name = o.object_name ' +
        'LEFT JOIN all_tab_comments c ON c.owner = o.owner AND c.table_name = o.object_name ' +
        "WHERE o.owner = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AND o.object_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW') ORDER BY 1",
      { maxRows: Number.MAX_SAFE_INTEGER },
    );
  }

  // table: matched as given, then upper-cased (unquoted Oracle names are stored upper case).
  async function describeTable(table) {
    if (typeof table !== 'string' || !TABLE_NAME.test(table) || table.includes('.')) {
      throw new Error('invalid table name (allowed: letters, digits, _ and $, up to 64 chars)');
    }
    return readOnly(async (conn) => {
      const r = await conn.execute(
        'SELECT c.column_name AS "name", c.data_type || CASE ' +
          "WHEN c.data_type IN ('VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR', 'RAW') THEN '(' || c.char_length || ')' " +
          "WHEN c.data_type = 'NUMBER' AND c.data_precision IS NOT NULL THEN '(' || c.data_precision || ',' || c.data_scale || ')' END AS \"type\", " +
          "CASE c.nullable WHEN 'Y' THEN 'YES' ELSE 'NO' END AS \"nullable\", " +
          "(SELECT 'PRI' FROM all_constraints k JOIN all_cons_columns kc ON kc.owner = k.owner AND kc.constraint_name = k.constraint_name " +
          "WHERE k.owner = c.owner AND k.table_name = c.table_name AND k.constraint_type = 'P' AND kc.column_name = c.column_name AND ROWNUM = 1) AS \"key\", " +
          'cm.comments AS "comment" FROM all_tab_columns c ' +
          'LEFT JOIN all_col_comments cm ON cm.owner = c.owner AND cm.table_name = c.table_name AND cm.column_name = c.column_name ' +
          "WHERE c.owner = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AND c.table_name = " +
          '(SELECT MIN(table_name) KEEP (DENSE_RANK FIRST ORDER BY CASE WHEN table_name = :t THEN 0 ELSE 1 END) FROM all_tab_columns ' +
          "WHERE owner = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AND table_name IN (:t, UPPER(:t))) ORDER BY c.column_id",
        { t: table },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      if (!r.rows.length) throw new Error(`table not found: ${table}`);
      return { table, columns: r.rows };
    });
  }

  const close = async () => {
    if (poolP) await (await poolP).close(0).catch(() => {});
  };

  const ping = () => execute('SELECT 1 AS "ok" FROM dual');

  return { check: checkQuery, execute, ping, listTables, describeTable, close, _readOnly: readOnly };
}
