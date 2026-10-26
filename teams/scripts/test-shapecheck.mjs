// shapecheck.mjs: path overlaps, AC assignment and placeholder acceptance, on inline fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  touchScope, scopesOverlap, pathOverlapProblems, placeholderAcceptance,
  acAssignment, shapePrecheck, formatShapeFeedback,
} from '../mcp/shapecheck.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'mcp', 'shapecheck.mjs');

const story = (id, acceptance, card) => ({ id, card, acceptance });

test('touchScope and scopesOverlap: a trailing wildcard claims the directory, containment counts', () => {
  assert.equal(touchScope('src/a/**'), 'src/a');
  assert.equal(touchScope('src/a/*'), 'src/a');
  assert.equal(touchScope('src/*.test.ts'), 'src/*.test.ts');
  assert.ok(scopesOverlap('src/a', 'src/a/b.ts'));
  assert.ok(scopesOverlap('src/a/b.ts', 'src/a'));
  assert.ok(!scopesOverlap('src/a', 'src/ab'));
  assert.ok(!scopesOverlap('src/*.test.ts', 'src/a.test.ts'));
  assert.ok(scopesOverlap('src/*.test.ts', 'src/*.test.ts'));
});

test('pathOverlapProblems: equality, containment and the two wildcard spellings are reported', () => {
  const pk = (id, ...touches) => ({ id, touches });
  assert.deepEqual(pathOverlapProblems([pk('P1', 'x/SKILL.md'), pk('P2', 'x/SKILL.md')]), ['packages P1 and P2 both touch x/SKILL.md']);
  assert.deepEqual(
    pathOverlapProblems([pk('P1', 'src/a'), pk('P2', 'src/a/b.ts')]),
    ["packages P1 and P2 both touch src/a/b.ts: P1's src/a and P2's src/a/b.ts overlap - narrow one so each path has one owner"],
  );
  assert.equal(pathOverlapProblems([pk('P1', 'src/a/*'), pk('P2', 'src/a/**')]).length, 1);
  assert.deepEqual(pathOverlapProblems([pk('P1', 'src/a/**'), pk('P2', 'src/ab/**')]), []);
  assert.deepEqual(pathOverlapProblems([pk('P1', 'src/*.test.ts'), pk('P2', 'src/a.test.ts')]), []);
  // a package never overlaps itself; every overlap is listed
  assert.deepEqual(pathOverlapProblems([pk('P1', 'a', 'a/b')]), []);
  assert.equal(pathOverlapProblems([pk('P1', 'a', 'b'), pk('P2', 'a', 'b')]).length, 2);
});

test('placeholderAcceptance: the E-e80fea64 PLAN-F2:2 pointer is a placeholder', () => {
  const r = placeholderAcceptance([story('F2-US-1', [
    'F2-AC-1 through the F2-AC ids listed under F2-US-1 in docs/plans/F2-prd-split-write-plans.md, copied verbatim from the document',
    'the F2-AC ids listed under F2-US-1 in the document, copied verbatim',
  ], 'PLAN-F2')]);
  assert.equal(r.length, 2);
  assert.ok(r.every((x) => x.kind === 'placeholder' && x.story === 'F2-US-1' && x.card === 'PLAN-F2'));
  assert.equal(r[1].item, 'the F2-AC ids listed under F2-US-1 in the document, copied verbatim');
});

test('placeholderAcceptance: bare ids are flagged bare-id', () => {
  const r = placeholderAcceptance([story('F3-US-1', ['F3-AC-1', 'AC-2, AC-3', 'AC-4 AC-5.', '**F3-AC-6**'])]);
  assert.deepEqual(r.map((x) => x.kind), ['bare-id', 'bare-id', 'bare-id', 'bare-id']);
});

test('placeholderAcceptance: the softer pointers are flagged when no criterion text rides along', () => {
  const r = placeholderAcceptance([story('US-1', [
    'AC-1: see the document',
    'F1-AC-2: the criteria are in the PRD',
    'ids in the document',
  ])]);
  assert.deepEqual(r.map((x) => x.kind), ['placeholder', 'placeholder', 'placeholder']);
});

test('placeholderAcceptance: real criteria are never flagged', () => {
  const real = [
    'F2-AC-26: grep -rnE \'write/skills/plans/|write:plans\' . leaves only hits on the stated allow-list',
    'AC-1: Given x',
    'F1-AC-1: Given the write:requirements SKILL.md, When its Process is read, Then its first step takes a requirement',
    // E-c557fd66 F1-AC-18: a real Given/When/Then that happens to say "listed under"
    'F1-AC-18: Given `node _repo/scripts/check-skeleton.mjs` is run, When its output is read, Then `write:requirements` is not listed under skeleton problems and the file is within the cap',
    'the heading appears in the document',
  ];
  assert.deepEqual(placeholderAcceptance([story('US-1', real)]), []);
});

test('placeholderAcceptance: an empty or missing acceptance array yields nothing', () => {
  assert.deepEqual(placeholderAcceptance([story('US-1', []), { id: 'US-2' }, { id: 'US-3', acceptance: null }]), []);
  assert.deepEqual(placeholderAcceptance(undefined), []);
});

const PRD = [
  { id: 'F2-US-4', acceptance: ['F2-AC-22: Given a, When b, Then c', 'F2-AC-23: Given d, When e, Then f'] },
  { id: 'F2-US-5', acceptance: ['F2-AC-26: Given g, When h, Then i'] },
  { id: 'F3-US-4', acceptance: ['F3-AC-21: Given j, When k, Then l'] },
];
const pkg = (id, implements_, acceptance, extra = {}) => ({ id, implements: implements_, acceptance, touches: [`${id}/**`], ...extra });

test('acAssignment: an AC no package cites is unassigned with no non-owner', () => {
  const r = acAssignment([pkg('P1', ['F2-US-4'], ['F2-AC-22: x', 'F2-AC-23: y']), pkg('P2', ['F2-US-5'], ['F2-AC-26: z'])], PRD);
  assert.deepEqual(r.unassigned, [{ ac: 'F3-AC-21', story: 'F3-US-4', nonOwners: [] }]);
  assert.deepEqual(r.multi, []);
  assert.deepEqual(r.unknown, []);
});

test('acAssignment: an AC cited only by a non-owning package is unassigned and names it', () => {
  const r = acAssignment([
    pkg('P3', ['F3-US-4'], ['F3-AC-20: x']),
    pkg('P5', ['F3-US-5'], ['F3-AC-21: x']),
    pkg('P1', ['F2-US-4'], ['F2-AC-22: x', 'F2-AC-23: y']),
    pkg('P2', ['F2-US-5'], ['F2-AC-26: z']),
  ], PRD);
  assert.deepEqual(r.unassigned, [{ ac: 'F3-AC-21', story: 'F3-US-4', nonOwners: ['P5'] }]);
});

test('acAssignment: enables counts as owning; an AC cited by P4 and P6 is multi', () => {
  const r = acAssignment([
    pkg('P1', ['F2-US-4'], ['F2-AC-22', 'F2-AC-23']),
    pkg('P4', ['F2-US-5'], ['F2-AC-26: z']),
    pkg('P6', [], ['F2-AC-26: z again'], { enables: ['F2-US-5'] }),
    pkg('P3', ['F3-US-4'], ['F3-AC-21']),
  ], PRD);
  assert.deepEqual(r.unassigned, []);
  assert.deepEqual(r.multi, [{ ac: 'F2-AC-26', story: 'F2-US-5', packages: ['P4', 'P6'] }]);
});

test('acAssignment: an id the PRD never wrote is unknown; a shortened unambiguous id resolves', () => {
  const r = acAssignment([
    pkg('P1', ['F2-US-4'], ['AC-22: short', 'F2-AC-23: y', 'F9-AC-1: ghost']),
    pkg('P2', ['F2-US-5'], ['F2-AC-26']),
    pkg('P3', ['F3-US-4'], ['F3-AC-21']),
  ], PRD);
  assert.deepEqual(r.unknown, ['F9-AC-1']);
  assert.deepEqual(r.unassigned, []);
});

test('acAssignment: a PRD with no AC ids, or no stories array, yields nothing', () => {
  const p = [pkg('P1', ['US-1'], ['anything'])];
  assert.deepEqual(acAssignment(p, [{ id: 'US-1', acceptance: ['plain'] }]), { unassigned: [], multi: [], unknown: [] });
  assert.deepEqual(acAssignment(p, null), { unassigned: [], multi: [], unknown: [] });
});

test('shapePrecheck: a clean shape is ok with empty problems', () => {
  const r = shapePrecheck({ packages: [
    pkg('P1', ['F2-US-4'], ['F2-AC-22', 'F2-AC-23']),
    pkg('P2', ['F2-US-5'], ['F2-AC-26']),
    pkg('P3', ['F3-US-4'], ['F3-AC-21']),
  ] }, PRD);
  assert.equal(r.ok, true);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.overlaps, []);
});

test('shapePrecheck: each AC group is ONE string naming every offender, in order, then overlaps', () => {
  const stories = [
    { id: 'F1-US-1', acceptance: ['F1-AC-1: x', 'F1-AC-2: y'] },
    { id: 'F1-US-2', acceptance: ['F1-AC-3: z'] },
  ];
  const r = shapePrecheck({ packages: [
    { id: 'P1', implements: ['F1-US-1'], acceptance: ['F1-AC-1', 'F1-AC-3', 'F8-AC-1', 'F8-AC-2'], touches: ['src/a'] },
    { id: 'P2', implements: ['F1-US-2'], acceptance: ['F1-AC-3'], touches: ['src/a/b.ts'] },
  ] }, stories);
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 4);
  assert.match(r.problems[0], /^PRD acceptance criteria missing/);
  assert.match(r.problems[0], /F1-AC-2 \(no package cites it\)/);
  assert.match(r.problems[1], /^PRD acceptance criteria carried by more than one package: F1-AC-3 \(P1, P2\)/);
  assert.match(r.problems[2], /^acceptance IDs not in the PRD: F8-AC-1, F8-AC-2/);
  assert.match(r.problems[3], /both touch src\/a\/b\.ts/);
  assert.deepEqual(r.overlaps, [r.problems[3]]);
  // F1-AC-1 is carried by its owner, so it is not in unassigned
  assert.deepEqual(r.unassigned.map((u) => u.ac), ['F1-AC-2']);
});

test('formatShapeFeedback: each distinct problem once, in order, as a "- " list', () => {
  assert.equal(formatShapeFeedback(['a', 'b', 'a', 'c', 'b']), '\n- a\n- b\n- c');
  assert.equal(formatShapeFeedback([]), '');
  assert.ok(!formatShapeFeedback(['a', 'b']).includes('unusable shape'));
});

test('CLI: a shape with a missing AC and an overlap exits 1 naming both; a clean one exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shapecheck-'));
  try {
    const prd = join(dir, '10-prd.md');
    writeFileSync(prd, [
      '## User stories', '',
      '### F1-US-1 First story', '',
      'Acceptance', '',
      '- F1-AC-1: Given a, When b, Then c',
      '- F1-AC-2: Given d, When e, Then f',
      '',
      '### F1-US-2 Second story', '',
      'Acceptance', '',
      '- F1-AC-3: Given g, When h, Then i',
      '',
    ].join('\n'));
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ packages: [
      { id: 'P1', implements: ['F1-US-1'], acceptance: ['F1-AC-1: x'], touches: ['src/a'] },
      { id: 'P2', implements: ['F1-US-2'], acceptance: ['F1-AC-3: x'], touches: ['src/a/b.ts'] },
    ] }));
    const r = spawnSync(process.execPath, [CLI, '--prd', prd, '--shape', bad], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stdout, /F1-AC-2/);
    assert.match(r.stdout, /src\/a\/b\.ts/);
    assert.match(r.stdout, /P1 and P2/);

    const good = join(dir, 'good.json');
    writeFileSync(good, JSON.stringify({ packages: [
      { id: 'P1', implements: ['F1-US-1'], acceptance: ['F1-AC-1: x', 'F1-AC-2: y'], touches: ['src/a'] },
      { id: 'P2', implements: ['F1-US-2'], acceptance: ['F1-AC-3: x'], touches: ['src/b'] },
    ] }));
    const ok = spawnSync(process.execPath, [CLI, '--prd', prd, '--shape', good], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr + ok.stdout);
    assert.match(ok.stdout, /ok/);

    const gone = spawnSync(process.execPath, [CLI, '--prd', prd, '--shape', join(dir, 'missing.json')], { encoding: 'utf8' });
    assert.equal(gone.status, 2);
    assert.match(gone.stderr, /cannot read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
