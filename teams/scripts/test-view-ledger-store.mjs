// The incremental ledger store equals view.mjs tailLines + parse, and reads only appended bytes.
//
//   node --test teams/scripts/test-view-ledger-store.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, truncateSync, rmSync, openSync, fstatSync, readSync, closeSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedgerStore, TAIL_BYTES } from './lib/view-ledger-store.mjs';
import { notableEvents, notableFromEvents } from './lib/view-events.mjs';

// The oracle: a verbatim copy of view.mjs tailLines, then the parse notableEvents does.
function tailLines(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines.filter((l) => l.trim());
  } catch { return []; } finally { if (fd !== undefined) closeSync(fd); }
}
const oracle = (path) => tailLines(path).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && typeof e.ts === 'number');

const dir = mkdtempSync(join(tmpdir(), 'ledger-store-'));
let n = 0;
const fresh = () => join(dir, `l${n++}.jsonl`);
const line = (i, pad = 0) => JSON.stringify({ ts: i, event: 'x', task_id: 'E-abc', pad: 'é'.repeat(pad) }) + '\n';
const same = (store, p) => assert.deepEqual(store.read(p), oracle(p));
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('missing and empty ledgers read as no events', () => {
  const s = createLedgerStore();
  assert.deepEqual(s.read(join(dir, 'nope.jsonl')), []);
  const p = fresh(); writeFileSync(p, '');
  same(s, p);
});

test('append reads only the new bytes', () => {
  const s = createLedgerStore();
  const p = fresh();
  writeFileSync(p, line(1) + line(2));
  same(s, p);
  const first = s.stats.bytesRead;
  const add = line(3) + line(4);
  appendFileSync(p, add);
  same(s, p);
  // the head fingerprint (<= 64 bytes) plus exactly the appended bytes; never the old body
  assert.ok(s.stats.bytesRead - first <= add.length + 64, `read ${s.stats.bytesRead - first} for ${add.length} appended`);
  assert.ok(s.stats.bytesRead - first >= add.length);
  const before = s.stats.reads;
  same(s, p); // unchanged: no read at all
  assert.equal(s.stats.reads, before);
});

test('truncate re-reads from 0', () => {
  const s = createLedgerStore();
  const p = fresh();
  writeFileSync(p, line(1) + line(2) + line(3));
  same(s, p);
  writeFileSync(p, line(9));
  same(s, p);
  truncateSync(p, 0);
  same(s, p);
});

test('rewrite (larger, head changed) re-reads from 0', () => {
  const s = createLedgerStore();
  const p = fresh();
  writeFileSync(p, line(1) + line(2));
  same(s, p);
  writeFileSync(p, line(7) + line(8) + line(9));
  same(s, p);
});

test('same-size rewrite is seen through mtime', () => {
  const s = createLedgerStore();
  const p = fresh();
  writeFileSync(p, line(1) + line(2));
  same(s, p);
  writeFileSync(p, line(5) + line(6));
  const t = new Date(Date.now() + 5000);
  utimesSync(p, t, t);
  same(s, p);
});

test('partial trailing line is parsed, not retained', () => {
  const s = createLedgerStore();
  const p = fresh();
  writeFileSync(p, line(1) + '{"ts":2,"event":"x"'); // torn: skipped
  same(s, p);
  appendFileSync(p, ',"task_id":"E-abc"}\n'); // completed by the writer
  same(s, p);
  assert.equal(s.read(p).length, 2);
  appendFileSync(p, '{"ts":3,"event":"y"}'); // complete JSON, no newline: parsed
  same(s, p);
  assert.equal(s.read(p).length, 3);
  appendFileSync(p, '\n' + line(4));
  same(s, p);
  assert.equal(s.read(p).length, 4);
});

test('a ledger larger than 256 KiB matches the window rule', () => {
  const s = createLedgerStore();
  const p = fresh();
  let body = '';
  for (let i = 0; i < 8000; i++) body += line(i, 20);
  assert.ok(Buffer.byteLength(body) > TAIL_BYTES * 2);
  writeFileSync(p, body);
  same(s, p);
  assert.ok(s.read(p).length < 8000);
  assert.equal(s.read(p).at(-1).ts, 7999);
});

test('append crossing the 256 KiB window drops what slid out and reads only new bytes', () => {
  const s = createLedgerStore();
  const p = fresh();
  let body = '';
  for (let i = 0; i < 2000; i++) body += line(i, 20); // ~100 KiB
  writeFileSync(p, body);
  same(s, p);
  let ts = 2000;
  for (let round = 0; round < 12; round++) {
    let add = '';
    for (let i = 0; i < 700; i++) add += line(ts++, 20);
    appendFileSync(p, add);
    const before = s.stats.bytesRead;
    same(s, p);
    assert.ok(s.stats.bytesRead - before <= Buffer.byteLength(add) + 64);
  }
  assert.ok(statSize(p) > TAIL_BYTES);
  assert.ok(s.read(p)[0].ts > 0);
});
const statSize = (p) => { const fd = openSync(p, 'r'); try { return fstatSync(fd).size; } finally { closeSync(fd); } };

test('notableFromEvents over store events equals notableEvents over the lines', () => {
  const s = createLedgerStore();
  const p = fresh();
  const lines = [
    { ts: 10, event: 'node_finish', task_id: 'E-1a2b3c4d', node_id: 'n1', state: 'failed' },
    { ts: 11, event: 'waiting_human', task_id: 'E-1a2b3c4d', node_id: 'n2' },
  ];
  writeFileSync(p, lines.map((o) => JSON.stringify(o) + '\n').join(''));
  for (const now of [11, 10 + 120001]) {
    assert.deepEqual(notableFromEvents(s.read(p), 0, { now }), notableEvents(tailLines(p), 0, { now }));
  }
  assert.deepEqual(notableFromEvents(s.read(p), 0), notableEvents(tailLines(p), 0));
});
