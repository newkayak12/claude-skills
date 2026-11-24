// view --once prints one bus digest line (busDigest, from P1's interface note) when the task has a
// bus message, and nothing new when it has none. The two constants are copied literally from the note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { node } from '../mcp/graph.mjs';
import { BUS_FILE } from '../mcp/bus.mjs';

const VIEW = join(dirname(fileURLToPath(import.meta.url)), 'view.mjs');
const write = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };

const NOTE_FORMAT = 'bus: <count> msg, last <from> -> <to> @ <ts>';
const NOTE_EXAMPLE = 'bus: 2 msg, last E-de2a5672/P1 -> E-de2a5672/P2 @ 1001';

const RECORDS = [
  { ts: 1000, from: 'E-de2a5672/P1', to: 'teamleader', topic: 'E-de2a5672/P1', body: 'probe', reply_to: null },
  { ts: 1001, from: 'E-de2a5672/P1', to: 'E-de2a5672/P2', topic: 'E-de2a5672/P2', body: 'note', reply_to: null },
];

function fixture(bus) {
  const root = mkdtempSync(join(tmpdir(), 'view-bus-digest-'));
  const tasks = join(root, 'tasks');
  const id = 'aaaaaaaa-0001';
  const dir = join(tasks, id);
  const cwd = join(root, 'proj');
  mkdirSync(cwd, { recursive: true });
  write(join(dir, 'task.json'), JSON.stringify({
    run_id: id, kind: 'task', cwd, request: 'r', created_at: Date.now(), store_path: join(dir, 'task.json'),
    opener: { session_id: 's-1', entrypoint: 'cli' },
    spec: { packages: [] },
    nodes: [node('size', 'size', [], { state: 'done' })],
  }));
  write(join(dir, 'ledger.jsonl'), JSON.stringify({ ts: Date.now(), event: 'task_open' }) + '\n');
  if (bus) write(join(dir, BUS_FILE), bus.map((m) => JSON.stringify(m)).join('\n') + '\n');
  return { root, tasks, id };
}

function render(f) {
  const r = spawnSync(process.execPath, [VIEW, '--once', '--tasks-dir', f.tasks, '--task', f.id], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('the note format filled with the worked example equals the note example', () => {
  const filled = NOTE_FORMAT.replace('<count>', '2').replace('<from>', 'E-de2a5672/P1').replace('<to>', 'E-de2a5672/P2').replace('<ts>', '1001');
  assert.equal(filled, NOTE_EXAMPLE);
});

test('a task with bus messages prints the digest line once, before threads:', () => {
  const f = fixture(RECORDS);
  try {
    const lines = render(f).split('\n').map((l) => l.trim());
    assert.equal(lines.filter((l) => l === NOTE_EXAMPLE).length, 1);
    const ti = lines.indexOf('threads:');
    assert.ok(ti > lines.indexOf(NOTE_EXAMPLE), 'digest line comes before threads:');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('a task without bus.jsonl prints no digest line and no threads', () => {
  const f = fixture(null);
  try {
    const out = render(f);
    assert.ok(!out.split('\n').some((l) => /^\s*bus: /.test(l)));
    assert.ok(!out.includes('threads:'));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
