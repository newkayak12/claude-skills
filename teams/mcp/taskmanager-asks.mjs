// taskmanager-asks.mjs - a running STORY's question and ask_timeout; split out of taskmanager.mjs (card 128 step 1), moved verbatim.
import { applySuspends, driverAlive, record, suspendedSince } from './taskstate.mjs';
import { getNode, loadRun, openAsk, peekHumanActions, queueHumanAction } from './graph.mjs';
import { latestBySubgoal } from './tickets.mjs';
import { finish } from './taskmanager-finish.mjs';
import { nextSpawnAttempt, spawnChildDriver } from './taskmanager-drivers.mjs';
import { noDriver } from './taskmanager-worktree.mjs';
import { respawnDriver, spawning } from './taskmanager-claims.mjs';
import { withTask } from './taskmanager-stages.mjs';
import { writeManagerBriefing } from './taskmanager-prompts.mjs';
// A running STORY's question to its TeamLeader (card 49 part C): the event shapes and the
// validation are storyask.mjs's, written to the ledger and acted on here.
import { answeredEvent, askedEvent, newAskId, validateAsk } from './storyask.mjs';

// ---------- a running STORY's question to its TeamLeader (card 49 part C) ----------
//
// design: _repo/docs/plans/mod/2026-10-17-subagent-communication.md §6; the ledger events are
// storyask.mjs's. task.story_asks keeps one entry per tm_ask for the life of the task - no cap, no
// de-dupe, no timeout:
//   {ask_id, key, pkg, node_id (the STORY's dispatch node), question, state, at, ...}
//   pending    asked; no answer node holds it
//   answering  the daemon's answer node holds it ({pid, token}); the marker that keeps it from
//              being run twice
//   forwarded  the answer node could not settle it: an ask card (card_node_id) waits on a person
//   answered   {answer, by, route}; the answer is not yet in the driver's hands
//   delivered  the STORY's driver was respawned with it
// The driver exited when tm_ask told it to, so while any of its entries is not delivered the STORY
// is parked: serviceDeadDriver does not restart it and dispatchSettled does not fold it. It is
// respawned once, with every answer, when none is outstanding.

export function storyAsksOf(task, nodeId) {
  return (task.story_asks || []).filter((a) => a.node_id === nodeId && a.state !== 'delivered');
}

// Respawn the parked STORY's driver with its answers; spawns nothing while the old driver is still
// alive (it has not exited yet) or a spawn is under way - serviceDeadDriver asks again next tick.
// No restart is spent: this is what the driver was always going to do next. An answer counts as
// delivered only when a process started.
function deliverStoryAnswers(task, nodeId, child) {
  const open = storyAsksOf(task, nodeId);
  if (!open.length || open.some((a) => a.state !== 'answered')) return false;
  const n = getNode(task, nodeId);
  if (!n || n.state !== 'running' || !child) {
    for (const a of open) a.state = 'delivered';
    return false;
  }
  if (noDriver() || driverAlive(child.driver) || spawning(child)) return false;
  const asks = open.map((a) => ({ ask_id: a.ask_id, question: a.question, answer: a.answer, by: a.by }));
  const ids = asks.map((a) => a.ask_id);
  const attempt = nextSpawnAttempt(child);
  return respawnDriver(task, nodeId, child, {
    attempt, reason: 'story_answered', restarts: (child.driver && child.driver.restarts) || [],
    spawn: (t, c) => spawnChildDriver(t, nodeId, c, { resume: true, attempt, asks }),
    event: (t, fresh) => {
      if (fresh.pid) for (const a of t.story_asks || []) if (ids.includes(a.ask_id)) a.state = 'delivered';
      return { event: 'child_driver_restarted', task_id: t.run_id, node_id: nodeId, pid: fresh.pid, reason: 'story_answered', asks: ids };
    },
  });
}

// The answer is the text the person chose; an answer with no text is not one.
function storyAnswerText(payload) {
  const chosen = ((payload || {}).decisions || []).map((d) => (d && d.chose !== undefined && d.chose !== null ? String(d.chose) : '')).filter((s) => s.trim() !== '');
  return chosen.length ? chosen.join('\n') : null;
}

// tm_ask({task_id, key, question}): the running STORY `key` asks its TeamLeader. Records `asked`
// and parks the STORY's driver; the daemon's answer node takes it from there (daemon.mjs
// answerStoryAsks). The input names the asker by its own key only - there is no field for another
// STORY or driver.
function toolAsk(a) {
  return withTask(a, (task) => {
    if (task.cancelled) throw new Error('task cancelled: tm_cancel stopped it, nothing more is asked of it');
    const v = validateAsk({ task, key: a.key, question: a.question });
    if (!v.ok) throw new Error(`tm_ask refused: ${v.reason}`);
    const dispatch = latestBySubgoal(task, v.pkgId, 'dispatch');
    const ask_id = newAskId();
    (task.story_asks || (task.story_asks = [])).push({ ask_id, key: v.key, pkg: v.pkgId, node_id: dispatch.node_id, question: a.question, state: 'pending', at: Date.now() });
    record(task, askedEvent({ task_id: task.run_id, key: v.key, node_id: dispatch.node_id, question: a.question, ask_id }));
    return { task_id: task.run_id, key: v.key, ask_id, state: 'parked', next: 'End your turn now. You are resumed, at no cost while you wait, with the answer in your prompt.' };
  });
}

// The daemon's answer node: the asks it may take now (pending, or answering under a claim that is
// no longer live - a daemon that died mid-answer), one claim at a time. `live(claim)` is the
// daemon's own check.
export function claimableStoryAsks(task, live) {
  return (task.story_asks || []).filter((a) => a.state === 'pending' || (a.state === 'answering' && !live(a.answering))).map((a) => a.ask_id);
}

export function claimStoryAsk(task, askId, claim, live) {
  const a = (task.story_asks || []).find((x) => x.ask_id === askId);
  if (!a || !(a.state === 'pending' || (a.state === 'answering' && !live(a.answering)))) return null;
  a.state = 'answering';
  a.answering = claim;
  record(task, { event: 'story_ask_answering', task_id: task.run_id, key: a.key, node_id: a.node_id, ask_id: a.ask_id });
  return structuredClone(a);
}

// verdict: storyask.mjs parseVerdict's. Applied only to the claim that was dispatched.
export function settleStoryAsk(task, askId, token, verdict) {
  const a = (task.story_asks || []).find((x) => x.ask_id === askId);
  if (!a || a.state !== 'answering' || !a.answering || a.answering.token !== token) return { superseded: true };
  delete a.answering;
  if (verdict.verdict === 'answer') storyAskAnswered(task, a, { answer: verdict.answer, by: 'teamleader', route: 'answer' });
  else forwardStoryAsk(task, a, verdict.reason);
  return { superseded: false, state: a.state };
}

// Writes `answered` and hands the answer to the parked driver (now, or on the tick its old process
// has exited).
function storyAskAnswered(task, a, { answer, by, route }) {
  a.state = 'answered';
  a.answer = answer;
  a.by = by;
  a.route = route;
  record(task, answeredEvent({ task_id: task.run_id, key: a.key, node_id: a.node_id, answer, by, route, ask_id: a.ask_id }));
  const n = getNode(task, a.node_id);
  deliverStoryAnswers(task, a.node_id, n && n.child);
}

// No `answered`: the question goes to the person as an ask card - free text, blocking (no
// options, no default, so it never times out) - and the driver stays parked until their tm_submit.
function forwardStoryAsk(task, a, reason) {
  const owner = `story-${a.pkg}`;
  const attempt = task.nodes.filter((x) => x.stage === 'ask' && x.ask_owner === owner).length + 1;
  const ids = openAsk(task, getNode(task, a.node_id), [{ question: a.question, to: 'requester', why: reason }], { owner, attempt, blocking: true, story: { ask_id: a.ask_id, key: a.key } });
  if (!ids.length) throw new Error(`could not open the card for ${a.ask_id}`);
  writeManagerBriefing(task, getNode(task, ids[0]));
  a.state = 'forwarded';
  a.card_node_id = ids[0];
  a.forward_reason = reason;
  record(task, { event: 'story_ask_forwarded', task_id: task.run_id, key: a.key, node_id: a.node_id, ask_id: a.ask_id, card: ids[0], reason });
}

// Free respawn of a parked child's driver so it drains a queued human action - no restart spent.
// Shared by tm_submit({key}) and expireAsks. Caller saves the task.
function resumeParkedDriver(task, nodeId, childRef, reason) {
  if (noDriver() || driverAlive(childRef.driver) || spawning(childRef)) return false;
  const restarts = (childRef.driver && childRef.driver.restarts) || [];
  const attempt = nextSpawnAttempt(childRef);
  return respawnDriver(task, nodeId, childRef, {
    attempt, reason, restarts,
    spawn: (t, c) => spawnChildDriver(t, nodeId, c, { resume: true, attempt }),
    event: (t, fresh) => ({ event: 'child_driver_restarted', task_id: t.run_id, node_id: nodeId, pid: fresh.pid, reason }),
  });
}

// ---------- ask_timeout (design §7: "만료 시 default로 자동 제출, by: timeout") ----------
//
// Who checks the deadline: the MANAGER, never a child driver - a child parked on a person has no
// driver at all (zero compute while waiting), so it cannot notice its own clock. expireAsks runs
// (1) on every daemon tick (daemon.mjs's stepOnceInner; the daemon stays alive, asleep, until the
// earliest deadline when nothing else is left to drive - nextAskDeadline), and (2) at the top of
// every tm_* call naming this task (callTool), so a task whose daemon is gone still expires on the
// next look. Either way the answer takes the same path a person's does: a manager-level card is
// finish()ed directly (task.json is ours to write), a child run's card is queued through
// queueHumanAction and its driver resumed for free, exactly like tm_submit({key}).
//
// The answer is each question's `default`, else its first option - the recommended one by the
// contract, and the same pick a non-interactive run makes (graph.mjs's default_decisions). A card
// with a question that has neither stays parked (openAsk never admits one, so this is defensive).
// Only `ask` cards expire: a pinned author stage or a gate:human card has no default to apply.
function askTimeoutMs(task) {
  const v = task && task.ask_timeout;
  return Number.isInteger(v) && v > 0 ? v : null;
}

function timeoutDecisions(n, timeout) {
  const out = [];
  for (const q of n.questions || []) {
    const question = q.question || q.unknown;
    const first = Array.isArray(q.options) && q.options.length ? q.options[0] : undefined;
    const pick = q.default !== undefined ? q.default : (first !== undefined ? (first && first.option !== undefined ? first.option : first) : undefined);
    if (!question || pick === undefined) return null;
    out.push({
      question,
      chose: typeof pick === 'string' ? pick : JSON.stringify(pick),
      because: `ask_timeout: nobody answered within ${timeout}ms - ${q.default !== undefined ? 'its default' : 'its first (recommended) option'} was applied`,
      by: 'timeout',
    });
  }
  return out.length ? out : null;
}

// Every run whose `ask` cards this task owns the clock for: itself, each running dispatch's
// child, and a size-S task's one run. `ref` is the task-side handle whose driver gets resumed.
function askRuns(task) {
  const out = [{ run: task, ref: null, nodeId: null }];
  for (const n of task.nodes) {
    if (n.stage !== 'dispatch' || n.state !== 'running' || !n.child) continue;
    const run = loadRun(n.child.cwd, n.child.run_id);
    if (run) out.push({ run, ref: n.child, nodeId: n.node_id });
  }
  if (task.s_run) {
    const run = loadRun(task.s_run.cwd, task.s_run.run_id);
    if (run) out.push({ run, ref: task.s_run, nodeId: 'S' });
  }
  return out;
}

function expiringAsks(run, ref) {
  const queued = ref ? new Set(peekHumanActions(ref.cwd, run.run_id).filter((x) => x.kind === 'submit').map((x) => x.node_id)) : new Set();
  // A STORY's own question (ask_id) waits forever: there is nothing a timeout could answer it with.
  return run.nodes.filter((x) => x.stage === 'ask' && !x.ask_id && x.state === 'waiting_human' && Number.isInteger(x.waiting_since) && !queued.has(x.node_id));
}

// An ask's deadline, pushed back by the time the machine slept after it started waiting.
function askDeadline(task, n, timeout) {
  return n.waiting_since + timeout + suspendedSince(task, n.waiting_since);
}

// Earliest pending deadline across every run above, or null (no timeout, or nothing waiting).
export function nextAskDeadline(task) {
  const timeout = askTimeoutMs(task);
  if (!timeout) return null;
  let at = null;
  for (const { run, ref } of askRuns(task)) {
    for (const x of expiringAsks(run, ref)) at = at === null ? askDeadline(task, x, timeout) : Math.min(at, askDeadline(task, x, timeout));
  }
  return at;
}

// Answers every expired card. Returns the node ids it answered; the caller saves the task when
// the list is non-empty (a manager-level finish() already saved it, a resumed driver has not).
export function expireAsks(task, now = Date.now()) {
  applySuspends(task);
  const timeout = askTimeoutMs(task);
  if (!timeout) return [];
  const answered = [];
  for (const { run, ref, nodeId } of askRuns(task)) {
    let queuedHere = false;
    for (const n of expiringAsks(run, ref)) {
      if (askDeadline(task, n, timeout) > now) continue;
      const decisions = timeoutDecisions(n, timeout);
      if (!decisions) continue;
      const payload = { stage_ok: true, decisions, by: 'timeout', timed_out_after_ms: timeout };
      if (!ref) {
        finish(task, n, payload);
      } else {
        queueHumanAction(ref.cwd, run.run_id, { kind: 'submit', node_id: n.node_id, payload, answered_at: now });
        queuedHere = true;
      }
      record(task, { event: 'ask_timeout', task_id: task.run_id, node_id: n.node_id, ...(nodeId ? { dispatch: nodeId } : {}), waited_ms: now - n.waiting_since, timeout_ms: timeout });
      answered.push(n.node_id);
    }
    if (queuedHere) resumeParkedDriver(task, nodeId, ref, 'ask_timeout');
  }
  return answered;
}

export { askTimeoutMs, deliverStoryAnswers, resumeParkedDriver, storyAnswerText, storyAskAnswered, toolAsk };
