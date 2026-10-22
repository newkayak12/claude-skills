// A running STORY's question to its TeamLeader (card 49 part C; design
// _repo/docs/plans/mod/2026-10-17-subagent-communication.md §6, PRD rules D1-D8). Pure: no fs,
// no process, no network - the engine (P2) writes the events this module builds and the Floor /
// readers (P3) read them. THIS module owns the contract below; neither side re-types it.
//
// Ledger events (one JSON line each, written by P2, read by P3). `question` and `answer` are
// verbatim - never clipped, trimmed or reflowed - so a reader may truncate for display, the
// ledger never does. `ask_id` is the same value on the pair; `key` is the STORY key
// (`E-<run_id[0:8]>/<pkgId>`); `node_id` is the asking STORY's dispatch node.
//
//   asked:    { event: 'asked',    task_id, key, node_id, question, ask_id }
//   answered: { event: 'answered', task_id, key, node_id, answer, by, route, ask_id }
//             by    'teamleader' | 'person'
//             route 'answer'  - the answer node answered from the plan and wiki
//                   'forward' - the question went to the person; the answer is theirs
//
// parseVerdict() is how a question is never dropped (D7): anything but a well-formed answer
// verdict is a forward.
import { randomUUID } from 'node:crypto';

export const ASK_BY = ['teamleader', 'person'];
export const ASK_ROUTE = ['answer', 'forward'];

// A UUID's characters are all [0-9a-f-]: safe on a ledger line and in a key.
export function newAskId() {
  return randomUUID();
}

function need(fn, obj, fields) {
  const o = obj || {};
  for (const f of fields) {
    if (typeof o[f] !== 'string' || o[f] === '') throw new Error(`${fn}: ${f} is required`);
  }
  return o;
}

export function askedEvent(input) {
  const { task_id, key, node_id, question, ask_id } = need('askedEvent', input, ['task_id', 'key', 'node_id', 'question', 'ask_id']);
  return { event: 'asked', task_id, key, node_id, question, ask_id };
}

export function answeredEvent(input) {
  const { task_id, key, node_id, answer, ask_id, by, route } = need('answeredEvent', input, ['task_id', 'key', 'node_id', 'answer', 'ask_id', 'by', 'route']);
  if (!ASK_BY.includes(by)) throw new Error(`answeredEvent: by must be one of ${ASK_BY.join('|')}`);
  if (!ASK_ROUTE.includes(route)) throw new Error(`answeredEvent: route must be one of ${ASK_ROUTE.join('|')}`);
  return { event: 'answered', task_id, key, node_id, answer, by, route, ask_id };
}

// The instruction of the answer node: a fresh `claude -p` holding read tools only, like a judge
// node. The pointers are paths/hints the caller resolves; this builder reads nothing.
export function answerPrompt({ question, planPath, wikiHint } = {}) {
  if (typeof question !== 'string' || question.trim() === '') throw new Error('answerPrompt: question is required');
  return [
    'A STORY driver working on this task has a question. You answer it as the TeamLeader, or you forward it to the person. You do not guess.',
    '',
    'Question (verbatim):',
    '<<<',
    question,
    '>>>',
    '',
    'Sources - the only ones you may use:',
    `- The plan: ${planPath || '(no plan path given - look under the task docs dir)'}`,
    `- The wiki: ${wikiHint || '(no hint given - search it by the words of the question)'}`,
    '',
    'Tools: Read, Grep, Glob, wiki_search and wiki_get only. They are read-only. No file may be written and no other tool used.',
    '',
    'Answer only from the plan and the wiki. If they state the answer, give it, with the section or page it comes from. If they do not settle the question, or you would have to assume, forward it.',
    '',
    'Reply with one JSON object and nothing else - no prose before or after it:',
    '{"verdict":"answer","answer":"..."}',
    '{"verdict":"forward","reason":"..."}',
  ].join('\n');
}

const FORWARD = (reason) => ({ verdict: 'forward', reason });
const MARKER = /\b(time(?:d)?[ -]?out|crash(?:ed)?|killed|spawn failed|exited \d+)\b/i;

function jsonOf(text) {
  const t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  return JSON.parse(fence ? fence[1].trim() : t);
}

// raw: the answer node's output - a string, or the adapter's result object when it carries a
// failure marker. Never throws.
export function parseVerdict(raw) {
  try {
    if (raw && typeof raw === 'object') {
      if (raw.timedOut || raw.crashed || raw.ok === false || raw.error) return FORWARD('the answer node crashed or timed out');
      raw = raw.text ?? raw.result ?? raw.output;
    }
    if (typeof raw !== 'string' || raw.trim() === '') return FORWARD('the answer node returned nothing');
    let v;
    try { v = jsonOf(raw); } catch {
      return FORWARD(MARKER.test(raw) ? 'the answer node crashed or timed out' : 'the answer node returned no JSON verdict');
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return FORWARD('the verdict is not a JSON object');
    if (v.verdict === 'answer') {
      if (typeof v.answer === 'string' && v.answer.trim() !== '') return { verdict: 'answer', answer: v.answer };
      return FORWARD('the answer verdict has no answer text');
    }
    if (v.verdict === 'forward') return FORWARD(typeof v.reason === 'string' && v.reason.trim() ? v.reason : 'the answer node forwarded');
    return FORWARD('unknown verdict');
  } catch {
    return FORWARD('the verdict could not be read');
  }
}

// A STORY may ask only from inside its own running dispatch. Input is exactly {task, key,
// question}: no sibling, driver or target field exists, and any other field is ignored. The key
// shape and the "running" reading mirror tickets.mjs (storyKey, latestBySubgoal,
// storyTicketState) - re-stated here because tickets.mjs reads files and this module may not.
export function validateAsk(input) {
  const { task, key, question } = input || {};
  if (typeof question !== 'string' || question.trim() === '') return { ok: false, reason: 'question is empty' };
  const m = typeof key === 'string' ? /^E-([0-9a-f]{8})\/([^/]+)$/.exec(key) : null;
  if (!m) return { ok: false, reason: 'key is not a STORY key (E-xxxxxxxx/<package>)' };
  const taskId = task && (task.run_id || task.id);
  if (!taskId || String(taskId).slice(0, 8) !== m[1]) return { ok: false, reason: 'key is not a STORY of this task' };
  const pkgId = m[2];
  const list = (Array.isArray(task.nodes) ? task.nodes : []).filter((n) => n.subgoal_id === pkgId && n.stage === 'dispatch');
  const dispatch = list.length ? list[list.length - 1] : null;
  if (!dispatch) return { ok: false, reason: `no STORY ${pkgId} in this task` };
  if (dispatch.state !== 'running') return { ok: false, reason: `STORY ${pkgId} is not running (${dispatch.state})` };
  return { ok: true, key, pkgId };
}
