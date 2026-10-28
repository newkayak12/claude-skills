// Pure builder behind the floor part of `view.mjs --once --format summary` (the teams pane's
// STORYs and Floor tabs): one item per STORY at work, one worker per desk, the recorded hand-offs.
// No fs: view-floor-fs.mjs reads the streams, costs and run files and hands them in as `facts`;
// the ledger is read through view-events.mjs, which owns what a ledger line means.
import { cardsOf, waitingNode, metrics } from './view-summary.mjs';
import { handoffs, lastVerdicts } from './view-events.mjs';

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

// facts: { stories: { [id]: { live, doing, cost_usd, cost_estimated, run_file } }, judge: { live, doing }, ledger: [lines] }
// The STORY's own numbers (view-summary.mjs metrics()) carried on its item; null for a desk with none.
const NUMBERS = ['attempt', 'max_attempts', 'judge', 'cost_usd', 'retry_cost_usd', 'wall_ms', 'out_of_retries'];
const numbersOf = (s) => (s ? Object.fromEntries(NUMBERS.map((k) => [k, s[k] ?? null])) : null);

// `metrics` (summarize(model).metrics) is passed by a caller that already has it; else it is computed here.
export function floorOf(model, facts = {}, { now = Date.now(), metrics: given = null } = {}) {
  const m = model;
  const numbers = new Map(((given || metrics(m, { now })).stories || []).map((s) => [s.id, s]));
  const stalled = m.state === 'stalled' || (m.ticket && m.ticket.state === 'stalled');
  const epic = (m.ticket && m.ticket.key) || String(m.task_id || '');
  const story = (id) => (facts.stories && facts.stories[id]) || {};
  const verdicts = lastVerdicts(facts.ledger);
  const items = [];
  const workers = [];
  const add = (id, base, f, mark, waiting) => {
    const state = workState({ mark, waiting, live: !!f.live, stalled });
    const doing = state === 'acting' || state === 'you' ? (f.doing || '') : '';
    workers.push({ id, state, doing, ...markOf(state, doing) });
    if (mark === 'done' || mark === 'pending') return;
    const itemState = mark === 'failed' && state !== 'you' ? 'failed' : state;
    items.push({
      ...base, state: itemState, doing, ...markOf(itemState, doing),
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
    for (const { c, state: mark } of cardsOf(m)) {
      const id = String(c.id);
      const f = story(id);
      const t = tryOf(c);
      // one planning card is PLAN; several are PLAN, PLAN2, ... so worker ids stay distinct
      const label = c.phase === 'planning' ? `PLAN${++plans > 1 ? plans : ''}` : id;
      const v = verdicts[id.split(':')[0]];
      add(label, {
        key: id, title: c.title || '', last_verdict: v ? v.verdict : null, try: t.try, max: t.max,
        elapsed_ms: (c.dispatch && c.dispatch.elapsed_ms) ?? null,
        owner_key: c.ticket_key || `${epic}/${id.split(':')[0]}`,
      }, f, mark, isWaiting(c));
    }
  }
  const judge = facts.judge || {};
  const judgeState = judge.live ? 'acting' : 'idle';
  const judgeDoing = judge.live ? (judge.doing || '') : '';
  workers.push({ id: 'judge', state: judgeState, doing: judgeDoing, ...markOf(judgeState, judgeDoing) });
  return { items, workers, handoffs: handoffs(facts.ledger, { limit: 5 }) };
}
