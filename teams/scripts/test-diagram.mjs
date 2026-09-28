// The diagram IR (develop:architecture-designer's scripts/diagram.mjs, vendored at mcp/diagram.mjs)
// and the manager's use of it: shape's package map, drawn beside the docs and read by critique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, render, renderToFile } from '../mcp/diagram.mjs';
import { autoPackageDiagram, repairGroups } from '../mcp/taskmanager.mjs';

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

// The exact spec shape submitted in the 2026-09-28 portfolio-refresh run (teams-log
// portfolio-refresh-80ec931a, 20-shape.diagram.json / task.json's shape_diagram.problems):
// two semantic groups (rewriters, scorers) whose members interleave down the same column, so
// the bounding box of one group's cells always contains a member of the other.
function portfolioRefreshDiagram() {
  return {
    type: 'architecture', title: 'portfolio-refresh: 8 disjoint skill rewrites against one read-only bar',
    nodes: [
      { id: 'BAR', label: 'portfolio-feedback bar + PRD R1-R9 (read-only)', kind: 'store', row: 0, col: 0 },
      { id: 'P1', label: 'resume-tailorer', kind: 'package', row: 0, col: 1 },
      { id: 'P2', label: 'portfolio-rewrite', kind: 'package', row: 1, col: 1 },
      { id: 'P3', label: 'portfolio-jd', kind: 'package', row: 2, col: 1 },
      { id: 'P4', label: 'portfolio-interview', kind: 'package', row: 3, col: 1 },
      { id: 'P5', label: 'interview-prep', kind: 'package', row: 0, col: 2 },
      { id: 'P6', label: 'portfolio-company', kind: 'package', row: 1, col: 2 },
      { id: 'P7', label: 'portfolio-pattern', kind: 'package', row: 2, col: 2 },
      { id: 'P8', label: 'job-application-workflow', kind: 'package', row: 3, col: 2 },
    ],
    edges: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].map((id) => ({ from: 'BAR', to: id, label: 'R1-R9', style: 'data' })),
    groups: [
      { id: 'rewriters', label: 'line-rewriting skills', nodes: ['P1', 'P2', 'P4'] },
      { id: 'scorers', label: 'scoring / planning skills', nodes: ['P3', 'P5', 'P6', 'P7', 'P8'] },
    ],
  };
}

test('reproduces the portfolio-refresh refusal: two groups interleaved down one column, each flags the other\'s member', () => {
  const errs = validate(portfolioRefreshDiagram());
  assert.equal(errs.length, 4);
  assert.ok(errs.some((e) => /^node P3 \(row 2, col 1\) sits inside group rewriters's box \(rows 0-3, cols 1-1\) but is not a member/.test(e)));
  assert.ok(errs.some((e) => /^node P1 \(row 0, col 1\) sits inside group scorers's box \(rows 0-3, cols 1-2\) but is not a member/.test(e)));
  assert.ok(errs.some((e) => /^node P2 \(row 1, col 1\) sits inside group scorers's box/.test(e)));
  assert.ok(errs.some((e) => /^node P4 \(row 3, col 1\) sits inside group scorers's box/.test(e)));
});

test('repairGroups fixes the portfolio-refresh spec by moving the flagged nodes to columns of their own', () => {
  const ir = portfolioRefreshDiagram();
  const repair = repairGroups(ir);
  assert.ok(repair, 'expected a repair, not a null (fall back to auto)');
  assert.deepEqual(new Set(repair.moved), new Set(['P1', 'P2', 'P3', 'P4']));
  assert.deepEqual(validate(repair.ir), []);
  assert.match(render(repair.ir), /<svg class="d"/);
  // every node keeps its id, label and row - only the flagged ones move to a new column
  for (const n of ir.nodes) {
    const after = repair.ir.nodes.find((m) => m.id === n.id);
    assert.equal(after.row, n.row);
    assert.equal(after.label, n.label);
  }
  assert.deepEqual(repair.ir.nodes.find((n) => n.id === 'BAR'), ir.nodes.find((n) => n.id === 'BAR'), 'an unflagged node is untouched');
});

test('repairGroups refuses a diagram whose only problem is not a group/box one - a duplicate id is not its fix', () => {
  const ir = { type: 'architecture', title: 't', nodes: [
    { id: 'a', label: 'A', row: 0, col: 0 }, { id: 'b', label: 'B', row: 0, col: 0 },
  ], edges: [{ from: 'a', to: 'b' }] };
  assert.ok(validate(ir).length, 'sanity: this IR is invalid (a and b share a cell)');
  assert.equal(repairGroups(ir), null);
});

test('repairGroups returns null on an already-valid diagram - nothing for it to do', () => {
  const shapes = [{ id: 'P1', title: 'one' }];
  assert.equal(repairGroups(autoPackageDiagram(shapes)), null);
});

test('shape map: a sentence-long edge label is cut to fit and a group that swallows a non-member is dropped, instead of losing the whole map', async () => {
  const { mendDiagram } = await import('../mcp/taskmanager.mjs');
  const long = 'fit/SKILL.md name + both modes, which job-application-workflow step 1 points at';
  const ir = {
    type: 'architecture', title: 'packages',
    nodes: [
      { id: 'P1', label: 'fit', kind: 'package', row: 0, col: 0 },
      { id: 'P2', label: 'rewrite', kind: 'package', row: 1, col: 0 },
      { id: 'P3', label: 'beta', kind: 'package', row: 2, col: 0 },
      { id: 'P4', label: 'workflow', kind: 'package', row: 1, col: 1 },
    ],
    edges: [{ from: 'P1', to: 'P4', label: long }, { from: 'P2', to: 'P4' }, { from: 'P3', to: 'P4' }],
    groups: [{ id: 'bad', label: 'merges', nodes: ['P1', 'P3'] }],
  };
  assert.ok(validate(ir).length >= 2);
  const m = mendDiagram(ir);
  assert.deepEqual(validate(m), []);
  assert.ok(m.edges[0].label.length <= 48);
  assert.equal(m.edges[0].note, long);
  assert.deepEqual(m.groups, []);
  assert.equal(ir.edges[0].label, long, 'the input is not mutated');
});
