import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkQuery } from '../vendors/mysql.mjs';

const allow = (sql, expected) => {
  const r = checkQuery(sql);
  assert.equal(r.ok, true, `${sql} -> ${r.message}`);
  if (expected !== undefined) assert.equal(r.sql, expected);
};
const deny = (sql, rule) => {
  const r = checkQuery(sql);
  assert.equal(r.ok, false, `${sql} should be rejected`);
  assert.equal(r.rule, rule, `${sql}: ${r.rule} ${r.message}`);
};

test('whitelisted statements pass', () => {
  allow('SELECT 1', 'SELECT 1');
  allow('  select 1;  ', 'select 1');
  allow('SHOW TABLES');
  allow('DESCRIBE users');
  allow('DESC users');
  allow('EXPLAIN SELECT * FROM t');
  allow('WITH x AS (SELECT 1 AS a) SELECT a FROM x');
  allow("SELECT REPLACE(name, 'a', 'b'), INSERT('abc', 1, 1, 'z') FROM t");
  allow('SELECT updated_at, deleted FROM t');
});

test('comments are stripped before judging, strings kept', () => {
  allow('-- hi\nSELECT 1 # trailing\n', 'SELECT 1');
  allow('/* lead */ SELECT /* mid */ 1', 'SELECT   1');
  allow("SELECT '-- not a comment; DELETE' AS s", "SELECT '-- not a comment; DELETE' AS s");
  allow("SELECT 'it''s', \"a\\\"b\", `we;ird` FROM t");
  allow('SELECT 1--1', 'SELECT 1--1'); // MySQL needs a space after --
});

test('whitelist rejects writes and session changes', () => {
  for (const s of [
    'INSERT INTO t VALUES (1)',
    'UPDATE t SET a=1',
    'DELETE FROM t',
    'DROP TABLE t',
    'SET SESSION TRANSACTION READ WRITE',
    'REPLACE INTO t VALUES (1)',
    'CALL p()',
    'BEGIN',
    'COMMIT',
    'TRUNCATE t',
    '(SELECT 1)',
    '/* SELECT */ DELETE FROM t',
  ]) deny(s, 'whitelist');
});

test('multiple statements rejected', () => {
  deny('SELECT 1; DELETE FROM t', 'single-statement');
  deny('SELECT 1;;', 'single-statement');
  deny('SELECT 1; -- x\n SELECT 2', 'single-statement');
});

test('forbidden constructs outside literals', () => {
  deny("SELECT * FROM t INTO OUTFILE '/tmp/x'", 'forbidden');
  deny("SELECT * FROM t INTO DUMPFILE '/tmp/x'", 'forbidden');
  deny('SELECT a INTO @v FROM t', 'forbidden');
  deny('SELECT * FROM t FOR UPDATE', 'forbidden');
  deny('SELECT * FROM t FOR SHARE', 'forbidden');
  deny('SELECT * FROM t LOCK IN SHARE MODE', 'forbidden');
  deny("SELECT GET_LOCK('x', 1)", 'forbidden');
  deny('SELECT SLEEP(10)', 'forbidden');
  deny('SELECT BENCHMARK(1000000, MD5(1))', 'forbidden');
  deny("SELECT LOAD_FILE('/etc/passwd')", 'forbidden');
  deny('SELECT * FROM t FOR\n  UPDATE', 'forbidden');
  allow("SELECT 'SLEEP(10) FOR UPDATE INTO OUTFILE' AS s");
  allow('SELECT `sleep` FROM t');
});

test('DML wrapped by WITH or EXPLAIN rejected', () => {
  deny('WITH x AS (SELECT 1) DELETE FROM t', 'dml');
  deny('WITH x AS (SELECT id FROM t) UPDATE t SET a=1', 'dml');
  deny('EXPLAIN ANALYZE DELETE t FROM t JOIN u ON t.id=u.id', 'dml');
  deny('DESC DELETE FROM t', 'dml');
  deny('WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x', 'dml');
  allow("WITH x AS (SELECT REPLACE(a,'b','c') AS r FROM t) SELECT r FROM x");
});

test('comment tricks rejected', () => {
  deny("SELECT 1 /*! INTO OUTFILE '/tmp/x' */", 'comment/literal');
  deny('SELECT /*+ MAX_EXECUTION_TIME(999999) */ 1', 'comment/literal');
  deny('SELECT 1 /* unterminated', 'comment/literal');
  deny("SELECT 'unterminated", 'comment/literal');
  deny('', 'empty');
  deny('  ;  ', 'empty');
  deny('-- only a comment', 'empty');
});
