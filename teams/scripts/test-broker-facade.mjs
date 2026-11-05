#!/usr/bin/env node
// broker.mjs is a facade over broker-*.mjs and stdio.mjs: every name it exported before the cut
// still resolves (to the module's own function, not a copy), importing it binds nothing, and the
// cut modules stay under the size the cut promised.
//
//   node --test teams/scripts/test-broker-facade.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as facade from '../mcp/broker.mjs';
import * as independence from '../mcp/broker-independence.mjs';
import * as routing from '../mcp/broker-routing.mjs';
import * as tools from '../mcp/broker-tools.mjs';

const MCP = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp');

// Every export broker.mjs had before the cut (recorded from the pre-change file) plus the two
// the stdio extraction added.
const RECORDED = {
  resolveNativeModel: routing.resolveNativeModel,
  finishNode: independence.finishNode,
  computeSubmitResult: independence.computeSubmitResult,
  BROKER_TOOLS: tools.BROKER_TOOLS,
  callBrokerTool: tools.callBrokerTool,
};

test('every recorded broker.mjs export resolves, to the owning module\'s own value', () => {
  for (const [name, owner] of Object.entries(RECORDED)) {
    assert.notEqual(facade[name], undefined, `${name} no longer resolves from broker.mjs`);
    assert.equal(facade[name], owner, `${name} is not the owning module's export`);
  }
  assert.equal(typeof facade.finishNode, 'function');
  assert.equal(typeof facade.resolveNativeModel, 'function');
  assert.equal(typeof facade.computeSubmitResult, 'function');
  assert.ok(Array.isArray(facade.BROKER_TOOLS) && facade.BROKER_TOOLS.length === 6);
  assert.equal(typeof facade.callBrokerTool, 'function');
});

test('broker.mjs exports nothing beyond the recorded names', () => {
  assert.deepEqual(Object.keys(facade).sort(), Object.keys(RECORDED).sort());
});

test('importing broker.mjs binds no stdin loop: a child that only imports it exits by itself, silent', () => {
  const r = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(pathToFileURL(join(MCP, 'broker.mjs')).href)})`], {
    input: '', encoding: 'utf8', timeout: 20000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});

test('the facade holds only imports, re-exports and wiring; no stdin handler lives in any broker file', () => {
  const src = readFileSync(join(MCP, 'broker.mjs'), 'utf8');
  const declarations = src.match(/^(export )?(async )?function |^(export )?const [A-Za-z_]+ = (async )?\(/gm) || [];
  assert.equal(declarations.length, 0, `broker.mjs declares functions: ${declarations.join(' | ')}`);
  for (const f of readdirSync(MCP).filter((x) => /^broker.*\.mjs$/.test(x) || x === 'stdio.mjs')) {
    assert.doesNotMatch(readFileSync(join(MCP, f), 'utf8'), /process\.stdin\.on\('data'/, `${f} reads stdin itself`);
  }
});

test('every broker-*.mjs and stdio.mjs stays under 1,500 lines (nothing later owns cutting them again)', () => {
  const files = readdirSync(MCP).filter((x) => /^broker-.*\.mjs$/.test(x) || x === 'stdio.mjs');
  for (const m of ['vendors', 'checkpoint', 'normalize', 'routing', 'independence', 'tools']) {
    assert.ok(files.includes(`broker-${m}.mjs`), `broker-${m}.mjs is missing`);
  }
  for (const f of files) {
    const lines = readFileSync(join(MCP, f), 'utf8').split('\n').length - 1;
    assert.ok(lines < 1500, `${f} is ${lines} lines`);
  }
});

test('the module imports are acyclic: vendors <- checkpoint <- (normalize) <- independence <- routing <- tools', () => {
  const order = ['vendors', 'checkpoint', 'normalize', 'independence', 'routing', 'tools'];
  for (const [i, m] of order.entries()) {
    const src = readFileSync(join(MCP, `broker-${m}.mjs`), 'utf8');
    const imported = [...src.matchAll(/from '\.\/broker-([a-z]+)\.mjs'/g)].map((x) => x[1]);
    for (const dep of imported) {
      assert.ok(order.indexOf(dep) < i, `broker-${m}.mjs imports broker-${dep}.mjs, which is not below it`);
    }
  }
});
