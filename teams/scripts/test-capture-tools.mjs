// teams/scripts/test-capture-tools.mjs - the normaliser of capture-tools.mjs, and the shape of the
// committed golden fixture (fixtures/tools-before.json). No server is spawned: importing
// capture-tools.mjs must not start a capture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from './capture-tools.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tools-before.json');
const KEYS = ['description', 'inputSchema', 'name', 'outputSchema', 'server'];

test('normalize sorts keys at every depth', () => {
  const out = normalize({ b: { z: 1, a: { y: 2, x: 3 } }, a: [{ d: 1, c: 2 }] });
  assert.equal(JSON.stringify(out), '{"a":[{"c":2,"d":1}],"b":{"a":{"x":3,"y":2},"z":1}}');
});

test('normalize keeps array order, including arrays of strings and numbers', () => {
  assert.deepEqual(normalize(['b', 'a', 3, 1]), ['b', 'a', 3, 1]);
  assert.equal(JSON.stringify(normalize({ required: ['z', 'a'] })), '{"required":["z","a"]}');
});

test('normalize passes primitives and null through', () => {
  assert.equal(normalize(null), null);
  assert.equal(normalize(0), 0);
  assert.equal(normalize(''), '');
  assert.equal(normalize(false), false);
  assert.equal(normalize('text'), 'text');
  assert.deepEqual(normalize({ a: null, b: false }), { a: null, b: false });
});

test('normalize is idempotent and does not mutate its input', () => {
  const input = { b: [{ y: 1, x: 2 }], a: null };
  const once = normalize(input);
  assert.equal(JSON.stringify(normalize(once)), JSON.stringify(once));
  assert.equal(JSON.stringify(input), '{"b":[{"y":1,"x":2}],"a":null}');
});

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

test('fixture holds 33 entries sorted by unique name', () => {
  assert.equal(fixture.length, 33);
  const names = fixture.map((e) => e.name);
  assert.deepEqual(names, [...names].sort());
  assert.equal(new Set(names).size, 33);
});

test('fixture splits 6 team_, 18 tm_, 9 wiki_', () => {
  const count = (p) => fixture.filter((e) => e.name.startsWith(p)).length;
  assert.equal(count('team_'), 6);
  assert.equal(count('tm_'), 18);
  assert.equal(count('wiki_'), 9);
});

test('fixture entries carry exactly the five keys and the server label of their prefix', () => {
  const server = { team_: 'teams-engineering', tm_: 'task-manager', wiki_: 'teams-wiki' };
  for (const e of fixture) {
    assert.deepEqual(Object.keys(e), KEYS, e.name);
    const prefix = Object.keys(server).find((p) => e.name.startsWith(p));
    assert.equal(e.server, server[prefix], e.name);
  }
});

test('every object in the fixture has sorted keys', () => {
  const walk = (v, where) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v);
      assert.deepEqual(keys, [...keys].sort(), where);
      for (const k of keys) walk(v[k], `${where}.${k}`);
    }
  };
  walk(fixture, 'fixture');
});

test('fixture embeds no absolute path or per-run value', () => {
  assert.doesNotMatch(readFileSync(FIXTURE, 'utf8'), /\/Users\/|\/private\/|\/var\/folders|\/tmp\//);
});
