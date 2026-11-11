// MySQL vendor: statement check, pool with a per-connection read-only session, streaming row cap.
// No explicit transactions anywhere: statements run under autocommit, and the session's default
// access mode (SET SESSION TRANSACTION READ ONLY) makes each implicit transaction read-only.
import mysql from 'mysql2';

const ALLOWED_FIRST = new Set(['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH']);

const FORBIDDEN = [
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
];

// Data-changing statement keywords. INSERT(...) and REPLACE(...) are also string functions, so the
// function-call form is allowed. Checked for statements that can wrap DML: WITH ... DELETE (MySQL 8),
// EXPLAIN ANALYZE UPDATE/DELETE (executes the statement).
const DML = [
  [/\bINSERT\b(?!\s*\()/, 'INSERT'],
  [/\bUPDATE\b/, 'UPDATE'],
  [/\bDELETE\b/, 'DELETE'],
  [/\bREPLACE\b(?!\s*\()/, 'REPLACE'],
];
const DML_CHECKED = new Set(['WITH', 'EXPLAIN', 'DESCRIBE', 'DESC']);

// One pass over the text. Returns
//   clean:  comments replaced by a space, string literals intact (this is what gets executed)
//   masked: same, with string/identifier literal contents blanked (this is what gets inspected)
// or { error }.
export function scan(sql) {
  let clean = '';
  let masked = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '/' && next === '*') {
      const third = sql[i + 2];
      if (third === '!') return { error: 'executable comment /*! ... */ is not allowed (MySQL runs its content)' };
      if (third === '+') return { error: 'optimizer hint /*+ ... */ is not allowed (can change session settings)' };
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) return { error: 'unterminated /* comment' };
      clean += ' ';
      masked += ' ';
      i = end + 2;
    } else if (c === '#' || (c === '-' && next === '-' && (i + 2 >= n || /[\s]/.test(sql[i + 2])))) {
      const end = sql.indexOf('\n', i);
      clean += ' ';
      masked += ' ';
      i = end < 0 ? n : end + 1;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      for (;;) {
        if (j >= n) return { error: `unterminated ${c} literal` };
        if (sql[j] === '\\' && c !== '`') {
          j += 2;
          continue;
        }
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      clean += sql.slice(i, j + 1);
      masked += c + c;
      i = j + 1;
    } else {
      clean += c;
      masked += c;
      i++;
    }
  }
  return { clean: clean.trim(), masked: masked.trim() };
}

// Returns { ok: true, sql } with the statement to execute, or { ok: false, rule, message }.
export function checkQuery(sql) {
  if (typeof sql !== 'string') return reject('input', 'sql must be a string');
  const s = scan(sql);
  if (s.error) return reject('comment/literal', s.error);
  let { clean, masked } = s;
  if (masked.endsWith(';')) {
    masked = masked.slice(0, -1).trim();
    clean = clean.replace(/;\s*$/, '').trim();
  }
  if (!masked) return reject('empty', 'empty statement');
  if (masked.includes(';')) return reject('single-statement', 'only one statement is allowed (found ; inside)');
  const upper = masked.toUpperCase();
  const first = (upper.match(/^[A-Z]+/) || [''])[0];
  if (!ALLOWED_FIRST.has(first)) {
    return reject('whitelist', `first keyword "${first || masked.slice(0, 10)}" is not allowed; allowed: ${[...ALLOWED_FIRST].join(', ')}`);
  }
  if (DML_CHECKED.has(first)) {
    for (const [re, name] of DML) {
      if (re.test(upper)) return reject('dml', `${name} inside ${first} is not allowed`);
    }
  }
  for (const [re, name] of FORBIDDEN) {
    if (re.test(upper)) return reject('forbidden', `${name} is not allowed`);
  }
  return { ok: true, sql: clean };
}

function reject(rule, message) {
  return { ok: false, rule, message };
}

export function createMysql(cfg) {
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

  // Every connection gets the read-only session before its first user statement, and we verify it.
  async function getConn() {
    const conn = await new Promise((res, rej) => pool.getConnection((err, c) => (err ? rej(err) : res(c))));
    if (ready.has(conn)) return conn;
    try {
      await q(conn, 'SET SESSION TRANSACTION READ ONLY');
      await q(conn, `SET SESSION max_execution_time = ${Number(cfg.maxExecutionMs)}`);
      const [row] = await q(conn, 'SELECT @@session.transaction_read_only AS ro');
      if (Number(row.ro) !== 1) throw new Error('session read-only mode did not take effect');
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
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
        if (err) {
          conn.release();
          return reject(err);
        }
        if (truncated) conn.destroy();
        else conn.release();
        resolve({
          columns: fields ? fields.map((f) => f.name) : [],
          rows: header && !fields ? [] : rows,
          rowCount: rows.length,
          truncated,
          elapsedMs: Math.round(elapsedMs * 10) / 10,
          ...(header && !fields ? { result: header } : {}),
        });
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
    if (typeof table !== 'string' || !/^[A-Za-z0-9_$]{1,64}$/.test(table)) {
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

  return { check: checkQuery, execute, listTables, describeTable, close, _getConn: getConn };
}

export default createMysql;
