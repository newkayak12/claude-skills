// storyanswer.mjs - toolAnswer, the one path a waiting card is answered by through the tm_answer tool and
// scripts/answer.mjs: it checks who is answering, then runs the code tm_submit runs (toolSubmit).
import { mustFindTask } from './taskmanager-stages.mjs';
import { toolSubmit } from './taskmanager-claims.mjs';
import { epicKey, parseTicketKey } from './tickets.mjs';

const no = (reason) => ({ ok: false, reason });

// `Pn` or `E-xxxxxxxx/Pn` -> `Pn`, the package id.
const storyPart = (k) => String(k).replace(/^E-[0-9a-f]{8}\//, '');

// Only a package the task has, spelled exactly (P1, PLAN-F1, ...); a full key must name this task's EPIC.
const packageOf = (task, who) => {
  const id = who.startsWith(`${epicKey(task.run_id)}/`) ? storyPart(who) : who;
  const has = ((task.spec && task.spec.packages) || []).some((p) => p.id === id)
    || task.nodes.some((n) => n.stage === 'dispatch' && n.subgoal_id === id);
  return has ? id : null;
};

// `by` is who answers: absent, 'person', 'teamleader' or a STORY key, as the caller claims it. A driver (its
// env names its task, TEAMS_ASK_TASK_ID, as bus.mjs reads it) must name a STORY; a STORY may not answer a card
// of its own: anything in its child run (E-x/Pn...), or a TASK card asked by it or opened for its package.
// Returns { ok: true, key, node_id, state } or { ok: false, reason }; a refusal writes nothing.
export function toolAnswer({ task_id, key, decisions, by } = {}, env = process.env) {
  let task = null;
  try { task = mustFindTask({ task_id }); } catch { /* toolSubmit refuses it in its own words */ }
  if (task && !Array.isArray(task.nodes)) return no(`${task_id} has no nodes yet: nothing to answer`);

  const who = by === undefined || by === null ? '' : String(by);
  const role = who === '' || who === 'person' || who === 'teamleader';
  const pkg = !role && task ? packageOf(task, who) : null; // no task: toolSubmit refuses below
  if (!role && task && !pkg) return no(`by must be person, teamleader or a STORY key (Pn or E-xxxxxxxx/Pn), got "${who}"`);
  if (role && env && env.TEAMS_ASK_TASK_ID) return no('a driver must pass its own STORY key as by: it may not answer with no by, as person or as teamleader');

  // Read the key the way toolSubmit does: TASK/<node_id> is a node of this task, <Pn>/... a card in Pn's child run.
  const parsed = parseTicketKey(key);
  if (pkg && parsed) {
    const card = parsed.pkgId === 'TASK' ? task.nodes.find((n) => n.node_id === parsed.subgoalId) : null;
    const own = parsed.pkgId === pkg
      || (card && (storyPart(card.story_key) === pkg || card.subgoal_id === pkg));
    if (own) return no(`a driver may not answer its own ask: ${key} belongs to ${pkg}`);
  }

  try {
    const r = toolSubmit({ task_id, key, payload: decisions === undefined ? {} : { decisions } });
    return { ok: true, key: r.key, node_id: r.node_id, state: r.state };
  } catch (e) {
    return no(String((e && e.message) || e));
  }
}
