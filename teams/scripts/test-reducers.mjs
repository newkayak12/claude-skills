#!/usr/bin/env node
// Unit + property tests for reducers.mjs - the declared reducer registry (docs/plans/
// 2026-09-23-teams-reducer-human-rollback.md §0.1/§1, D1). The property under test throughout
// is the one item 1 of the reducer plan asks for: a fold is associative/commutative (order of
// the input entries never changes the result) and idempotent (folding the same entry twice is
// the same as folding it once) - both are supposed to come for free from applyMerge's own
// dedup-then-sort machinery, not from each merge function being individually careful.
//
//   node --test teams/scripts/test-reducers.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MERGES, MERGE_KINDS, applyMerge, dedupeEntries, reducersFor, REGISTRY, foldRecords,
  writeScopeFindings,
} from '../mcp/reducers.mjs';

// ---------- merge primitives ----------

test('union: dedupes across entries, sorts, drops empties', () => {
  const entries = [
    { node_id: 'gate:U1:1', attempt: 1, value: ['a.txt', 'b.txt'] },
    { node_id: 'gate:U2:1', attempt: 1, value: ['b.txt', 'c.txt', ''] },
  ];
  assert.deepEqual(applyMerge('union', entries), ['a.txt', 'b.txt', 'c.txt']);
});

test('union: deep-dedups objects by JSON identity, not by reference', () => {
  const entries = [
    { node_id: 'draft:D1:1', attempt: 1, value: [{ id: 'US-1', title: 'a' }] },
    { node_id: 'draft:D2:1', attempt: 1, value: [{ id: 'US-1', title: 'a' }, { id: 'US-2', title: 'b' }] },
  ];
  const out = applyMerge('union', entries);
  assert.equal(out.length, 2, 'the identical US-1 object from both entries collapses to one');
  assert.ok(out.some((u) => u.id === 'US-1'));
  assert.ok(out.some((u) => u.id === 'US-2'));
});

test('concat-dedup: string-coerces, trims, dedupes, sorts', () => {
  const entries = [
    { node_id: 'gate:U1:1', attempt: 1, value: ['missing X', ' missing X ', ''] },
    { node_id: 'gate:U2:1', attempt: 1, value: 'missing Y' },
  ];
  assert.deepEqual(applyMerge('concat-dedup', entries), ['missing X', 'missing Y']);
});

test('and-consensus: true only when every entry is true, false on empty', () => {
  assert.equal(applyMerge('and-consensus', [
    { node_id: 'gate:goal:1', attempt: 1, value: true },
    { node_id: 'gate:goal:1b', attempt: 1, value: true },
  ]), true);
  assert.equal(applyMerge('and-consensus', [
    { node_id: 'gate:goal:1', attempt: 1, value: true },
    { node_id: 'gate:goal:1b', attempt: 1, value: false },
  ]), false);
  assert.equal(applyMerge('and-consensus', []), false);
});

test('min/max: numeric only, undefined on empty', () => {
  const entries = [
    { node_id: 'a', attempt: 1, value: 70 },
    { node_id: 'b', attempt: 1, value: 95 },
    { node_id: 'c', attempt: 1, value: Number.NaN },
  ];
  assert.equal(applyMerge('min', entries), 70);
  assert.equal(applyMerge('max', entries), 95);
  assert.equal(applyMerge('min', []), undefined);
});

test('last-by-attempt: the highest attempt wins, node_id breaks a tie deterministically', () => {
  const entries = [
    { node_id: 'dispatch:P1:1', attempt: 1, value: 'first try' },
    { node_id: 'dispatch:P1:3', attempt: 3, value: 'third try' },
    { node_id: 'dispatch:P1:2', attempt: 2, value: 'second try' },
  ];
  assert.equal(applyMerge('last-by-attempt', entries), 'third try');
});

test('applyMerge rejects an unregistered merge name rather than guessing', () => {
  assert.throws(() => applyMerge('sum', [{ node_id: 'a', attempt: 1, value: 1 }]), /unknown merge/);
});

// ---------- idempotence / order-independence (the property test item 1 asks for) ----------

function shuffled(arr, seed) {
  // Deterministic pseudo-shuffle (no Math.random - a flaky property test is worse than none):
  // a fixed-stride riffle keyed by `seed`, distinct from the input's own order for arrays of
  // any length > 1.
  const out = arr.slice();
  const n = out.length;
  for (let i = n - 1; i > 0; i--) {
    const j = (i * 2654435761 + seed * 40503 + 1) % (i + 1);
    [out[i], out[j >= 0 ? j : 0]] = [out[j >= 0 ? j : 0], out[i]];
  }
  return out;
}

const SAMPLE_ENTRIES = [
  { node_id: 'gate:U3:1', attempt: 1, value: ['c.txt', 'd.txt'] },
  { node_id: 'gate:U1:1', attempt: 1, value: ['a.txt'] },
  { node_id: 'gate:U2:1', attempt: 2, value: ['b.txt', 'a.txt'] },
  { node_id: 'gate:U5:1', attempt: 1, value: [] },
  { node_id: 'gate:U4:1', attempt: 3, value: ['e.txt'] },
];

for (const mergeName of ['union', 'concat-dedup']) {
  test(`${mergeName}: shuffled input folds to the same result as the original order`, () => {
    const baseline = applyMerge(mergeName, SAMPLE_ENTRIES);
    for (let seed = 0; seed < 5; seed++) {
      const out = applyMerge(mergeName, shuffled(SAMPLE_ENTRIES, seed));
      assert.deepEqual(out, baseline, `seed ${seed} changed the result`);
    }
  });

  test(`${mergeName}: folding the same entries twice (double-fold) is the same as folding once`, () => {
    const once = applyMerge(mergeName, SAMPLE_ENTRIES);
    const twice = applyMerge(mergeName, [...SAMPLE_ENTRIES, ...SAMPLE_ENTRIES]);
    assert.deepEqual(twice, once);
  });

  test(`${mergeName}: re-including one exact duplicate (node_id, attempt) entry changes nothing`, () => {
    const once = applyMerge(mergeName, SAMPLE_ENTRIES);
    const dup = applyMerge(mergeName, [...SAMPLE_ENTRIES, SAMPLE_ENTRIES[2]]);
    assert.deepEqual(dup, once);
  });
}

test('and-consensus/min/max are also order-independent and dup-safe', () => {
  const acceptEntries = [
    { node_id: 'gate:goal:1', attempt: 1, value: true },
    { node_id: 'gate:goal:1b', attempt: 1, value: true },
    { node_id: 'gate:goal:1c', attempt: 1, value: true },
  ];
  const matchEntries = [
    { node_id: 'gate:goal:1', attempt: 1, value: 92 },
    { node_id: 'gate:goal:1b', attempt: 1, value: 88 },
    { node_id: 'gate:goal:1c', attempt: 1, value: 95 },
  ];
  for (let seed = 0; seed < 4; seed++) {
    assert.equal(applyMerge('and-consensus', shuffled(acceptEntries, seed)), true);
    assert.equal(applyMerge('min', shuffled(matchEntries, seed)), 88);
  }
  assert.equal(applyMerge('and-consensus', [...acceptEntries, acceptEntries[0]]), true, 'a duplicate entry does not flip consensus');
  assert.equal(applyMerge('min', [...matchEntries, matchEntries[1]]), 88, 'a duplicate entry does not change min');
});

test('dedupeEntries: a later entry for the same (node_id, attempt) replaces an earlier one, not both kept', () => {
  const out = dedupeEntries([
    { node_id: 'dispatch:P1:1', attempt: 1, value: 'stale' },
    { node_id: 'dispatch:P1:1', attempt: 1, value: 'fresh' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 'fresh');
});

// ---------- per-kind registry / foldRecords ----------

test('reducersFor: every real kind starts from the shared defaults and only adds what its own contract returns', () => {
  for (const kind of ['subgoal', 'document', 'planning', 'qa', 'planning-audit']) {
    const table = reducersFor(kind);
    assert.equal(table.changed_files, 'union');
    assert.equal(table.accept, 'and-consensus');
    assert.equal(table.match_pct, 'min');
    assert.equal(table.gaps, 'concat-dedup');
  }
  assert.equal(reducersFor('planning').user_stories, 'union');
  assert.equal(reducersFor('qa').defects, 'concat-dedup');
  assert.equal(reducersFor('subgoal').user_stories, undefined, 'subgoal-kind work never returns user_stories');
  assert.equal(reducersFor('nonexistent-kind'), REGISTRY._default, 'an unknown kind falls back to the shared defaults');
});

test('foldRecords: folds every field present across records through its declared merge, keyed and deduped by (node_id, attempt)', () => {
  const records = [
    { node_id: 'gate:U1:1', attempt: 1, fields: { changed_files: ['a.txt'], gaps: ['missing X'] } },
    { node_id: 'gate:U2:1', attempt: 1, fields: { changed_files: ['b.txt'], gaps: [] } },
  ];
  const out = foldRecords('subgoal', records);
  assert.deepEqual(out.changed_files, ['a.txt', 'b.txt']);
  assert.deepEqual(out.gaps, ['missing X']);
  assert.equal(out.accept, undefined, 'no record declared accept, so it is left out rather than guessed at');
});

test('foldRecords: an undeclared field for this kind is dropped, not passed through silently', () => {
  const records = [{ node_id: 'gate:U1:1', attempt: 1, fields: { some_unregistered_field: 'x' } }];
  const out = foldRecords('subgoal', records);
  assert.deepEqual(out, {});
});

test('foldRecords: shuffle + double-fold produce the same merged object (the property the plan asks for)', () => {
  const records = [
    { node_id: 'gate:U1:1', attempt: 1, fields: { changed_files: ['a.txt'], match_pct: 90, gaps: ['g1'] } },
    { node_id: 'gate:U2:1', attempt: 1, fields: { changed_files: ['b.txt', 'a.txt'], match_pct: 85, gaps: [] } },
    { node_id: 'gate:U3:1', attempt: 1, fields: { changed_files: ['c.txt'], match_pct: 99, gaps: ['g2', 'g1'] } },
  ];
  const baseline = foldRecords('subgoal', records);
  for (let seed = 0; seed < 4; seed++) {
    assert.deepEqual(foldRecords('subgoal', shuffled(records, seed)), baseline);
  }
  assert.deepEqual(foldRecords('subgoal', [...records, ...records]), baseline, 'double-fold matches single fold');
  assert.deepEqual(foldRecords('subgoal', [...records, records[1]]), baseline, 're-including one record changes nothing');
});

// ---------- sibling write-scope check ----------

test('writeScopeFindings: two subgoals write the same file, neither declared it - a collision', () => {
  const subgoals = [
    { id: 'U1', files: ['docs/plan.md'] },
    { id: 'U2', files: ['docs/other.md'] },
  ];
  const records = [
    { subgoal_id: 'U1', attempt: 1, changed_files: ['docs/plan.md', 'src/a.js'] },
    { subgoal_id: 'U2', attempt: 1, changed_files: ['src/a.js'] },
  ];
  const out = writeScopeFindings(subgoals, records);
  assert.equal(out.collisions.length, 1);
  assert.equal(out.collisions[0].file, 'src/a.js');
  assert.deepEqual(out.collisions[0].written_by, ['U1', 'U2']);
  assert.deepEqual(out.collisions[0].declared_by, []);
});

test('writeScopeFindings: a subgoal writes a file another subgoal declared - an undeclared writer', () => {
  const subgoals = [
    { id: 'U1', files: ['docs/plan.md'] },
    { id: 'U2', files: ['docs/other.md'] },
  ];
  const records = [
    { subgoal_id: 'U1', attempt: 1, changed_files: ['docs/plan.md'] },
    { subgoal_id: 'U2', attempt: 1, changed_files: ['docs/plan.md'] },
  ];
  const out = writeScopeFindings(subgoals, records);
  assert.equal(out.undeclared_writers.length, 1);
  assert.equal(out.undeclared_writers[0].subgoal_id, 'U2');
  assert.equal(out.undeclared_writers[0].file, 'docs/plan.md');
});

test('writeScopeFindings: only the LATEST attempt counts - a superseded attempt does not collide', () => {
  const subgoals = [{ id: 'U1', files: ['docs/plan.md'] }, { id: 'U2', files: ['docs/other.md'] }];
  const records = [
    { subgoal_id: 'U1', attempt: 1, changed_files: ['docs/other.md'] }, // superseded attempt, wrote the wrong file
    { subgoal_id: 'U1', attempt: 2, changed_files: ['docs/plan.md'] }, // live attempt, correct
    { subgoal_id: 'U2', attempt: 1, changed_files: ['docs/other.md'] },
  ];
  const out = writeScopeFindings(subgoals, records);
  assert.equal(out.collisions.length, 0);
  assert.equal(out.undeclared_writers.length, 0);
});

test('writeScopeFindings: two subgoals declare the same heading on a shared file - a heading collision', () => {
  const subgoals = [
    { id: 'D1', files: ['docs/prd.md'], title: 'writes the ## Rollout section', acceptance: ['owns only "## Rollout" and touches no other section'] },
    { id: 'D2', files: ['docs/prd.md'], title: 'also writes ## Rollout', acceptance: ['covers ## Rollout in detail'] },
  ];
  const out = writeScopeFindings(subgoals, []);
  assert.equal(out.heading_collisions.length, 1);
  assert.deepEqual(out.heading_collisions[0].subgoals, ['D1', 'D2']);
  assert.deepEqual(out.heading_collisions[0].headings, ['rollout']);
});

test('writeScopeFindings: two subgoals share a file, each names its own distinct heading - clean', () => {
  const subgoals = [
    { id: 'D1', files: ['docs/prd.md'], title: 'owns "## Rollout"', acceptance: ['writes only ## Rollout, touches nothing else'] },
    { id: 'D2', files: ['docs/prd.md'], title: 'owns "## Risks"', acceptance: ['writes only ## Risks, touches nothing else'] },
  ];
  const records = [
    { subgoal_id: 'D1', attempt: 1, changed_files: ['docs/prd.md'] },
    { subgoal_id: 'D2', attempt: 1, changed_files: ['docs/prd.md'] },
  ];
  const out = writeScopeFindings(subgoals, records);
  assert.equal(out.heading_collisions.length, 0);
  // Both declared the same file, both wrote it - that is expected and declared (2 owners), so
  // it is not a collision either.
  assert.equal(out.collisions.length, 0);
});

test('writeScopeFindings: two subgoals share a file and one of them names no heading at all - flagged, not silently passed', () => {
  const subgoals = [
    { id: 'D1', files: ['docs/prd.md'], title: 'owns "## Rollout"', acceptance: ['writes only ## Rollout'] },
    { id: 'D2', files: ['docs/prd.md'], title: 'writes the doc', acceptance: ['fills in the rest'] },
  ];
  const out = writeScopeFindings(subgoals, []);
  assert.equal(out.heading_collisions.length, 1);
  assert.match(out.heading_collisions[0].reason, /D2 names no/);
});

test('writeScopeFindings: no subgoals sharing anything - three empty lists, not silently omitted fields', () => {
  const subgoals = [{ id: 'U1', files: ['a.js'] }, { id: 'U2', files: ['b.js'] }];
  const records = [
    { subgoal_id: 'U1', attempt: 1, changed_files: ['a.js'] },
    { subgoal_id: 'U2', attempt: 1, changed_files: ['b.js'] },
  ];
  const out = writeScopeFindings(subgoals, records);
  assert.deepEqual(out, { collisions: [], undeclared_writers: [], heading_collisions: [] });
});

test('MERGE_KINDS lists exactly the vocabulary the plan named: union, concat-dedup, and-consensus, min, max, last-by-attempt', () => {
  assert.deepEqual(MERGE_KINDS.slice().sort(), ['and-consensus', 'concat-dedup', 'last-by-attempt', 'max', 'min', 'union'].sort());
  assert.equal(Object.keys(MERGES).length, MERGE_KINDS.length);
});
