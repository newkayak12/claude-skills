// MySQL and MariaDB: statement check, pool with a per-connection read-only session, streaming row cap.
// No explicit transactions anywhere: statements run under autocommit, and the session's default
// access mode (SET SESSION TRANSACTION READ ONLY) makes each implicit transaction read-only.
import mysql from 'mysql2';
import { piiMatcher } from '../config.mjs';
import { DIALECTS, checkStatement, piiColumns as piiColumnsFor, selectList as selectListFor, shape, TABLE_NAME } from './sql.mjs';

const dialect = DIALECTS.mysql;

const RULES = {
  first: new Set(['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH']),
  // Statements that can wrap DML: WITH ... DELETE (MySQL 8), EXPLAIN ANALYZE UPDATE/DELETE (executes it).
  dmlChecked: new Set(['WITH', 'EXPLAIN', 'DESCRIBE', 'DESC']),
  // INSERT(...) and REPLACE(...) are also string functions, so the function-call form is allowed.
  dml: [
    [/\bINSERT\b(?!\s*\()/, 'INSERT'],
    [/\bUPDATE\b/, 'UPDATE'],
    [/\bDELETE\b/, 'DELETE'],
    [/\bREPLACE\b(?!\s*\()/, 'REPLACE'],
  ],
  forbidden: [
    [/\bINTO\s+OUTFILE\b/, 'INTO OUTFILE'],
    [/\bINTO\s+DUMPFILE\b/, 'INTO DUMPFILE'],
    [/\bINTO\b/, 'INTO (SELECT ... INTO variables)'],
    [/\bFOR\s+UPDATE\b/, 'FOR UPDATE'],
    [/\bFOR\s+SHARE\b/, 'FOR SHARE'],
    [/\bLOCK\s+IN\s+SHARE\s+MODE\b/, 'LOCK IN SHARE MODE'],
    [/\bGET_LOCK\b/, 'GET_LOCK'],
    [/\bSLEEP\b/, 'SLEEP'],
    [/\bBENCHMARK\b/, 'BENCHMARK'],
    [/\bLOAD_FILE\b/, 'LOAD_FILE'],
  ],
};

// Returns { ok: true, sql } with the statement to execute, or { ok: false, rule, message }.
export const checkQuery = (sql) => checkStatement(sql, dialect, RULES);
export const selectList = (sql) => selectListFor(sql, dialect);
export const piiColumns = (fields, sql, isPii = piiMatcher()) => piiColumnsFor(fields, sql, isPii, dialect);

// flavor 'mariadb': the timeout variable is max_statement_time (seconds) instead of max_execution_time (ms).
export function createMysql(cfg, flavor = 'mysql') {
  const isPii = piiMatcher(cfg.pii);
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    multipleStatements: false,
    connectionLimit: 4,
    supportBigNumbers: true, // BIGINT/DECIMAL as numbers when safe, strings when beyond 2^53
    dateStrings: true,
  });
  const ready = new WeakSet();
  // A connection destroyed at the row cap may still emit 'error'; queries report through callbacks.
  pool.on('connection', (c) => c.on('error', () => {}));

  const q = (conn, sql, values) =>
    new Promise((res, rej) => conn.query(sql, values, (err, rows) => (err ? rej(err) : res(rows))));

  const timeout =
    flavor === 'mariadb'
      ? `SET SESSION max_statement_time = ${Number(cfg.maxExecutionMs) / 1000}`
      : `SET SESSION max_execution_time = ${Number(cfg.maxExecutionMs)}`;

  // Every connection gets the read-only session before its first user statement, and we verify it.
  async function getConn() {
    const conn = await new Promise((res, rej) => pool.getConnection((err, c) => (err ? rej(err) : res(c))));
    if (ready.has(conn)) return conn;
    try {
      await q(conn, 'SET SESSION TRANSACTION READ ONLY');
      await q(conn, timeout);
      // MySQL and MariaDB 11.1+ name it transaction_read_only, older MariaDB tx_read_only.
      const vars = await q(conn, "SHOW SESSION VARIABLES WHERE Variable_name IN ('transaction_read_only', 'tx_read_only')");
      if (!vars.length || !vars.every((v) => v.Value === 'ON')) throw new Error('session read-only mode did not take effect');
      ready.add(conn);
      return conn;
    } catch (e) {
      conn.destroy();
      throw e;
    }
  }

  // Runs sql WITHOUT the statement check (callers check first). Streams rows, stops at maxRows.
  async function execute(sql, { maxRows = cfg.maxRows } = {}) {
    const conn = await getConn();
    const started = process.hrtime.bigint();
    return new Promise((resolve, reject) => {
      const rows = [];
      let fields;
      let truncated = false;
      let header = null;
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        if (err) {
          conn.release();
          return reject(err);
        }
        if (truncated) conn.destroy();
        else conn.release();
        const out = shape({ fields, rows: header && !fields ? [] : rows, truncated, started, sql, isPii, dialect });
        resolve(header && !fields ? { ...out, result: header } : out);
      };
      const query = conn.query(sql);
      query.on('fields', (f) => (fields = f));
      query.on('result', (row) => {
        if (done) return;
        if (row && row.constructor && row.constructor.name === 'ResultSetHeader') {
          header = { affectedRows: row.affectedRows };
          return;
        }
        if (rows.length >= maxRows) {
          truncated = true;
          conn.pause();
          return finish();
        }
        rows.push(row);
      });
      query.on('error', (e) => finish(e));
      query.on('end', () => finish());
    });
  }

  async function listTables() {
    return execute(
      'SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS approx_rows, TABLE_COMMENT AS comment ' +
        'FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME',
      { maxRows: Number.MAX_SAFE_INTEGER },
    );
  }

  async function describeTable(table) {
    if (typeof table !== 'string' || !TABLE_NAME.test(table) || table.includes('.')) {
      throw new Error('invalid table name (allowed: letters, digits, _ and $, up to 64 chars)');
    }
    const conn = await getConn();
    try {
      const rows = await q(
        conn,
        'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_KEY AS `key`, ' +
          'COLUMN_DEFAULT AS `default`, EXTRA AS extra, COLUMN_COMMENT AS comment ' +
          'FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
        [table],
      );
      if (!rows.length) throw new Error(`table not found: ${table}`);
      return { table, columns: rows };
    } finally {
      conn.release();
    }
  }

  const close = () => new Promise((res) => pool.end(() => res()));

  const ping = () => execute('SELECT 1 AS ok');

  return { check: checkQuery, execute, ping, listTables, describeTable, close, _getConn: getConn };
}

export default createMysql;
