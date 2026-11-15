import { test } from 'node:test';
import assert from 'node:assert/strict';
import { piiMatcher } from '../config.mjs';
import { piiColumns, selectList } from '../vendors/mysql.mjs';

test('default PII columns: names, phones, addresses, post codes, email, ids', () => {
  const isPii = piiMatcher();
  for (const c of ['order_nm', 'recv_nm', 'ORDER_TEL', 'recv_hp', 'recv_tel', 'recv_post', 'recv_addr_1', 'recv_addr_2', 'email', 'user_email', 'zip_code', 'birth_dt', 'jumin', 'sender_name', 'phone'])
    assert.equal(isPii(c), true, c);
  for (const c of ['id', 'product_nm', 'option_nm', 'shop_cd', 'order_num', 'post_id', 'brand_name', 'name', 'reg_date', 'delivery_msg', 'hpa'])
    assert.equal(isPii(c), false, c);
});

test('--pii off disables; a custom list replaces the default', () => {
  assert.equal(piiMatcher('off'), null);
  const isPii = piiMatcher('^secret_col$, nickname');
  assert.equal(isPii('secret_col'), true);
  assert.equal(isPii('user_nickname'), true);
  assert.equal(isPii('recv_nm'), false);
});

test('piiColumns: by source column (alias does not help), and computed columns when the statement names one', () => {
  const f = (name, orgName = '') => ({ name, orgName });
  assert.deepEqual(piiColumns([f('id', 'id'), f('who', 'recv_nm'), f('recv_hp', 'recv_hp')], 'SELECT id, recv_nm AS who, recv_hp FROM t'), ['who', 'recv_hp']);
  assert.deepEqual(piiColumns([f('id', 'id'), f('x')], "SELECT id, CONCAT(recv_nm, '') AS x FROM t"), ['x']);
  assert.deepEqual(piiColumns([f('LEFT(product_nm, 40)')], 'SELECT LEFT(product_nm, 40) FROM t'), []);
  assert.deepEqual(piiColumns([f('who', 'recv_nm')], 'SELECT recv_nm AS who FROM t', null), []);
});

test('selectList: one SELECT split at top-level commas; subquery, CTE, *, @var give null', () => {
  assert.deepEqual(selectList("SELECT a, CONCAT(b, ',', c) AS x, COUNT(*) FROM t WHERE d = 'from, x'"), ['a', "CONCAT(b, ' ', c) AS x", 'COUNT(*)']);
  assert.deepEqual(selectList('SELECT DISTINCT shop_cd FROM t ORDER BY 1'), ['DISTINCT shop_cd']);
  assert.deepEqual(selectList('SELECT 1'), ['1']);
  assert.deepEqual(selectList('SELECT from_dt, order_nm FROM t'), ['from_dt', 'order_nm']);
  for (const sql of [
    'SELECT * FROM t',
    'SELECT t.*, x FROM t',
    'SELECT (SELECT recv_nm FROM u LIMIT 1) AS n FROM t',
    'WITH c AS (SELECT recv_nm AS n FROM t) SELECT n FROM c',
    'SELECT n FROM (SELECT recv_nm AS n FROM t) d',
    'SELECT @a := 1, @a',
    'SHOW TABLES',
  ])
    assert.equal(selectList(sql), null, sql);
});

test('piiColumns: a computed column is hidden only by its own expression when the list is clear', () => {
  const f = (name, orgName = '') => ({ name, orgName });
  const sql = 'SELECT COUNT(*) AS n, MAX(reg_date) AS last, CONCAT(recv_nm, recv_hp) AS who FROM t WHERE recv_tel IS NOT NULL';
  assert.deepEqual(piiColumns([f('n'), f('last'), f('who')], sql), ['who']);
  // a derived table hides every computed column again
  const derived = 'SELECT COUNT(*) AS n, x FROM (SELECT recv_nm AS x FROM t) d GROUP BY x';
  assert.deepEqual(piiColumns([f('n'), f('x')], derived), ['n', 'x']);
});
