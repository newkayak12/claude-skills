// PostgreSQL: every connection starts with default_transaction_read_only=on and statement_timeout
// (startup options, verified before first use), so each autocommit statement runs in a read-only
// transaction. Statements run through a cursor (extended protocol: one statement only), which also
// stops at the row cap. Personal-data columns are matched by their source column (pg_attribute).
import pg from 'pg';
import Cursor from 'pg-cursor';
import { piiMatcher } from '../config.mjs';
import { DIALECTS, checkStatement, shape, TABLE_NAME } from './sql.mjs';

const dialect = DIALECTS.postgres;

const RULES = {
  first: new Set(['SELECT', 'WITH', 'EXPLAIN', 'SHOW', 'TABLE', 'VALUES']),
  dmlChecked: new Set(['WITH', 'EXPLAIN']),
  dml: [
    [/\bINSERT\b/, 'INSERT'],
    [/\bUPDATE\b/, 'UPDATE'],
    [/\bDELETE\b/, 'DELETE'],
    [/\bMERGE\b/, 'MERGE'],
  ],
  forbidden: [
    [/\bINTO\b/, 'INTO (SELECT INTO creates a table)'],
    [/\bFOR\s+(NO\s+KEY\s+)?UPDATE\b/, 'FOR UPDATE'],
    [/\bFOR\s+(KEY\s+)?SHARE\b/, 'FOR SHARE'],
  ],
  // Checked with string contents included: query_to_xml('…') and dblink run SQL given as text.
  // A read-only transaction stops writes, not these.
  forbiddenAnywhere: [
    [/\bPG_SLEEP\w*/, 'pg_sleep'],
    [/\bPG_(READ_\w+|LS_\w+|STAT_FILE|FILE_\w+)\b/, 'server file access'],
    [/\bLO_(IMPORT|EXPORT|UNLINK|CREATE|CREAT|OPEN|PUT|WRITE|TRUNCATE\w*|FROM_BYTEA)\b/, 'large object functions'],
    [/\bDBLINK\w*/, 'dblink'],
    [/\bPG_(TRY_)?ADVISORY\w*/, 'advisory locks'],
    [/\bSET_CONFIG\b/, 'set_config'],
    [/\b(NEXTVAL|SETVAL)\b/, 'sequence changes'],
    [/\bPG_(TERMINATE|CANCEL)_BACKEND\b/, 'backend signals'],
    [/\bPG_(RELOAD_CONF|ROTATE_LOGFILE|SWITCH_WAL|PROMOTE|NOTIFY|LOGICAL_EMIT_MESSAGE|STAT_RESET\w*|CREATE_\w+|DROP_\w+|REPLICATION_\w+|BACKUP_\w+|WAL_REPLAY_\w+|COPY_\w+)\b/, 'server administration functions'],
    [/\b(QUERY|CURSOR|TABLE|SCHEMA|DATABASE)_TO_XML\w*/, 'functions that run SQL text'],
  ],
};

export const checkQuery = (sql) => checkStatement(sql, dialect, RULES);

// Dates and times stay strings, as the MySQL vendor returns them.
const RAW = new Set([1082, 1083, 1114, 1184, 1266]);
const types = { getTypeParser: (oid, format) => (RAW.has(oid) ? (v) => v : pg.types.getTypeParser(oid, format)) };

export default function createPostgres(cfg) {
  const isPii = piiMatcher(cfg.pii);
  const pool = new pg.Pool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    max: 4,
    types,
    options: `-c default_transaction_read_only=on -c statement_timeout=${Number(cfg.maxExecutionMs)}`,
  });
  pool.on('error', () => {}); // an idle client's error; the next checkout reports its own
  const ready = new WeakSet();
  const names = new Map(); // "tableOid.attnum" -> column name

  async function getConn() {
    const client = await pool.connect();
    if (ready.has(client)) return client;
    try {
      const { rows } = await client.query('SHOW transaction_read_only');
      if (rows[0]?.transaction_read_only !== 'on') throw new Error('session read-only mode did not take effect');
      ready.add(client);
      return client;
    } catch (e) {
      client.release(true);
      throw e;
    }
  }

  // Source column names for result fields, looked up once per table.
  async function sourceNames(client, fields) {
    const missing = [...new Set(fields.filter((f) => f.tableID && !names.has(`${f.tableID}.${f.columnID}`)).map((f) => f.tableID))];
    if (missing.length) {
      const { rows } = await client.query(
        'SELECT attrelid::int8::text AS t, attnum::int AS c, attname AS n FROM pg_catalog.pg_attribute WHERE attrelid = ANY($1::oid[]) AND attnum > 0',
        [missing],
      );
      for (const r of rows) names.set(`${r.t}.${r.c}`, r.n);
    }
    return fields.map((f) => ({ name: f.name, orgName: f.tableID ? names.get(`${f.tableID}.${f.columnID}`) ?? '' : '' }));
  }

  // Runs sql WITHOUT the statement check (callers check first). Reads maxRows + 1 to tell truncation.
  async function execute(sql, { maxRows = cfg.maxRows } = {}) {
    const client = await getConn();
    const started = process.hrtime.bigint();
    let broken = false;
    try {
      const cursor = client.query(new Cursor(sql));
      const limit = Math.min(maxRows + 1, 2 ** 31 - 1);
      const { rows, result } = await new Promise((res, rej) => cursor.read(limit, (e, rows, result) => (e ? rej(e) : res({ rows, result }))));
      await new Promise((res) => cursor.close(() => res()));
      const truncated = rows.length > maxRows;
      if (truncated) rows.length = maxRows;
      const fields = result.fields?.length ? await sourceNames(client, result.fields) : undefined;
      return shape({ fields, rows, truncated, started, sql, isPii, dialect });
    } catch (e) {
      broken = !e.code; // a protocol or network error leaves the connection unusable
      throw e;
    } finally {
      client.release(broken);
    }
  }

  async function listTables() {
    return execute(
      "SELECT n.nspname AS schema, c.relname AS name, CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' " +
        "WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'BASE TABLE' END AS type, c.reltuples::int8 AS approx_rows, " +
        "obj_description(c.oid, 'pg_class') AS comment FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
        "WHERE n.nspname = ANY (current_schemas(false)) AND c.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY 1, 2",
      { maxRows: Number.MAX_SAFE_INTEGER },
    );
  }

  // table: name or schema.name, matched exactly (quote_ident), searched on the search_path when unqualified.
  async function describeTable(table) {
    if (typeof table !== 'string' || !TABLE_NAME.test(table)) {
      throw new Error('invalid table name (letters, digits, _ and $, up to 64 chars; schema.table allowed)');
    }
    const [a, b] = table.split('.');
    const client = await getConn();
    try {
      const { rows } = await client.query(
        "SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS nullable, " +
          "(SELECT 'PRI' FROM pg_catalog.pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY (i.indkey) LIMIT 1) AS key, " +
          'pg_get_expr(d.adbin, d.adrelid) AS "default", col_description(a.attrelid, a.attnum) AS comment ' +
          'FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum ' +
          "WHERE a.attrelid = to_regclass(CASE WHEN $2::text IS NULL THEN quote_ident($1) ELSE quote_ident($1) || '.' || quote_ident($2) END) " +
          'AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum',
        [a, b ?? null],
      );
      if (!rows.length) throw new Error(`table not found: ${table}`);
      return { table, columns: rows };
    } finally {
      client.release();
    }
  }

  const close = () => pool.end();

  const ping = () => execute('SELECT 1 AS ok');

  return { check: checkQuery, execute, ping, listTables, describeTable, close, _getConn: getConn };
}
