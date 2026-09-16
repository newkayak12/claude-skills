import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/index.mjs';

test('valid config parses', () => {
  const r = parseConfig('name=svc\nport=8080\ntimeout=30\n');
  assert.deepEqual(r, { ok: true, value: { name: 'svc', port: 8080, timeout: 30 } });
});

test('blank lines and comments are ignored', () => {
  const r = parseConfig('# comment\n\nname=svc\nport=8080\n\ntimeout=30\n');
  assert.equal(r.ok, true);
});

test('a line with no "=" is PARSE_ERROR', () => {
  const r = parseConfig('name=svc\nnotakeyvalue\nport=8080\ntimeout=30\n');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PARSE_ERROR');
});

test('a missing required field is MISSING_FIELD', () => {
  const r = parseConfig('name=svc\nport=8080\n');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'MISSING_FIELD');
  assert.equal(r.field, 'timeout');
});

test('a non-integer port is BAD_TYPE', () => {
  const r = parseConfig('name=svc\nport=notanumber\ntimeout=30\n');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BAD_TYPE');
  assert.equal(r.field, 'port');
});

test('a port out of range is BAD_TYPE', () => {
  const r = parseConfig('name=svc\nport=70000\ntimeout=30\n');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BAD_TYPE');
});

test('an unknown field is UNKNOWN_FIELD', () => {
  const r = parseConfig('name=svc\nport=8080\ntimeout=30\nregion=us\n');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'UNKNOWN_FIELD');
  assert.equal(r.field, 'region');
});
