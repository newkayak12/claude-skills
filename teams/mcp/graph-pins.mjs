// graph-pins.mjs - the human pin on a subgoal's author node (cut from graph.mjs).
//
// applyHumanPin / releaseHumanPin and the two action shapes tm_assign queues (a subgoal pin and a
// STORY pin), plus the two small lookups they need (currentAttempt, nodeKind). Builds on
// graph-kinds.mjs (authorStage, kindOf) and graph-nodes.mjs (getNode).

import { authorStage, kindOf } from './graph-kinds.mjs';
import { getNode } from './graph-nodes.mjs';

// The human pin: a subgoal's own `assignee` field (written into the spec by setgoal itself, or
// at runtime by tm_assign) lands on exactly one node - the kind's author stage, never a judging
// one. A gate/review/test/critique judging the very work a human just did must stay automatic:
// pinning a judge to the same human it is meant to check would be the same same-actor mistake
// routing.mjs's AUTHOR_OF guards against for AI identities, just unguarded because a human was
// never in that table at all. Called right after pushChain creates the attempt - expandSubgoals'
// first attempt and retrySubgoal's every later one both call it, so a rejected human-authored
// subgoal comes back to a human again, not a model (_repo/docs/plans/2026-09-23-teams-reducer-human-
// rollback.md §0.2: a headless driver has no surface to reach one). A node already past
// 'pending' (running or done before the pin landed) is left alone - the spec's `assignee` still
// updates, so the NEXT attempt, if this one is rejected, picks it up.
//
// Two different hands write `assignee`, and _repo/docs/plans/2026-09-17-teams-team.md §7 ("사용자 =
// 그래프 노드") treats them differently. tm_assign marks its own writes {by: 'user'}
// (taskmanager.mjs's toolAssign, both the STORY-level pkg.assignee and the TASK-level
// sg.assignee) - the user is present by definition (they just called the tool), so that pin
// always parks the node in waiting_human, interactive or not. Anything else - a shape package's
// own `assignee` field (openChild's subgoal_assignee, itself the model's SHAPE output) or a
// setgoal subgoal's own `assignee` field - is the MODEL writing, not the user, and §7's
// "실행 규칙" is explicit that a model-authored pin is a decision the run defaults on its own
// unless the team asked to be interrupted: honoured as a parking pin only when run.interactive
// is true. This is the fix for the 0.27.3 review (2026-09-24): 0.27.3 parked ANY assignee:
// "human" unconditionally, so a model that wrote one into a shape or setgoal spec during a
// headless/bench run (nobody watching, interactive's own default is false) deadlocked the node
// in waiting_human forever - a flag nobody set was read as a question nobody could answer.
// Non-interactive now routes the node to an AI exactly as if nothing had been written, and
// records what would have parked it on the node itself (auto_decided_pin) - tm_inbox's
// `decided` section is exactly that record surfaced. "플래그 없는 실행은 '질문 없는 실행'이
// 아니라 '질문에 default로 답한 실행'이다. 차이는 기록에 있다." (§7).
function pinSource(pin) {
  return pin && typeof pin === 'object' && pin.by === 'user' ? 'user' : 'model';
}

export function applyHumanPin(run, sg, subgoalId, attempt) {
  const pin = sg && sg.assignee;
  if (!pin) return null;
  const n = getNode(run, `${authorStage(kindOf(sg))}:${subgoalId}:${attempt}`);
  if (!n || n.state !== 'pending') return null;
  const who = pin && typeof pin === 'object' ? (pin.who || null) : null;
  const source = pinSource(pin);
  if (source === 'model' && !run.interactive) {
    n.auto_decided_pin = {
      by: 'auto',
      who,
      pin: typeof pin === 'object' ? { ...pin } : pin,
      reason: 'assignee:"human" came from the shape/spec, not tm_assign, and this run is not interactive - dispatched to an AI instead of parking (§7)',
      at: Date.now(),
    };
    return null;
  }
  n.assignment = {
    executor: 'human', vendor: 'human', who,
    reason: source === 'user' ? 'pinned by tm_assign' : 'pinned by the subgoal spec (assignee)',
  };
  return n;
}

// The release half of the same pin (tm_assign({to: 'auto'})): drops the spec's own `assignee`
// and, when the node has not been picked up yet, whatever it already carries. A node still
// `waiting_human` goes back to `pending` so the very next team_next offers it to the ordinary
// candidate pool like any other node - "release with to: auto dispatches normally" is this line.
export function releaseHumanPin(run, sg, subgoalId, attempt) {
  if (sg) delete sg.assignee;
  const n = getNode(run, `${authorStage(kindOf(sg))}:${subgoalId}:${attempt}`);
  if (!n) return null;
  if (n.state === 'waiting_human') {
    n.state = 'pending';
    delete n.waiting_since;
  }
  if (n.assignment && n.assignment.executor === 'human') delete n.assignment;
  return n;
}

// One action ({subgoal_id, attempt, to: 'human'|'auto', who}), one place it is applied: tm_assign's
// own read-only preview (taskmanager.mjs, never saved) and the broker's real ingestion
// (mustFindRun -> drainHumanActions, broker.mjs) both call this, rather than each re-deciding
// "which of applyHumanPin/releaseHumanPin, with what assignee" on its own - that duplication is
// exactly how the preview and the real write could drift apart. See queueHumanAction below for
// why the write is queued at all instead of landing here directly.
export function applyPinAction(run, action) {
  const sg = run.spec && (run.spec.subgoals || []).find((s) => String(s.id) === action.subgoal_id);
  if (!sg) return null;
  if (action.to === 'auto') {
    delete sg.assignee;
    return releaseHumanPin(run, sg, action.subgoal_id, action.attempt);
  }
  // Only tm_assign queues a pin action, so this pin is the user's own - it parks whatever
  // `interactive` says (a model-written assignee is the one that needs interactive, §7).
  sg.assignee = { by: 'user', ...(action.who ? { who: action.who } : {}) };
  return applyHumanPin(run, sg, action.subgoal_id, action.attempt);
}

// The STORY half of tm_assign ({kind: 'story_pin', to, who}): the run-level pin expandSubgoals
// hands to every subgoal setgoal produces. A package child run opens with plan/setgoal/critique
// ahead of any subgoal, so a STORY pinned after dispatch but before setgoal has no subgoal to
// pin yet - this is what makes it land when they appear (and on a later spec retry). Subgoals
// that already exist are pinned by tm_assign's own per-subgoal `pin` actions.
// A STORY pin can also land AFTER setgoal produced subgoals (M5): tm_assign saw none while
// setgoal was running, queued only this run-level pin, and setgoal then expanded its subgoals
// unpinned. So the pin is applied to every subgoal that exists by now, at its current attempt,
// as well as to the ones setgoal will still produce; a release lets go of the user pins the
// STORY pin put there, leaving a model-written assignee alone.
export function applyStoryPin(run, action) {
  const subgoals = (run.spec && Array.isArray(run.spec.subgoals)) ? run.spec.subgoals : [];
  // A model-written assignee (shape's package assignee, setgoal's subgoal assignee) that a user
  // pin replaces is kept aside and put back on release, so a pin-then-release is a no-op.
  if (action.to === 'auto') {
    let changed = !!run.subgoal_assignee;
    delete run.subgoal_assignee;
    const runModel = 'model_subgoal_assignee' in run ? run.model_subgoal_assignee : undefined;
    delete run.model_subgoal_assignee;
    if (runModel !== undefined) run.subgoal_assignee = runModel;
    for (const sg of subgoals) {
      if (!(sg.assignee && typeof sg.assignee === 'object' && sg.assignee.by === 'user')) continue;
      const attempt = currentAttempt(run, sg.id);
      releaseHumanPin(run, sg, String(sg.id), attempt);
      // A subgoal setgoal created while the pin was held never had its own: it takes the run's
      // model assignee, as expandSubgoals would have given it without the pin.
      const back = 'model_assignee' in sg ? sg.model_assignee : runModel;
      delete sg.model_assignee;
      if (back !== undefined && back !== null) {
        sg.assignee = back && typeof back === 'object' ? { ...back } : back;
        applyHumanPin(run, sg, String(sg.id), attempt);
      }
      changed = true;
    }
    return changed;
  }
  if (run.subgoal_assignee && pinSource(run.subgoal_assignee) === 'model') run.model_subgoal_assignee = run.subgoal_assignee;
  run.subgoal_assignee = { by: 'user', ...(action.who ? { who: action.who } : {}) };
  for (const sg of subgoals) {
    // What it had before this pin (null: nothing) - a subgoal with no key was created under it.
    if (!(sg.assignee && pinSource(sg.assignee) === 'user')) sg.model_assignee = sg.assignee || null;
    sg.assignee = { ...run.subgoal_assignee };
    applyHumanPin(run, sg, String(sg.id), currentAttempt(run, sg.id));
  }
  return true;
}

// The attempt a subgoal is currently on, read back from the nodes themselves - what tm_assign
// has (a subgoal id, resolved from a ticket key) instead of the round number expandSubgoals and
// retrySubgoal already track as they go.
export function currentAttempt(run, subgoalId) {
  const mine = run.nodes.filter((n) => n.subgoal_id === String(subgoalId));
  return mine.length ? Math.max(...mine.map((n) => n.attempt || 1)) : 1;
}

// The kind of the subgoal a node belongs to, from the run's spec. Run-level nodes have none.
export function nodeKind(run, n) {
  if (!n || !n.subgoal_id || !run.spec) return null;
  const sg = (run.spec.subgoals || []).find((s) => String(s.id) === String(n.subgoal_id));
  return sg ? kindOf(sg) : null;
}
