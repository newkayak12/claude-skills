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
// Bus (card 126, bus.mjs): the question is also a bus line {from: key, to: 'teamleader'} and the answer
// a line {from: by, to: key, reply_to: <question ts>}. The ledger events above are unchanged; the
// task.story_asks entry records the ts of both lines as `question_ts` and `answer_ts`.
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

// ---------- evidence asks: questions the engine answers itself (storyevidence.mjs reads) ----------
//
// A question is classified only when every sentence of it names at least one of the three kinds and,
// with the kind phrases taken out, holds nothing but the FILLER words below. A whitelist: a
// decision, opinion or plan question (should, which, why, approve, "X or Y", ...) or any further
// request leaves a word that is not on it. A judgement can be worded from filler alone, so each
// sentence must also read as a request (REQUEST) and must not open as a yes/no question (YES_NO).
// A miss costs a person's answer, as before; a false hit would silently answer a decision, so a
// doubt is null.
const EVENT = '(?:[a-z]+(?:_[a-z]+)+|asked|answered)';
const EVIDENCE = [
  { kind: 'process_count', match: [
    /\b(?:how many|(?:number|count) of)\s+(?:teams\s+)?(?:mcp\/)?server(?:\.mjs)?\s+processes\b/g,
    /\b(?:teams\s+)?(?:mcp\/)?server(?:\.mjs)?\s+process\s+count\b/g,
  ] },
  { kind: 'ledger_lines', match: [new RegExp(`(?:\\b${EVENT}(?:(?:\\s*,\\s*|\\s+and\\s+)${EVENT})*\\s+)?\\bledger(?:\\.jsonl)?\\s+lines?\\b`, 'g')],
    also: [/\bfrom\s+(?:the\s+)?ledger\.jsonl\b/g, /\bts\b/g, /\b\d{13}\b/g] },
  { kind: 'cost_by_stage', match: [/\b(?:by[_ -]stage\s+(?:cost|spend)|(?:cost|spend)\s+by[_ -]stage)\b/g],
    also: [/\bfrom\s+drivercost\.mjs(?:\s+taskfigure(?:\s+plus\s+costbystage)?)?/g] },
];
const FILLER = new Set(('please give send show tell me us i we need needs the a an of now currently current running '
  + 'are is there verbatim from so far and this task live').split(' '));
const WHAT_IS = /^\s*what\s+(?:is|are)\b/; // the one place "what" is allowed
const REQUEST = [/\b(?:give|send|show|tell|how many|(?:number|count) of)\b/, /^\s*p\d+\s+needs?\b/, WHAT_IS, /^\s*(?:is|are)\s+there\b/];
const YES_NO = /^[^\p{L}\p{N}]*(?:(?:and|so|now|p\d+)[^\p{L}\p{N}]+)*(?:is|are|does|do|did|was)\b(?!\s+there\b)/u;

export function evidenceKinds(question) {
  if (typeof question !== 'string') return null;
  const sentences = question.toLowerCase().split(/(?<=[.?!;])\s+|\n+/).filter((s) => s.trim() !== '');
  const found = new Set();
  for (const sentence of sentences) {
    const hit = EVIDENCE.filter((k) => k.match.some((re) => sentence.search(re) !== -1));
    if (!hit.length || YES_NO.test(sentence) || !REQUEST.some((re) => re.test(sentence))) return null;
    let rest = sentence.replace(/^\s*p\d+\s+needs?\b/, ' ').replace(WHAT_IS, ' ').replace(/\bright now\b/g, ' ');
    for (const k of hit) for (const re of [...k.match, ...(k.also || [])]) rest = rest.replace(re, ' ');
    // \p{L}: words of any script count, so a non-English addition is never invisible.
    if (rest.split(/[^\p{L}\p{N}_]+/u).some((w) => w && !FILLER.has(w))) return null;
    for (const k of hit) found.add(k.kind);
  }
  return found.size ? EVIDENCE.map((k) => k.kind).filter((k) => found.has(k)) : null;
}

// The answer text. facts: {at (ISO time of the reads), process_count: number, ledger: {lines,
// omitted}, cost: {by_stage, spend, estimated}} - only the parts `kinds` names are used. The process
// evidence is the count alone: command lines would carry other sessions' paths and arguments.
export function evidenceAnswer(kinds, facts) {
  const out = [`Read first-hand by the engine at ${facts.at}.`];
  if (kinds.includes('process_count')) {
    out.push('', `teams mcp/server.mjs processes on this machine: ${facts.process_count}`);
  }
  if (kinds.includes('ledger_lines')) {
    const { lines, omitted } = facts.ledger;
    out.push('', `ledger.jsonl lines (verbatim): ${lines.length}${omitted ? ` shown, ${omitted} earlier ones omitted` : ''}`, ...lines);
  }
  if (kinds.includes('cost_by_stage')) {
    const { by_stage, spend, estimated } = facts.cost;
    out.push('', 'cost by stage so far, whole task (USD, live):',
      ...Object.entries(by_stage).map(([stage, usd]) => `${stage}: ${usd}`),
      `spend: ${spend}${estimated ? ' (estimated)' : ''}`);
  }
  return out.join('\n');
}
