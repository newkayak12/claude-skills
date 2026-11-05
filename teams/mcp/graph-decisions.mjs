// graph-decisions.mjs - decisions and the `ask` card (cut from graph.mjs).
//
// What a person has already decided (answeredDecisions, task.decisions), how an execution-phase
// question is routed, and openAsk, the one place the graph stops and asks. Builds on
// graph-nodes.mjs (node) only.

import { node } from './graph-nodes.mjs';

// The one place this graph stops and asks a person. `investigate` (0.26.0) names what no source
// could answer; until now every one of those went into the document as an open question and the
// run finished without ever having asked anybody. An unknown whose owner is a person and whose
// answer is a choice between named candidates is not a gap in the research - it is a decision
// waiting on someone, and a plan that ships it unasked is a plan that decided by default.
//
// Shape: `ask:<subgoal>:<attempt>` (one per distinct owner - see the grouping below) sits
// between investigate and whatever consumed it (draft), carrying `questions[]` straight from
// investigate's own unknowns. It is born with the same
// human pin applyHumanPin writes, so promoteWaitingHuman parks it in `waiting_human` the moment
// its dep is done and NOTHING here polls a model for it - tm_inbox is the only reader,
// tm_submit({key}) the only writer, exactly as for a pinned author stage (0.27.3). That is why
// this needed no new state, no new inbox and no new resume path: the human-card machinery was
// already there, and an asked decision is just another card.
//
// Only inserted when the run is `interactive`. v0.13.0's default (interactive: false) is to
// decide automatically and record what it WOULD have asked - broker.mjs keeps those on
// run.unasked so the report can show the questions nobody answered, which reads better than a
// document quietly full of assumptions.
// D2 slice 3 (0.29.0, _repo/docs/plans/2026-09-23-teams-reducer-human-rollback.md §1): `questions[]`
// is no longer investigate's `unknowns[]` alone - any judging/deciding stage's own contract
// (setgoal, plan, critique, shape, gate, accept, gate:goal, a QA cases set) may return the same
// shape ({question, to/owner, options?, default, why}), and the engine treats it identically.
// Two relaxations from the investigate-only version made that possible:
// - decidability no longer requires >1 named options: a question with a stated `default` is
//   decidable on its own (the non-interactive path needs exactly that to auto-decide), options
//   remain how a person is offered more than the default to pick from.
// - the card's owner key falls back to the node's own node_id when it has no subgoal_id - every
//   run/task-level judging node (setgoal, plan, critique, gate:goal, and shape/accept/integrate
//   at the manager layer) has none, and investigate was the only stage with one to begin with.
// Every decision a person has already made for this owner (a subgoal id, or a manager node's own
// id - the same key openAsk uses), read off the `ask` nodes themselves. Superseded attempts are
// included on purpose: an answer does not stop being an answer because the attempt that asked for
// it was retried. Read by openAsk (never ask twice) and by nodeBriefing (so the stage writing the
// next round of questions knows what is settled).
// owner === undefined: every decision a person made anywhere in this run, each tagged with the
// owner it was made for. A decision is the run's, not one subgoal's: idol-beta-ask1 asked the
// fan-club tier question under U1 (multi-tier), then again under U2 and U3 (single tier) - each
// investigate only saw its own owner's settled answers, and the documents came out contradicting.
export function answeredDecisions(run, owner) {
  const out = [];
  const seen = new Set();
  for (const x of run.nodes) {
    if (x.stage !== 'ask') continue;
    // ask_owner since 0.29.2; fall back to subgoal_id for a card written before it existed.
    const own = String(x.ask_owner || x.subgoal_id || '');
    if (owner !== undefined && own !== String(owner)) continue;
    for (const d of (x.result && x.result.decisions) || []) {
      if (!d || !d.question || seen.has(d.question)) continue;
      seen.add(d.question);
      out.push(owner === undefined ? { ...d, decided_for: own } : d);
    }
  }
  return out;
}

// ---------- task.decisions (_repo/docs/plans/2026-09-28-teams-light-plan.md §6) ----------
//
// answeredDecisions is scoped to ONE run, and PLAN and every package are separate runs - so a
// decision PLAN's ask settled reached no package, and each package's investigate either
// rediscovered it or asked it again (the cross-run version of idol-beta-ask1's cross-attempt
// bug). task.decisions is the task-level list those runs share: written by tm_open (a session
// brainstorm), the engine's own `brainstorm` node, and accept:PLAN's fold, then snapshotted into
// every child run as run.task_decisions. One entry shape everywhere:
// {question, chose, because?, owner, decided_in, source}.

// What an unasked record decided: its stated default, else its recommended (first) option - the
// same reading nodeBriefing's default_decisions has always used.
export function chosenOf(u) {
  if (!u) return '';
  if (u.decided != null) return typeof u.decided === 'string' ? u.decided : JSON.stringify(u.decided);
  if (u.default != null) return typeof u.default === 'string' ? u.default : JSON.stringify(u.default);
  const first = Array.isArray(u.options) && u.options.length ? u.options[0] : null;
  return first == null ? '' : String((first && first.option) || first);
}

export function normalizeDecision(d, defaults = {}) {
  if (!d || typeof d !== 'object') return null;
  const question = String(d.question || d.unknown || '').trim();
  const chose = d.chose != null ? (typeof d.chose === 'string' ? d.chose : JSON.stringify(d.chose)) : chosenOf(d);
  if (!question || !String(chose).trim()) return null;
  return {
    question,
    chose: String(chose),
    ...(d.because ? { because: String(d.because) } : {}),
    owner: d.owner != null ? d.owner : (defaults.owner != null ? defaults.owner : null),
    decided_in: d.decided_in || defaults.decided_in || null,
    source: d.source || defaults.source || null,
  };
}

// Appends onto `list` (task.decisions), exact-question dedup: the first answer to a question is
// the task's answer. Returns what was actually added.
export function appendDecisions(list, entries, defaults = {}) {
  const seen = new Set(list.map((d) => d.question));
  const added = [];
  for (const raw of entries || []) {
    const d = normalizeDecision(raw, defaults);
    if (!d || seen.has(d.question)) continue;
    seen.add(d.question);
    list.push(d);
    added.push(d);
  }
  return added;
}

// §6.2-1: what a finished PLAN child run settled - every person's answer on its ask cards (all
// owners) plus every question it decided by default because nobody was asked.
export function planDecisions(planRun) {
  if (!planRun) return [];
  const out = [];
  appendDecisions(out, answeredDecisions(planRun).map((d) => ({ ...d, owner: d.owner || d.decided_for || null })), { decided_in: 'PLAN', source: 'ask' });
  appendDecisions(out, (planRun.unasked || []).filter((u) => u && u.question), { decided_in: 'PLAN', source: 'default' });
  return out;
}

// Every decision this run must treat as settled: its own ask cards' answers, then the task's.
export function settledDecisions(run) {
  const out = answeredDecisions(run);
  const seen = new Set(out.map((d) => d.question));
  for (const d of run.task_decisions || []) {
    if (!d || !d.question || seen.has(d.question)) continue;
    seen.add(d.question);
    out.push({ ...d, decided_for: `task${d.decided_in ? `/${d.decided_in}` : ''}${d.source ? ` (${d.source})` : ''}` });
  }
  return out;
}

// §6.2-3: a question raised inside an execution-phase run (run.execution_phase) is not put to a
// person on that run's own card. It is decided by default and recorded (run.unasked) - unless it
// is blocking, by one of two structural tests, never a model's judgement:
//   (a) the stage set `contradicts_decision` on it - it says, in a field, that a settled
//       decision does not hold;
//   (b) there is no safe default - at most one option and no `default` (the very questions
//       openAsk's own filter silently drops).
// Blocking questions are kept on run.blocking_questions for the task manager, which parks them
// once at EPIC level (taskmanager.mjs's escalateBlocking). A question already settled
// (settledDecisions) is dropped outright unless it is itself a contradiction.
export function routeExecutionQuestions(run, n, questions) {
  const settled = new Set(settledDecisions(run).map((d) => d.question));
  const blocking = [];
  const decided = [];
  for (const q of questions || []) {
    const text = q && String(q.question || q.unknown || '').trim();
    if (!text) continue;
    const contradicts = typeof q.contradicts_decision === 'string' && q.contradicts_decision.trim() ? q.contradicts_decision.trim() : null;
    if (!contradicts && settled.has(text)) continue;
    const hasOptions = Array.isArray(q.options) && q.options.length > 1;
    const hasDefault = q.default !== undefined && q.default !== null;
    const base = { subgoal_id: n.subgoal_id, node_id: n.node_id, stage: n.stage, question: text, owner: q.to || q.owner || null, options: q.options || null, why: q.why || null };
    if (contradicts || (!hasOptions && !hasDefault)) {
      blocking.push({ ...base, ...(hasDefault ? { default: q.default } : {}), ...(contradicts ? { contradicts_decision: contradicts } : {}), blocking: contradicts ? 'contradicts_decision' : 'no_safe_default' });
    } else {
      decided.push({ ...base, decided: hasDefault ? q.default : null });
    }
  }
  if (decided.length) run.unasked = [...(run.unasked || []), ...decided];
  if (blocking.length) {
    const have = new Set((run.blocking_questions || []).map((b) => b.question));
    run.blocking_questions = [...(run.blocking_questions || []), ...blocking.filter((b) => !have.has(b.question) && have.add(b.question))];
  }
  return { decided, blocking };
}

// opts (§6.2-4, task-layer escalation only): `owner` replaces the subgoal/node owner key and
// `attempt` its attempt number, so a card can stand for the EPIC rather than one package;
// `blocking: true` keeps a question with no options and no default, which is exactly what makes
// it blocking - the default filter below would drop it.
// `story: {ask_id, key}` (card 49 part C) is a running STORY's forwarded question: it is stamped on
// the card (ask_id, story_key), is never filtered as already settled (a question is never dropped),
// and leaves `n`'s consumers alone - the STORY's dispatch node is still what they wait on, the card
// only holds its parked driver.
export function openAsk(run, n, questions, opts = {}) {
  if (!n) return [];
  let qs = (questions || []).filter((q) => q && (q.question || q.unknown)
    && (opts.blocking === true || (Array.isArray(q.options) && q.options.length > 1) || q.default !== undefined));
  if (!qs.length) return [];
  const attempt = opts.attempt || n.attempt || 1;
  const owner = opts.owner || n.subgoal_id || n.node_id;
  if (run.nodes.some((x) => x.node_id === `ask:${owner}:${attempt}`)) return [];
  // A question a person already answered on an earlier attempt of this same owner is settled, and
  // asking it again is asking them to decide twice. idol-beta-ask1 (2026-09-25) measured it: U4's
  // draft failed twice, its third investigate raised six questions, and two were byte-identical to
  // ones answered on ask:U4:1 - a node the retry superseded, so nothing downstream knew. Exact
  // match only, because the engine stored both strings itself and needs no judgement to compare
  // them. The other four were rewordings of the same decisions, which no string filter can catch -
  // that is why answeredDecisions also reaches the next attempt's own briefing (nodeBriefing):
  // the stage that writes the question is the one that should know it is already decided.
  // run.task_decisions joins the set (§6.2-2): a question the task already settled - in the
  // session, in the engine's brainstorm, in PLAN - is as answered here as one this run's own
  // card answered.
  const story = opts.story || null;
  const settled = new Set(settledDecisions(run).map((d) => d.question));
  if (settled.size && !story) {
    qs = qs.filter((q) => !settled.has(q.question || q.unknown));
    if (!qs.length) return [];
  }
  // Whoever consumed the node now consumes the answers instead. Order-only (`after`) edges
  // count as consumers too, not just data (`deps`) ones - gate:goal's only downstream is
  // `report` via `after` (expandSubgoals leaves the subgoal gates as `after`, not `deps`, once
  // `reduce` takes the data edge), and a report written before a gate:goal question is settled
  // would omit the very decision it is meant to state as a rule.
  const consumers = run.nodes.filter((x) => (x.deps || []).includes(n.node_id) || (x.after || []).includes(n.node_id));

  // One card per owner, not one card per subgoal. The first real interactive run (idol-beta-ask1,
  // 2026-09-24) came back with seven questions on one card owned by five different roles - the PO,
  // a capacity lead, Legal/Finance, SRE and Security - addressed to whichever happened to be first.
  // Nobody can answer that card: it is five people's work in one envelope, and the design this
  // came from is explicit that a checkpoint without a named owner is where the pattern breaks
  // (_repo/docs/plans/2026-09-23-teams-reducer-human-rollback.md §0'). Grouped in first-appearance
  // order so the leading card stays `ask:<sg>:<attempt>` and reads the same as before whenever
  // there is only one owner - which is the common case and every test written before this.
  const groups = new Map();
  for (const q of qs) {
    // `to` is the generalized contract's field name (_repo/docs/plans/2026-09-23-teams-reducer-
    // human-rollback.md §1); `owner` is investigate's own, kept so its existing unknowns[]
    // still group exactly as before.
    const key = (typeof q.to === 'string' && q.to.trim()) || (typeof q.owner === 'string' && q.owner.trim()) || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }
  const ids = [];
  let i = 0;
  for (const [who, groupQs] of groups) {
    // `ask:U1:1`, `ask:U1:1b`, `ask:U1:1c` - the same suffixing pushGoalGateRound uses for
    // sibling judges, so nothing downstream has to learn a second id shape.
    const askId = `ask:${owner}:${attempt}${i === 0 ? '' : String.fromCharCode(97 + i)}`;
    run.nodes.push(node(askId, 'ask', [n.node_id], {
      subgoal_id: n.subgoal_id,
      // The key this card's questions belong to - a subgoal id, or a manager node's own id when
      // the asking stage has no subgoal (0.29.0). Stored rather than re-derived: the card's own
      // node_id is `ask:<owner>:<attempt>`, so reading the owner back out of it would mean
      // parsing, and answeredDecisions has to match it exactly across attempts.
      ask_owner: String(owner),
      ...(story ? { ask_id: story.ask_id, story_key: story.key } : {}),
      attempt,
      questions: groupQs,
      assignment: { executor: 'human', vendor: 'human', who: who || null, reason: `a decision no source could answer (${n.stage} questions)` },
      // Parked here rather than left for promoteWaitingHuman to find on the next team_next. Its
      // one dep is the node whose own submission is creating it, so it is ready by construction -
      // and a card that only becomes visible once somebody polls is a card tm_inbox cannot be
      // trusted to list.
      state: 'waiting_human',
      waiting_since: Date.now(),
    }));
    ids.push(askId);
    i += 1;
  }
  // The consumer waits for every owner: work written while one of them is still deciding would
  // carry that decision as an open question and the answer would arrive too late to be a rule.
  // Rewired into whichever list originally named the node - a data (`deps`) consumer stays a
  // data consumer, an order-only (`after`) one stays order-only.
  for (const c of story ? [] : consumers) {
    if (c.deps.includes(n.node_id)) c.deps = [...c.deps.filter((d) => d !== n.node_id), ...ids];
    if ((c.after || []).includes(n.node_id)) c.after = [...c.after.filter((d) => d !== n.node_id), ...ids];
  }
  return ids;
}
