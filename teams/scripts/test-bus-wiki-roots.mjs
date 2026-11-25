#!/usr/bin/env node
// test-bus-wiki-roots.mjs - where the bus and the wiki land when server.mjs runs under a Codex
// setup, a Claude setup and an engine-launched node. The bus lives under HARNESS_TASKS_DIR
// whatever the client; the wiki follows TEAMS_WIKI_ROOT, else the Codex _meta workspace, else
// the spawn cwd. The server gets an environment built from nothing and a PATH with no binaries,
// so neither claude nor codex can start.
//
//   node --test teams/scripts/test-bus-wiki-roots.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as graph from '../mcp/graph.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', 'mcp', 'server.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'bus-wiki-roots-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best-effort */ } });

const RUN_ID = '5d1f0001-1111-2222-3333-444444444444';
const EPIC = `E-${RUN_ID.slice(0, 8)}`;

// A size-L task with STORYs P1 and P2 running and no daemon field: the start sweep skips it.
function seed(tasks, cwd) {
  const path = join(tasks, RUN_ID, 'task.json');
  mkdirSync(dirname(path), { recursive: true });
  const ids = ['P1', 'P2'];
  writeFileSync(path, JSON.stringify({
    run_id: RUN_ID, kind: 'task', store_path: path, cwd, request: 'r', created_at: Date.now(), size: 'L',
    spec: { acceptance: ['a'], packages: ids.map((id) => ({ id, title: id, flow: 'develop', brief: 'b', acceptance: ['a'], touches: [], deps: [] })) },
    nodes: ids.map((id) => graph.node(`dispatch:${id}:1`, 'dispatch', [], { subgoal_id: id, state: 'running' })),
  }, null, 2));
  return path;
}

const request = (id, name, args, meta) => ({
  jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args, ...(meta ? { _meta: meta } : {}) },
});
const codexMeta = (ws) => ({ 'x-codex-turn-metadata': { workspaces: { [ws]: {} } } });
const filesUnder = (dir) => readdirSync(dir, { recursive: true }).map(String);

// One server session: post teamleader -> P1, read as P1, write one wiki page; then check where
// each landed. `spawnAt`, `metaAt` and `wikiRootAt` name the workspaces 'A' or 'B'.
function run({ spawnAt, metaAt, wikiRootAt }) {
  const base = mkdtempSync(join(TMP, 'case-'));
  const dir = (name) => { const p = join(base, name); mkdirSync(p); return p; };
  const ws = { A: dir('A'), B: dir('B') };
  const tasks = dir('tasks');
  const taskFile = seed(tasks, dir('task-cwd'));
  // Built from nothing, so TEAMS_ASK_TASK_ID, HARNESS_NODE and TEAMS_WIKI_OFF are absent.
  const env = {
    HOME: dir('home'),
    PATH: dir('empty-path'),
    HARNESS_TASKS_DIR: tasks,
    TEAMS_RUNS_DIR: dir('runs'),
    TEAMS_SESSIONS_DIR: dir('sessions'),
    TEAMS_WIKI_ROOT: wikiRootAt ? ws[wikiRootAt] : '',
    // Without it tm_post raises a daemon for a running task that has none.
    HARNESS_TEST_NO_DAEMON: '1',
  };
  const meta = metaAt ? codexMeta(ws[metaAt]) : undefined;
  const body = 'amounts are cents';
  const requests = [
    { jsonrpc: '2.0', id: 0, method: 'initialize', params: meta ? { _meta: meta } : {} },
    request(1, 'tm_post', { task_id: RUN_ID, from: 'teamleader', to: `${EPIC}/P1`, body }, meta),
    request(2, 'tm_read', { task_id: RUN_ID, key: `${EPIC}/P1` }, meta),
    request(3, 'wiki_write', { space: 'roots', slug: 'page', title: 't', body: 'b', source: 'test' }, meta),
  ];
  const child = spawnSync(process.execPath, [SERVER], {
    cwd: ws[spawnAt], env, input: requests.map((q) => JSON.stringify(q)).join('\n') + '\n', encoding: 'utf8', timeout: 30000,
  });
  assert.equal(child.status, 0, child.stderr);
  const replies = new Map(child.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((m) => [m.id, m]));
  assert.ok(replies.get(0)?.result?.serverInfo, 'initialize answered');
  const result = (id) => {
    const r = replies.get(id)?.result;
    assert.equal(r?.isError, false, JSON.stringify(replies.get(id)));
    return r.structuredContent;
  };
  const posted = result(1);
  const read = result(2);
  result(3);

  const message = { ts: posted.ts, from: 'teamleader', to: `${EPIC}/P1`, topic: `${EPIC}/P1`, body, reply_to: null };
  const lines = readFileSync(join(tasks, RUN_ID, 'bus.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(lines, [message]);
  assert.deepEqual(read.messages, [message]);
  for (const root of Object.values(ws)) {
    assert.deepEqual(filesUnder(root).filter((f) => basename(f) === 'bus.jsonl'), []);
  }
  assert.ok(existsSync(join(ws.B, '.teams_wiki', 'roots', 'page.md')), 'the page is under B');
  if (spawnAt === 'A') assert.ok(!existsSync(join(ws.A, '.teams_wiki')), 'no wiki under the spawn cwd');
  assert.ok(!('daemon' in JSON.parse(readFileSync(taskFile, 'utf8'))), 'no daemon was raised');
}

test('Codex: spawned in A, every call names workspace B in _meta: wiki under B, bus under HARNESS_TASKS_DIR', () => {
  run({ spawnAt: 'A', metaAt: 'B' });
});

test('Claude: spawned in B, no _meta: wiki under B, bus under HARNESS_TASKS_DIR', () => {
  run({ spawnAt: 'B' });
});

test('engine-launched: spawned in A with TEAMS_WIKI_ROOT=B, no _meta: wiki under B, bus under HARNESS_TASKS_DIR', () => {
  run({ spawnAt: 'A', wikiRootAt: 'B' });
});
