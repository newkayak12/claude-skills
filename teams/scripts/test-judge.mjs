// unexplainedRefusal (daemon.mjs): a judge that refuses with no reason and no gaps has not
// judged. seam-beta-D2's integrate:1 refused with reason:null, gaps:null, and the repair it
// opened had nothing to fix from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unexplainedRefusal } from '../mcp/daemon.mjs';

test('a refusal with no reason and no gaps becomes a judge failure (re-judged), a reasoned one stands', () => {
  for (const r of [
    { stage_ok: true, verified: false, reason: null, gaps: null },
    { stage_ok: true, accept: false, reason: '  ', gaps: [] },
    { stage_ok: true, sound: false, problems: [] },
    { stage_ok: false },
  ]) {
    const out = unexplainedRefusal(r);
    assert.ok(out, JSON.stringify(r));
    assert.equal(out.judge_failed, true);
    assert.equal(out.stage_ok, false);
  }
  assert.equal(unexplainedRefusal({ stage_ok: true, verified: false, gaps: ['cli.test.mjs:106 asserts status 2'] }), null);
  assert.equal(unexplainedRefusal({ stage_ok: true, accept: false, reason: 'P2 misses AC 3' }), null);
  assert.equal(unexplainedRefusal({ stage_ok: true, sound: false, problems: [{ kind: 'A', text: 'x' }] }), null);
  assert.equal(unexplainedRefusal({ stage_ok: true, accept: true }), null, 'a pass needs no reason here');
  assert.equal(unexplainedRefusal({ stage_ok: false, judge_failed: true, reason: 'timeout' }), null, 'already a judge failure');
});
