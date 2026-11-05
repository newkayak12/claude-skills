// broker-normalize.mjs - result normalization: what a vendor's report becomes, the one-line
// verdict the orchestrator sees, and whether a node's result counts as a pass. Cut out of
// broker.mjs (card 128). Imports graph.mjs only.

import { REASONING_STAGES, VERDICT_FIELD } from './graph.mjs';

// ---------- result normalization ----------

// A staged run returns a validated `result`; an unstaged one returns the model's reply
// verbatim in `last_message`, often wrapped in prose or a fenced block.
export function entry(n) {
  return `${n.stage} node ${n.node_id}`;
}

export function parseVendorResult(report) {
  if (!report) return null;
  const r = report.result;
  if (r && typeof r === 'object') return r;
  const raw = typeof r === 'string' && r ? r : String(report.last_message || '');
  if (!raw.trim()) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  for (const candidate of [fenced && fenced[1], raw, raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* try the next shape */
    }
  }
  // Flagged, not silently shaped: the reasoning branch decides stage_ok from the payload,
  // and an unflagged fallback has no stage_ok at all - which read as success. A vendor
  // replying "I could not do it." was being recorded as a completed node.
  return { _unparsed: true, handoff: raw.slice(0, 4000), evidence: 'vendor did not return parseable JSON' };
}

// The orchestrator gets this and nothing more.
export function verdict(run, n) {
  const res = n.result || {};
  const out = {
    run_id: run.run_id,
    node_id: n.node_id,
    stage: n.stage,
    vendor: n.vendor,
    executor: n.executor,
    model: n.model,
    state: n.state,
    stage_ok: res.stage_ok === true,
  };
  if (VERDICT_FIELD[n.stage] === 'verified') out.verified = res.verified === true;
  if (n.stage === 'gate') {
    out.accept = res.accept === true;
    out.match_pct = res.match_pct;
    out.gap_count = (res.gaps || []).length;
    // Advisory, never blocking - but surfaced, or a run that passed with known
    // weaknesses reads exactly like one that had none.
    if ((res.observations || []).length) out.observation_count = res.observations.length;
    if ((res.spec_drift || []).length) out.spec_drift_count = res.spec_drift.length;
    if (!n.subgoal_id) out.attack_count = (res.attacks || []).length;
  }
  if (n.stage === 'critique') out.sound = res.sound === true;
  if (!REASONING_STAGES.has(n.stage)) {
    out.changed_files_verified = res.changed_files_verified === undefined ? null : res.changed_files_verified;
    out.change_attribution = res.change_attribution || null;
    if ((res.contradicted_files || []).length) out.contradicted_files = res.contradicted_files;
  }
  // Surface the fact that the broker overruled the executor. Without this the caller
  // sees a plain stage_ok=false and cannot tell a node that admitted failure from one
  // that claimed success and was caught.
  if (res.submitted_stage_ok === true && out.stage_ok !== true) out.submitted_stage_ok = true;
  // The opposite overrule: an author said stage_ok:false with nothing behind it and the work went on to be judged.
  if (res.self_reported_stage_ok === false) out.self_reported_stage_ok = false;
  if (n.state === 'failed' && res.stage_ok === true) {
    const field = VERDICT_FIELD[n.stage] || null;
    if (field && res[field] === undefined) out.missing_verdict = field;
  }
  if (res.reviewer_independence) out.reviewer_independence = res.reviewer_independence;
  if (res.killed_for) out.killed_for = res.killed_for;
  const reason = String(res.reason || res.verification_error || '');
  if (reason) out.reason = reason.slice(0, 300);
  out.detail_path = n.detail_path || null;
  return out;
}

// A gate that ran fine but REJECTED is not a completed dependency. On a gate, stage_ok
// means "the judging itself worked" and accept is the verdict; reading only stage_ok let
// a rejected subgoal flow downstream as if it had passed, which makes the gate
// decorative. Same shape for critique (sound) and test (verified).
export function nodeSucceeded(run, n, result) {
  if (result.stage_ok !== true) return false;
  // The verdict must be present and affirmative. Accepting `!== false` let a missing
  // field pass: a vendor that returned an implement-shaped result for a test node, or a
  // gate that returned no verdict at all, sailed through. Absent evidence is not a pass -
  // which is exactly what these nodes are told.
  const field = VERDICT_FIELD[n.stage];
  // execute (the qa kind's chain only - graph.mjs's KINDS.qa) is the exception: its contract
  // (prompts.mjs) says plainly "verified=false with stage_ok=true means one or more cases
  // failed - list each in defects" - that is a successful execution of the case set, carrying
  // real defects forward to gate/reduce/report, not a failed check to retry. There is no
  // implement stage in this chain for a retry to fix, so treating verified:false as failure
  // retried `execute` against the SAME unchanged tree three times over (execute:U2:1..3,
  // execute:U5:1..3 in awake-beta-ref1, 2026-09-24) for the same real bug, exhausted the
  // subgoal's retry budget, left `gate` and `reduce` unreachable, and ended the whole QA child
  // run `blocked` with the defects it found nowhere to go. Only stage_ok:false - the case set
  // could not be run at all - is a genuine execute failure. Every other VERDICT_FIELD stage
  // (test, review, gate, critique) keeps the ordinary rule below: the verdict must be present
  // and affirmative, because for those a false verdict really does mean the work must be redone.
  if (field && n.stage !== 'execute' && result[field] !== true) return false;
  // A gate that accepts at 70% is reporting a partial result as a pass. The percentage was
  // already being collected and shown; the threshold is what makes it mean something. Only
  // the goal gate is held to it - a subgoal gate answers for its own slice, the goal gate
  // answers for the whole thing - and a run may set its own number, or 0 to go by verdict alone.
  if (n.stage === 'gate' && !n.subgoal_id && Number.isFinite(result.match_pct)) {
    const floor = Number.isInteger(run.goal_threshold) ? run.goal_threshold : 90;
    // Below the floor fails only when the judge named what is missing - the rule the manager's
    // own accept floor already follows (taskmanager.mjs succeeded()). awake-beta-ref2's planning
    // gate:goal:1 accepted at 88 with gaps:[] ("the remaining weaknesses are disclosed and do not
    // block"); the floor failed it anyway, the forced repair:1 added a detection signal to close a
    // weakness nobody had called blocking, and that signal became the blocker gate:goal:2 and :3
    // rejected - two repairs and a whole planning round spent on a defect the floor manufactured.
    // The pass without named gaps is a band, not a waiver: an accept at 70 with gaps:[] is a judge
    // contradicting itself, and still fails.
    const named = Array.isArray(result.gaps) && result.gaps.length > 0;
    const nearFloor = result.accept === true && !named && result.match_pct >= floor - 5;
    if (result.match_pct < floor && !nearFloor) return false;
  }
  // A rejection needs no evidence - "it does not meet the bar" stands on its own. An
  // acceptance does: today every gate in a run returned match_pct within a few points of
  // the others, a thermometer stuck at room temperature. accept:true with nothing in
  // checks[] is a guess wearing a verdict, and the engine refuses it the same way a
  // missing verdict field is refused above.
  if (n.stage === 'gate' && result.accept === true && !(Array.isArray(result.checks) && result.checks.length > 0)) {
    return false;
  }
  // The goal gate is the only node that can invoke the assembled result the way the
  // requester actually will - a fresh shell, an absolute-path call, `npm test` from the
  // project root, the README read as a stranger. `checks[]` alone let three gates pass
  // a CLI whose own "am I main" guard broke under macOS's /var -> /private/var symlink,
  // because every one of them read diffs and reran the subgoals' own test[] instead of
  // calling the artifact from outside the tree. Same refusal as an empty checks[].
  if (n.stage === 'gate' && !n.subgoal_id && result.accept === true
    && !(Array.isArray(result.attacks) && result.attacks.length > 0)) {
    return false;
  }
  return true;
}
