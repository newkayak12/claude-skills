// test-planning.mjs - test support: drive the planning every task now runs.
//
// docs/plans/2026-09-28-teams-cards-everywhere.md makes planning unconditional (C5: roles.planning
// false is refused; C6: size S plans too): every task runs size -> areas -> one planning card per
// feature area (each a full-harness child run) -> plan-integrate before shape can run, and shape's
// packages must implement every merged user story. The suites that drive a task by hand were
// written against a graph where size fed shape directly. Rather than hand-copy the planning drive
// into every one of those tests, their MCP client runs `beforeTmCall` ahead of each tool call: a
// tm_submit of a shape node first drives whatever planning is still open (exactly the calls a
// real run's daemon and card drivers make, through the real broker), and a shape payload that
// declares no implements[]/enables[] at all gets the merged stories spread over its packages.
// A test ABOUT planning drives it explicitly (drivePlanning, or node by node) and declares its
// own implements[] - both hooks stand aside for it.

export const okPayload = (payload) => ({ stage_ok: true, evidence: 'e', checks: ['ok -> looked fine'], attacks: ['ok -> looked fine from outside'], ...payload });

// One planning card's child run, driven through the broker to its report: whatever team_next
// offers, answered the way a passing node would. Light cards (investigate -> template-fill ->
// gate) and full ones (investigate -> draft -> revise -> gate) both go through this one loop.
export async function completePlanningChild(g, child, stories, opts = {}) {
  const { run_id, cwd } = child;
  const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: okPayload(payload) });
  for (let guard = 0; guard < 40; guard++) {
    const nx = await g.call('team_next', { run_id, cwd });
    if (!nx || nx.state !== 'running' || !(nx.ready || []).length) return nx;
    for (const r of nx.ready) {
      const id = r.node_id;
      if (id === 'plan') await sub(id, { handoff: 'p', flow: 'plan', size: 'S' });
      else if (id.startsWith('setgoal')) await sub(id, { spec: { goal: 'PRD', acceptance: ['PRD covers the request'], subgoals: [{ id: 'U1', title: 'draft PRD', acceptance: ['PRD written'], deps: [] }] } });
      else if (id.startsWith('critique')) await sub(id, { sound: true });
      else if (id.startsWith('gate:goal')) await sub(id, { accept: opts.accept !== false, match_pct: opts.accept === false ? 40 : 95, user_stories: stories, ...(opts.accept === false ? { gaps: ['short'], reason: 'short' } : {}) });
      else if (id.startsWith('gate:')) await sub(id, { accept: true, match_pct: 95 });
      else if (id === 'report' || id.startsWith('report:')) await sub(id, { handoff: 'PRD complete' });
      else if (id.startsWith('reduce')) await sub(id, { undeclared: [], collisions: [], orphans: [], repairs_needed: [] });
      else await sub(id, { changed_files: [], handoff: `${r.stage || id} done` });
    }
  }
  throw new Error(`planning child ${run_id} did not finish`);
}

// The stories a card returns: opts.stories as an array (every card the same), a function of the
// card id, or by default two per card with the card's area prefix - F1-US-1, F1-US-2 - which is
// what the card contract asks for, so two cards never collide.
function storiesFor(cardId, opts) {
  if (typeof opts.stories === 'function') return opts.stories(cardId);
  if (Array.isArray(opts.stories)) return opts.stories;
  const f = String(cardId).replace(/^PLAN-/, '');
  return [`${f}-US-1`, `${f}-US-2`];
}

// Drives every open planning step of one task until its planning integrate is done: the areas
// split (opts.areas, default one area), each planning card's child run, dispatch and accept, then
// plan-integrate. `call` is a tool caller that does NOT re-enter beforeTmCall.
// Returns the task as tm_status full reads it, plus `plan_integrate_reply`: the tm_submit reply
// of the planning integrate this call accepted - for a size-S task, the reply that opened its run.
export async function drivePlanning(call, g, task_id, opts = {}) {
  let reply = null;
  for (let guard = 0; guard < 60; guard++) {
    const task = await call('tm_status', { task_id, full: true });
    if (task && Array.isArray(task.nodes) && task.nodes.some((n) => n.stage === 'plan-integrate' && n.state === 'done')) return { ...task, plan_integrate_reply: reply };
    if (task && task.s_run) return { ...task, plan_integrate_reply: reply };
    const nx = await call('tm_next', { task_id });
    let progressed = false;
    for (const c of nx.children || []) {
      if (!/^PLAN-/.test(String(c.package_id))) continue;
      if (c.child_state === 'running' || c.child_state === 'waiting_human') {
        for (let turn = 0; turn < 6; turn++) {
          const st = await completePlanningChild(g, c, storiesFor(c.package_id, opts), opts.child || {});
          if (!st || st.state !== 'waiting_human') break;
          // A card of this planning card's own chain parked for a person (human_gates, or an
          // ask): answered the way a passing person would - accept a gate, take an ask's default.
          await answerCards(call, task_id, c.package_id);
        }
      }
      await call('tm_submit', { task_id, node_id: c.node_id });
      progressed = true;
    }
    for (const r of nx.ready || []) {
      if (r.stage === 'areas') {
        await call('tm_submit', { task_id, node_id: r.node_id, payload: okPayload({ areas: opts.areas || [{ id: 'F1', title: 'the request', brief: 'everything the request asks for' }], handoff: 'areas' }) });
      } else if (r.stage === 'accept' && /^accept:PLAN-/.test(r.node_id)) {
        await call('tm_submit', { task_id, node_id: r.node_id, payload: okPayload({ accept: true, match_pct: 95 }) });
      } else if (r.stage === 'plan-integrate') {
        reply = await call('tm_submit', { task_id, node_id: r.node_id, payload: okPayload({ accept: true, duplicates: [], contradictions: [], uncovered: [] }) });
      } else continue;
      progressed = true;
    }
    if (!progressed) {
      throw new Error(`planning is stuck for ${task_id}: ready ${JSON.stringify((nx.ready || []).map((r) => r.node_id))}, children ${JSON.stringify((nx.children || []).map((c) => c.node_id))}`);
    }
  }
  throw new Error(`planning did not finish for ${task_id}`);
}

async function answerCards(call, task_id, cardId) {
  const inbox = await call('tm_inbox', { task_id });
  for (const card of (inbox && inbox.cards) || []) {
    if (!String(card.key || '').includes(`/${cardId}/`)) continue;
    const payload = card.stage === 'ask'
      ? { stage_ok: true, decisions: (card.questions || []).map((q) => ({ question: q.question, chose: q.default || ((q.options || [])[0] || {}).option || 'default' })) }
      : { accept: true, reason: 'accepted by the test harness' };
    await call('tm_submit', { task_id, key: card.key, payload });
  }
}

// The merged stories, read the way the engine reads them (tickets.mjs's planningStories).
export async function mergedStoryIds(call, task_id) {
  const { planningStories } = await import('../../mcp/tickets.mjs');
  const task = await call('tm_status', { task_id, full: true });
  return planningStories(task).map((u) => String((u && typeof u === 'object') ? (u.id || '') : u)).filter(Boolean);
}

// Spreads the stories over a shape's packages, story j to package j % n, when the shape declared
// no implements[] or enables[] anywhere - a test about shape coverage declares its own and is
// left exactly as written.
export function fillImplements(payload, stories) {
  if (!payload || !Array.isArray(payload.packages) || !payload.packages.length || !stories.length) return payload;
  if (payload.packages.some((p) => p && ((Array.isArray(p.implements) && p.implements.length) || (Array.isArray(p.enables) && p.enables.length)))) return payload;
  // Every story to some package, and every package at least one story (more packages than stories
  // wrap around) - shape's coverage rule refuses both a story nobody implements and a package that
  // implements nothing.
  const packages = payload.packages.map((p, i) => ({ ...p, implements: [stories[i % stories.length]] }));
  stories.forEach((s, j) => { const p = packages[j % packages.length]; if (!p.implements.includes(s)) p.implements.push(s); });
  return { ...payload, packages };
}

// The hook each suite's client runs before a tool call. `client.rawCall` is the unhooked call;
// `getBroker()` returns a broker client (the suite's own, or one the client spawns and owns).
export async function beforeTmCall(client, name, args, getBroker) {
  if (name !== 'tm_submit' || !args || args.key || !/^shape(:\d+)?$/.test(String(args.node_id || ''))) return args;
  const call = (n, a) => client.rawCall(n, a);
  let task = await call('tm_status', { task_id: args.task_id, full: true });
  if (!task || !Array.isArray(task.nodes)) return args;
  const planned = task.nodes.some((n) => n.stage === 'plan-integrate' && n.state === 'done');
  const splitOpen = task.nodes.some((n) => n.stage === 'areas' && n.state === 'pending') || task.nodes.some((n) => n.stage === 'plan-integrate');
  if (!planned && splitOpen && !task.s_run) task = await drivePlanning(call, await getBroker(), args.task_id);
  if (!args.payload) return args;
  const stories = await mergedStoryIds(call, args.task_id);
  return { ...args, payload: fillImplements(args.payload, stories) };
}
