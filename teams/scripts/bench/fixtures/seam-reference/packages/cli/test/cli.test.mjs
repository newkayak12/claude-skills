import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'bin', 'lintcfg.mjs');
const dir = mkdtempSync(join(tmpdir(), 'lintcfg-test-'));

function write(name, content) {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

test('valid config: exit 0, OK line', () => {
  const f = write('good.cfg', 'name=svc\nport=8080\ntimeout=30\n');
  const r = spawnSync('node', [CLI, 'check', f], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^OK name=svc port=8080 timeout=30/);
});

test('missing field: exit matches EXIT_CODES.MISSING_FIELD (3)', () => {
  const f = write('missing.cfg', 'name=svc\nport=8080\n');
  const r = spawnSync('node', [CLI, 'check', f], { encoding: 'utf8' });
  assert.equal(r.status, 3);
  assert.match(r.stdout, /^Error \[3\]/);
});

test('bad type: exit matches EXIT_CODES.BAD_TYPE (4)', () => {
  const f = write('badtype.cfg', 'name=svc\nport=notanumber\ntimeout=30\n');
  const r = spawnSync('node', [CLI, 'check', f], { encoding: 'utf8' });
  assert.equal(r.status, 4);
  assert.match(r.stdout, /^Error \[4\]/);
});

test('unknown field: exit matches EXIT_CODES.UNKNOWN_FIELD (5)', () => {
  const f = write('unknown.cfg', 'name=svc\nport=8080\ntimeout=30\nregion=us\n');
  const r = spawnSync('node', [CLI, 'check', f], { encoding: 'utf8' });
  assert.equal(r.status, 5);
  assert.match(r.stdout, /^Error \[5\]/);
});

test('missing file: exit matches EXIT_CODES.PARSE_ERROR (2)', () => {
  const r = spawnSync('node', [CLI, 'check', join(dir, 'nope.cfg')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /^Error \[2\]/);
});
