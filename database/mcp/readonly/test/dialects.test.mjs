import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkQuery as pg } from '../vendors/postgres.mjs';
import { checkQuery as ora } from '../vendors/oracle.mjs';
import { checkQuery as maria } from '../vendors/mariadb.mjs';
import { DIALECTS, scan, piiColumns, selectList } from '../vendors/sql.mjs';
import { piiMatcher } from '../config.mjs';

const ok = (check, sql) => assert.equal(check(sql).ok, true, `${sql} -> ${JSON.stringify(check(sql))}`);
const no = (check, sql, rule) => {
  const r = check(sql);
  assert.equal(r.ok, false, `${sql} should be rejected`);
  if (rule) assert.equal(r.rule, rule, `${sql} -> ${r.rule}: ${r.message}`);
};

test('postgres: reads pass', () => {
  for (const sql of [
    'SELECT 1',
    'select * from orders where id = $1',
    'WITH x AS (SELECT 1) SELECT * FROM x',
    'EXPLAIN SELECT * FROM t',
    'EXPLAIN ANALYZE SELECT * FROM t',
    'SHOW search_path',
    'TABLE orders',
    "SELECT 'it''s', E'a\\'b', $$x; DELETE$$, $tag$ ; $tag$",
    'SELECT "order", "update_dt" FROM t',
    'SELECT 1 /* a /* nested */ comment */',
    "SELECT 'C:\\' AS path, 2 AS n",
  ])
    ok(pg, sql);
});

test('postgres: writes, locks and side-effect functions rejected', () => {
  no(pg, 'INSERT INTO t VALUES (1)', 'whitelist');
  no(pg, 'COPY t TO STDOUT', 'whitelist');
  no(pg, 'SET default_transaction_read_only = off', 'whitelist');
  no(pg, 'BEGIN READ WRITE', 'whitelist');
  no(pg, 'DO $$ BEGIN DELETE FROM t; END $$', 'whitelist');
  no(pg, 'WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d', 'dml');
  no(pg, 'EXPLAIN ANALYZE UPDATE t SET a = 1', 'dml');
  no(pg, 'SELECT * INTO newt FROM t', 'forbidden');
  no(pg, 'SELECT * FROM t FOR UPDATE', 'forbidden');
  no(pg, 'SELECT * FROM t FOR NO KEY UPDATE', 'forbidden');
  no(pg, 'SELECT * FROM t FOR KEY SHARE', 'forbidden');
  no(pg, 'SELECT pg_sleep(10)', 'forbidden');
  no(pg, 'SELECT "pg_sleep"(10)', 'forbidden');
  no(pg, "SELECT set_config('default_transaction_read_only', 'off', false)", 'forbidden');
  no(pg, 'SELECT pg_terminate_backend(123)', 'forbidden');
  no(pg, "SELECT pg_read_file('/etc/passwd')", 'forbidden');
  no(pg, "SELECT nextval('s')", 'forbidden');
  no(pg, "SELECT dblink_exec('x', 'delete from t')", 'forbidden');
  no(pg, "SELECT query_to_xml('select 1', true, true, '')", 'forbidden');
  no(pg, 'SELECT pg_advisory_lock(1)', 'forbidden');
  // a string that hides a function name is still seen
  no(pg, "SELECT * FROM t WHERE x = 'pg_sleep'", 'forbidden');
});

test('postgres: backslash does not escape in a plain string, so a ; after it is a second statement', () => {
  no(pg, "SELECT 'a\\'; DELETE FROM t; --'", 'single-statement');
  ok(pg, "SELECT E'a\\'; DELETE FROM t; --'");
});

test('postgres: unterminated dollar quote and hint comments rejected', () => {
  no(pg, 'SELECT $x$ abc', 'comment/literal');
  no(pg, 'SELECT /*+ Set(statement_timeout 0) */ 1', 'comment/literal');
});

test('oracle: reads pass', () => {
  for (const sql of [
    'SELECT 1 FROM dual',
    'WITH x AS (SELECT 1 a FROM dual) SELECT * FROM x',
    "SELECT q'[it's; here]' FROM dual",
    "SELECT q'{a}' , Q'<b>' FROM dual",
    'SELECT DBMS_LOB.SUBSTR(c, 10, 1) FROM t',
    'SELECT DBMS_RANDOM.VALUE FROM dual',
    'SELECT * FROM t FETCH FIRST 10 ROWS ONLY',
  ])
    ok(ora, sql);
});

test('oracle: writes, locks, PL/SQL and packages rejected', () => {
  no(ora, 'INSERT INTO t VALUES (1)', 'whitelist');
  no(ora, 'BEGIN NULL; END;', 'single-statement');
  no(ora, 'CALL p()', 'whitelist');
  no(ora, 'EXPLAIN PLAN FOR SELECT 1 FROM dual', 'whitelist');
  no(ora, 'SHOW TABLES', 'whitelist');
  no(ora, 'WITH FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END; SELECT f FROM dual', 'single-statement');
  no(ora, 'WITH FUNCTION f RETURN NUMBER IS BEGIN RETURN 1 END SELECT f FROM dual', 'forbidden');
  no(ora, 'SELECT * FROM t FOR UPDATE', 'forbidden');
  no(ora, 'SELECT s.NEXTVAL FROM dual', 'forbidden');
  no(ora, 'SELECT DBMS_LOCK.SLEEP(5) FROM dual', 'forbidden');
  no(ora, 'SELECT DBMS_SESSION.SLEEP(5) FROM dual', 'forbidden');
  no(ora, "SELECT DBMS_XMLGEN.GETXML('delete from t') FROM dual", 'forbidden');
  no(ora, "SELECT UTL_HTTP.REQUEST('http://x') FROM dual", 'forbidden');
  no(ora, "SELECT HTTPURITYPE('http://x').getclob() FROM dual", 'forbidden');
  no(ora, "SELECT q'[x]", 'comment/literal');
});

test('mariadb: same rules as mysql, plus /*M! executable comments', () => {
  ok(maria, 'SELECT 1');
  no(maria, 'SELECT /*M!100000 SLEEP(1) */ 1', 'comment/literal');
  no(maria, 'SELECT /*!50000 SLEEP(1) */ 1', 'comment/literal');
  no(maria, 'DELETE FROM t', 'whitelist');
});

test('scan: "…" is a string on mysql, an identifier on postgres and oracle', () => {
  assert.equal(scan('SELECT "recv_nm"', DIALECTS.mysql).masked, 'SELECT ""');
  assert.equal(scan('SELECT "recv_nm"', DIALECTS.postgres).masked, 'SELECT "recv_nm"');
  assert.equal(scan('SELECT "RECV_NM"', DIALECTS.oracle).plain, 'SELECT "RECV_NM"');
});

test('personal data on postgres and oracle: quoted identifiers count, Oracle names by column and expression', () => {
  const isPii = piiMatcher();
  const f = (name, orgName = '') => ({ name, orgName });
  // postgres: source column known
  assert.deepEqual(piiColumns([f('who', 'recv_nm'), f('id', 'id')], 'SELECT recv_nm AS who, id FROM t', isPii, DIALECTS.postgres), ['who']);
  assert.deepEqual(piiColumns([f('x')], 'SELECT upper("recv_nm") AS x FROM t', isPii, DIALECTS.postgres), ['x']);
  // oracle: no source column; alias caught by its expression, `*` by the column's own name
  assert.deepEqual(piiColumns([f('WHO'), f('ID')], 'SELECT recv_nm who, id FROM t', isPii, DIALECTS.oracle), ['WHO']);
  assert.deepEqual(piiColumns([f('ID'), f('RECV_HP'), f('SHOP_CD')], 'SELECT * FROM t', isPii, DIALECTS.oracle), ['RECV_HP']);
  assert.deepEqual(piiColumns([f('N')], "SELECT COUNT(*) n FROM t WHERE recv_hp = q'[010]'", isPii, DIALECTS.oracle), []);
  assert.deepEqual(selectList("SELECT a, q'[x, y]' b FROM dual", DIALECTS.oracle), ['a', "'' b"]);
});
