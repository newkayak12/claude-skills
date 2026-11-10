// Pure builder behind the floor part of `view.mjs --once --format summary` (the teams pane's
// STORYs and Floor tabs): one item per STORY at work, one worker per desk, the recorded hand-offs.
// No fs: view-floor-fs.mjs reads the streams, costs and run files and hands them in as `facts`;
// the ledger is read through view-events.mjs, which owns what a ledger line means.
import { cardsOf, storyNow, waitingNode, metrics } from './view-summary.mjs';
import { handoffs, lastVerdicts, phaseHandoffs, PHASES } from './view-events.mjs';

const attemptOf = (nodeId) => {
  const n = Number(String(nodeId || '').split(':')[2]);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// try = the attempt of the child run's running node, else the newest attempt it has reached.
// max = max_retries + 1. Both null while the child run is unknown.
function tryOf(c) {
  const child = c.child;
  const nodes = (child && child.nodes) || [];
  const max = Number.isInteger(child && child.max_retries) ? child.max_retries + 1 : null; // the child run's own limit, else unknown
  const mine = nodes.filter((n) => n.subgoal_id != null && attemptOf(n.node_id));
  if (!mine.length) return { try: null, max };
  const running = mine.filter((n) => n.state === 'running' || waitingNode(n));
  const pool = running.length ? running : mine;
  return { try: Math.max(...pool.map((n) => attemptOf(n.node_id))), max };
}

// The node a card works in now, for the Phase page's Running rows: { node (its stage), role, elapsed_ms }, each only when
// recorded. role is the stage's fixed role word (the graph's own: implement -> implementer ...); a node that waits on a person is
// the TeamLeader's. A claimed dispatch with no inner node yet names no node.
const ROLE = { plan: 'planner', setgoal: 'planner', critique: 'critic', implement: 'implementer', test: 'tester', gate: 'judge', accept: 'judge' };
const liveNode = (n) => n && (n.state === 'running' || n.state === 'waiting_human' || n.judging_since);
function nodeNow(c, now) {
  const inner = ((c.child && c.child.nodes) || []).find((n) => n.state === 'running' || n.state === 'waiting_human');
  const n = liveNode(c.accept) ? c.accept : liveNode(c.dispatch) && inner ? inner : null;
  if (!n) return {};
  const since = n.judging_since || n.started_at || n.waiting_since;
  const role = n.state === 'waiting_human' ? 'TeamLeader' : ROLE[n.stage];
  return {
    ...(n.stage ? { node: n.stage } : {}), ...(role ? { role } : {}),
    ...(Number.isFinite(since) ? { elapsed_ms: Math.max(0, now - since) } : {}),
  };
}

const isWaiting = (c) => [c.dispatch, c.accept, ...((c.child && c.child.nodes) || [])].some(waitingNode);

// One desk's state: acting (driver live), you (a card waits on a person), done, stalled (it was
// working and nothing is alive), idle (nothing moving now, e.g. between retries or not started).
function workState({ mark, waiting, live, stalled }) {
  if (waiting) return 'you';
  if (mark === 'done') return 'done';
  if (live) return 'acting';
  if (stalled && mark === 'running') return 'stalled';
  return 'idle';
}

// One state, one icon, one word. A live word (acting, you) is the driver's own `doing` text, blank when
// there is none; every other state has a fixed word and `word_key` (its state) for the pane to localize.
const MARKS = { acting: '●', you: '⚑', idle: '◌', done: '✔', stalled: '⊘', failed: '✘' };
const FIXED = { idle: 'idle', done: 'done', stalled: 'stalled', failed: 'failed' };
export function markOf(state, doing = '') {
  const live = state === 'acting' || state === 'you';
  return { icon: MARKS[state], word: live ? doing : FIXED[state], word_key: live ? '' : state };
}

// A STORY row's status is one fixed word for every state (acting and you too), never the driver's `doing`
// (that stays a field on the item; the Floor tab shows it). `word_key` is the state, for the pane to localize.
const ITEM_WORD = { ...FIXED, acting: 'working', you: 'needs you' };
const itemMarkOf = (state) => ({ icon: MARKS[state], word: ITEM_WORD[state], word_key: state });

// facts: { stories: { [id]: { live, doing, cost_usd, cost_estimated, run_file } }, judge: { live, doing }, ledger: [lines] }
// The STORY's own numbers (view-summary.mjs metrics()) carried on its item; null for a desk with none.
const NUMBERS = ['attempt', 'max_attempts', 'judge', 'cost_usd', 'retry_cost_usd', 'wall_ms', 'out_of_retries'];
const numbersOf = (s) => (s ? Object.fromEntries(NUMBERS.map((k) => [k, s[k] ?? null])) : null);

// `metrics` (summarize(model).metrics) is passed by a caller that already has it; else it is computed here.
export function floorOf(model, facts = {}, { now = Date.now(), metrics: given = null } = {}) {
  const m = model;
  const numbers = new Map(((given || metrics(m, { now })).stories || []).map((s) => [s.id, s]));
  const stalled = m.state === 'stalled' || (m.ticket && m.ticket.state === 'stalled');
  const taskMinutes = m.stall && m.stall.minutes;
  const epic = (m.ticket && m.ticket.key) || String(m.task_id || '');
  const story = (id) => (facts.stories && facts.stories[id]) || {};
  const verdicts = lastVerdicts(facts.ledger);
  const items = [];
  const workers = [];
  // a STORY desk works in the Phase of its card (a package is Build, a planning card Plan, a QA round QA)
  const add = (id, base, f, mark, waiting, phase = 'build', at = {}) => {
    // stalled with the whole task, or on its own: a silent worker beside a live one still reads stalled
    const state = workState({ mark, waiting, live: !!f.live, stalled: stalled || !!f.silent });
    const doing = state === 'acting' || state === 'you' ? (f.doing || '') : '';
    // minutes (integer) only on a stalled worker: its own stream's, else the task-level newest sign of life
    const minutes = state === 'stalled' ? (Number.isInteger(f.minutes) ? f.minutes : taskMinutes) : null;
    workers.push({ id, phase, state, doing, ...markOf(state, doing), ...(Number.isInteger(minutes) ? { minutes } : {}), ...(state === 'acting' || state === 'you' ? at : {}) });
    if (mark === 'done' || mark === 'pending') return;
    const itemState = mark === 'failed' && state !== 'you' ? 'failed' : state;
    items.push({
      ...base, state: itemState, doing, ...itemMarkOf(itemState),
      cost_usd: f.cost_usd ?? null, cost_estimated: !!f.cost_estimated,
      live: !!f.live || state === 'you', run_file: f.run_file ?? null,
      metrics: numbersOf(numbers.get(String(base.key).split(':')[0])),
    });
  };

  if (m.s_run || m.harness) {
    const id = 'S';
    const f = story(id);
    const mark = m.state === 'complete' ? 'done' : m.state === 'blocked' ? 'failed' : 'running';
    const waiting = (m.s_run ? m.s_run.nodes : []).some(waitingNode) || !!(m.harness && m.harness.waiting > 0);
    add(id, {
      key: epic, title: (m.ticket && m.ticket.title) || '', last_verdict: null, try: null, max: null,
      elapsed_ms: m.elapsed_ms ?? null, owner_key: epic,
    }, f, mark, waiting);
  } else {
    let plans = 0;
    for (const { c, state: mark, stage } of cardsOf(m)) {
      const id = String(c.id);
      const f = story(id);
      const t = tryOf(c);
      // one planning card is PLAN; several are PLAN, PLAN2, ... so worker ids stay distinct
      const label = c.phase === 'planning' ? `PLAN${++plans > 1 ? plans : ''}` : id;
      const v0 = verdicts[id.split(':')[0]];
      // only a settled card's verdict for its own attempt is its status (storyNow)
      add(label, {
        key: id, title: c.title || '', last_verdict: storyNow(m, c, v0).verdict, try: t.try, max: t.max,
        elapsed_ms: (c.dispatch && c.dispatch.elapsed_ms) ?? null,
        owner_key: c.ticket_key || `${epic}/${id.split(':')[0]}`,
      }, f, mark, isWaiting(c), stage, nodeNow(c, now));
    }
  }
  const judge = facts.judge || {};
  const judgeState = judge.live ? 'acting' : 'idle';
  const judgeDoing = judge.live ? (judge.doing || '') : '';
  workers.push({ id: 'judge', phase: 'gate', state: judgeState, doing: judgeDoing, ...markOf(judgeState, judgeDoing) });
  const pkgIds = cardsOf(m).map((x) => String(x.c.id).split(':')[0]);
  return { items, workers, handoffs: handoffs(facts.ledger, { limit: 5 }), phases: phaseCounts(workers), phase_handoffs: phaseHandoffs(facts.ledger, { pkgIds, limit: 5 }) };
}

// Per-Phase counts of the workers[] floorOf built, and nothing else: a stalled worker counts only with its
// integer `minutes` (F3's verdict), so no stall rule of this file's own can disagree with it.
// [{ key, workers, acting, you, stalled, idle, done }] for every Phase in run order.
export function phaseCounts(list) {
  return PHASES.map((key) => {
    const w = (list || []).filter((x) => x.phase === key);
    const n = (state) => w.filter((x) => x.state === state && (state !== 'stalled' || Number.isInteger(x.minutes))).length;
    return { key, workers: w.length, acting: n('acting'), you: n('you'), stalled: n('stalled'), idle: n('idle'), done: n('done') };
  });
}
