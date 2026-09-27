// The diagram IR (develop:architecture-designer's scripts/diagram.mjs, vendored at mcp/diagram.mjs)
// and the manager's use of it: shape's package map, drawn beside the docs and read by critique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, render, renderToFile } from '../mcp/diagram.mjs';
import { autoPackageDiagram } from '../mcp/taskmanager.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('the vendored renderer is byte-identical to the skill\'s copy', () => {
  const skill = readFileSync(join(HERE, '..', '..', 'develop', 'skills', 'architecture-designer', 'scripts', 'diagram.mjs'), 'utf8');
  const vendored = readFileSync(join(HERE, '..', 'mcp', 'diagram.mjs'), 'utf8');
  assert.equal(vendored, skill, 'copy develop/skills/architecture-designer/scripts/diagram.mjs over teams/mcp/diagram.mjs');
});

test('every example in the skill\'s diagram-ir.md validates and renders', () => {
  const md = readFileSync(join(HERE, '..', '..', 'develop', 'skills', 'architecture-designer', 'references', 'diagram-ir.md'), 'utf8');
  const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
  assert.ok(blocks.length >= 2);
  for (const ir of blocks) {
    assert.deepEqual(validate(ir), []);
    assert.match(render(ir), /<svg class="d"/);
  }
});

test('the checker phrases each problem as its repair, and refuses to render', () => {
  const ir = { type: 'architecture', title: 't', nodes: [
    { id: 'a', label: 'A', row: 0, col: 0 }, { id: 'b', label: 'B', row: 0, col: 0 }, { id: 'c', label: 'C', row: 0, col: 1 },
    { id: 'd', label: 'x'.repeat(60), row: 2, col: 2 },
  ], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'zz' }], groups: [{ id: 'g', label: 'G', nodes: ['a', 'd'] }] };
  const errs = validate(ir);
  assert.ok(errs.some((e) => /a and b both sit at row 0, col 0 - move one/.test(e)));
  assert.ok(errs.some((e) => /"to" must name a node id \(got "zz"\)/.test(e)));
  assert.ok(errs.some((e) => /node c has no edge/.test(e)));
  assert.ok(errs.some((e) => /node d: shorten the label/.test(e)));
  assert.ok(errs.some((e) => /node c \(row 0, col 1\) sits inside group g's box/.test(e)));
  assert.throws(() => render(ir), /does not validate/);
  const dir = mkdtempSync(join(tmpdir(), 'diagram-'));
  try {
    assert.throws(() => renderToFile(ir, join(dir, 'out.html')));
    assert.equal(existsSync(join(dir, 'out.html')), false, 'a failed revision writes nothing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the plain package map validates for any shape: no deps, a chain, a diamond, a cycle', () => {
  const shapes = [
    [{ id: 'P1', title: 'one' }],
    [{ id: 'P1', title: 'a' }, { id: 'P2', title: 'b' }, { id: 'P3', title: 'c' }],
    [{ id: 'P1', title: 'csv' }, { id: 'P2', title: 'rules' }, { id: 'P3', title: 'report', deps: ['P1', 'P2'] }, { id: 'P4', title: 'cli', deps: ['P3', 'P1', 'P2'] }],
    [{ id: 'P1', title: 'a', deps: ['P2'] }, { id: 'P2', title: 'b', deps: ['P1'] }],
  ];
  for (const pkgs of shapes) assert.deepEqual(validate(autoPackageDiagram(pkgs)), [], JSON.stringify(pkgs));
  const diamond = autoPackageDiagram(shapes[2]);
  assert.ok(!diamond.edges.some((e) => e.from === 'P1' && e.to === 'P4'), 'P4 builds on P1 through P3 - no line through P3\'s box');
  assert.deepEqual(diamond.edges.filter((e) => e.to === 'integration').map((e) => e.from), ['P4'], 'only chain ends are merged directly');
});
