// failure-kind.mjs - card 129: the shared, pure contract that says WHAT KIND of failure a stage hit,
// so the engine stops treating every failure as "retry and it will pass". Nothing here is wired into
// the engine: it imports taskstate's record (the ledger writer, a leaf) and denials' writeDenials,
// never taskmanager / daemon / broker, and holds no state.
//
// classifyFailure(task, node, result, opts) -> exactly one of KINDS. Inputs:
//   result                the stage's result (or the claude -p envelope: permission_denials is read off it)
//   opts.stderr           the driver's stderr text, when the caller has it (result.stderr is read too)
//   opts.envelope         a separate claude -p envelope whose permission_denials count as the result's
//   opts.previous         the PREVIOUS REJECTED attempt's result of the SAME target (same subgoal_id or
//                         card, same stage) - the caller picks it; this module cannot see attempts
//   opts.previousSignature  that attempt's gapSignature, when the caller kept the signature instead
//   opts.engineWrittenPath  a file the engine renders itself (the QA report): a denied write to only
//                         that path is not an environment failure
//   opts.floor            the goal threshold; defaults to task.goal_threshold, then 90
// Precedence, first match wins: capacity, environment, repeated-identical-rejection,
// below-threshold, merge-conflict, unclassified. 'ended-task' is never returned by classifyFailure:
// it is the kind a resumed task records on its node (recordFailureKind), not a stage's own failure.

import { resolve } from 'node:path';
import { record } from './taskstate.mjs';
import { writeDenials } from './denials.mjs';

export const KINDS = ['capacity', 'environment', 'repeated-identical-rejection', 'below-threshold', 'merge-conflict', 'ended-task', 'unclassified'];

export const CAPACITY_RE = /hit your [a-z0-9-]+ limit/i;
const ENOSPC_RE = /ENOSPC|no space left on device/i;
const MISSING_FILE_RE = /has no file under/i;
const DEFAULT_FLOOR = 90;

const text = (v) => (typeof v === 'string' ? v : '');
const flat = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

function floorOf(task, opts) {
  for (const f of [opts?.floor, task?.goal_threshold]) if (Number.isFinite(f)) return f;
  return DEFAULT_FLOOR;
}

// The prose a stage left about why it stopped.
function failureText(result, stderr) {
  return [result?.reason, result?.error, result?.stderr, result?.message, result?.summary, stderr].map(text).filter(Boolean);
}

function entryText(e) {
  if (typeof e === 'string') return e.trim();
  if (e && typeof e === 'object') {
    const head = [e.title, e.summary, e.text, e.message].find((x) => typeof x === 'string' && x.trim());
    const ev = typeof e.evidence === 'string' ? e.evidence.trim() : '';
    if (head && ev) return `${head.trim()}: ${ev}`;
    if (head || ev) return (head || ev).trim();
    try { return JSON.stringify(e); } catch { return String(e); }
  }
  return e == null ? '' : String(e).trim();
}

// Every write denial the stage reports, as file paths.
function deniedPaths(result, opts) {
  return [...writeDenials(result), ...writeDenials(opts?.envelope)].map((d) => d.tool_input.file_path);
}

function capacityHit(result, opts) {
  if (result?.routing_blocked_capacity) return true;
  if (failureText(result, opts?.stderr).some((t) => CAPACITY_RE.test(t))) return true;
  // A child stage's own failure_kind is 'quota'; at this boundary that is capacity.
  const stages = [result?.failure_kind, ...flat(result?.stages).map((s) => s?.failure_kind), ...flat(result?.children).map((s) => s?.failure_kind)];
  return stages.some((k) => k === 'quota');
}

function writeDenied(result, opts) {
  const paths = deniedPaths(result, opts);
  const exempt = opts?.engineWrittenPath ? resolve(opts.engineWrittenPath) : null;
  if (paths.length) return paths.some((p) => resolve(p) !== exempt);
  return result?.blocked === 'tool denied';
}

function environmentHit(result, opts) {
  const prose = failureText(result, opts?.stderr);
  if (prose.some((t) => ENOSPC_RE.test(t) || MISSING_FILE_RE.test(t))) return true;
  return writeDenied(result, opts);
}

// A gap set reduced to what it objected to, like broker-independence's goalRejectionSig: trimmed,
// lowercased, sorted, the reason line excluded (fresh judges word it differently for the same gap).
// Whitespace inside a gap collapses too. Below the floor adds one token, so two refusals at 87 with
// no named gap share 'below goal_threshold 90'. An empty set that is not below the floor is '' and
// never matches anything.
export function gapSignature(result, floor) {
  const set = new Set([...flat(result?.gaps), ...flat(result?.spec_drift)]
    .map((g) => entryText(g).toLowerCase().replace(/\s+/g, ' ')).filter(Boolean));
  if (Number.isFinite(floor) && Number.isFinite(result?.match_pct) && result.match_pct < floor) set.add(`below goal_threshold ${floor}`);
  return [...set].sort().join('|');
}

// ---------- the repeat comparator (card 129 U2) ----------
//
// Two rejections are "the same" when the second names nothing the first did not. Gaps are judge
// prose and get reworded every round, so the comparison is on what they POINT at: a story / AC /
// declared id when the gap names one, else the gap's own text with line refs and punctuation gone.
// gapSignature above stays the exact-text signature classifyFailure uses.

const ID_RE = /\b(?:[A-Z][A-Z0-9]*-)?(?:US|AC)-\d+\b|\bA-\d+\b/g;
const PAIR_RE = /^\s*(\S+)\s+vs\s+(\S+)/i;

function norm(s) {
  return String(s ?? '').toLowerCase()
    .replace(/:\d+(?:[-/:]\d+)*/g, '').replace(/\bl\.\s*\d+/g, '').replace(/\blines?\s+\d+(?:-\d+)?/g, '')
    .replace(/\s+/g, ' ').trim().replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');
}

function gapKeys(gap, prefix) {
  const t = entryText(gap);
  const ids = t.match(ID_RE);
  if (ids) return ids.map((id) => `id:${prefix}${id}`);
  const n = norm(t);
  return n ? [`gap:${prefix}${n}`] : [];
}

const contradictionKey = (c) => {
  const t = entryText(c);
  const m = PAIR_RE.exec(t);
  if (!m) return `contra:${norm(t)}`;
  const x = m[1].replace(/[:;,.)]+$/, '');
  const y = m[2].replace(/[:;,.)]+$/, '');
  return `pair:${[x, /^itself$/i.test(y) ? x : y].sort().join('|')}`;
};

const retryEntries = (result) => flat(result?.retry).filter((x) => x && typeof x === 'object').map((x) => ({ card: x.card != null ? String(x.card) : '', gaps: flat(x.gaps).map(entryText).filter(Boolean) }));

// The set of things a rejection objected to. Empty for an accept, and for a refusal that said
// nothing comparable: an empty set never matches.
export function rejectionKeys(result, { floor, planIntegrate } = {}) {
  const keys = new Set();
  if (!result || typeof result !== 'object') return keys;
  if (planIntegrate) {
    if (result.accept === true) return keys;
    for (const { card, gaps } of retryEntries(result)) {
      keys.add(`card:${card}`);
      for (const g of gaps) gapKeys(g, `${card}:`).forEach((k) => keys.add(k));
    }
    flat(result.contradictions).forEach((c) => keys.add(contradictionKey(c)));
    flat(result.duplicate_ids).forEach((d) => d && d.id != null && keys.add(`dup:${d.id}`));
    flat(result.placeholder_acceptance).forEach((p) => p && keys.add(`placeholder:${p.card}:${p.story}`));
    flat(result.uncovered).forEach((u) => norm(entryText(u)) && keys.add(`uncovered:${norm(entryText(u))}`));
    return keys;
  }
  for (const g of [...flat(result.gaps), ...flat(result.spec_drift)]) gapKeys(g, '').forEach((k) => keys.add(k));
  const refused = result.accept !== true || (Number.isFinite(floor) && Number.isFinite(result.match_pct) && result.match_pct < floor);
  if (!keys.size && refused) {
    const why = norm(text(result.judge_reason) || text(result.reason));
    if (why) keys.add(`reason:${why}`);
  }
  return keys;
}

// What a repeat names, or null when the retry is still new information. A repeat is a rejection
// whose every key the previous one already had; one new key (a story id, a card, a pair, an
// id-less gap) buys the retry.
export function repeatedGaps(cur, prev, opts = {}) {
  const now = rejectionKeys(cur, opts);
  const before = rejectionKeys(prev, opts);
  if (!now.size || !before.size || [...now].some((k) => !before.has(k))) return null;
  const named = [];
  if (opts.planIntegrate) {
    for (const { card, gaps } of retryEntries(cur)) gaps.forEach((g) => named.push(`${card}: ${g}`));
    flat(cur.contradictions).map(entryText).filter(Boolean).forEach((c) => named.push(c));
    flat(cur.duplicate_ids).forEach((d) => d && d.id != null && named.push(`story id ${d.id} is defined by several cards`));
    flat(cur.placeholder_acceptance).forEach((p) => p && named.push(`${p.card}: story ${p.story} has placeholder acceptance`));
    flat(cur.uncovered).map(entryText).filter(Boolean).forEach((u) => named.push(`uncovered: ${u}`));
    if (!named.length) retryEntries(cur).forEach((x) => named.push(x.card));
  } else {
    [...flat(cur.gaps), ...flat(cur.spec_drift)].map(entryText).filter(Boolean).forEach((g) => named.push(g));
    if (!named.length) named.push(text(cur.judge_reason) || text(cur.reason));
  }
  return named;
}

export function classifyFailure(task, node, result, opts = {}) {
  if (capacityHit(result, opts)) return 'capacity';
  if (environmentHit(result, opts)) return 'environment';
  const floor = floorOf(task, opts);
  const below = Number.isFinite(result?.match_pct) && result.match_pct < floor;
  const refused = result?.accept !== true || below;
  const sig = gapSignature(result, floor);
  const prior = typeof opts.previousSignature === 'string' ? opts.previousSignature : opts.previous ? gapSignature(opts.previous, floor) : '';
  if (refused && sig && prior && sig === prior) return 'repeated-identical-rejection';
  if (below) return 'below-threshold';
  if (flat(result?.conflicts).length || result?.integrate_conflict) return 'merge-conflict';
  return 'unclassified';
}

// Sets node.result.failure_kind and records failure_classified. Never throws: it runs on the
// failure path, where an error of its own would hide the failure it describes. A node with no
// result gets one only for 'ended-task' (a resumed task's node), as {failure_kind}; the node's
// state, stage_ok and attempt are never touched. `findings` (an array) are merged into
// node.result.findings so the evidence travels with the kind.
export function recordFailureKind(task, node, kind, { via, findings } = {}) {
  try {
    if (node && typeof node === 'object') {
      if (!node.result && kind === 'ended-task') node.result = { failure_kind: kind };
      if (node.result && typeof node.result === 'object') {
        node.result.failure_kind = kind;
        const add = flat(findings).filter((f) => entryText(f));
        if (add.length) node.result.findings = [...new Set([...flat(node.result.findings), ...add])];
      }
    }
  } catch { /* the kind is evidence, not a dependency */ }
  try {
    record(task, { event: 'failure_classified', task_id: task?.run_id, node_id: node?.node_id, failure_kind: kind, ...(via ? { via } : {}) });
  } catch { /* a failed ledger write is swallowed */ }
  return kind;
}

// What an environment failure leaves for the next reader, in order: the stage's own defects,
// findings and evidence; the error / denial / ENOSPC / missing-file text; the ask text.
export function environmentEvidence({ result, stderr, askText } = {}) {
  const out = [];
  const push = (line) => { const t = entryText(line); if (t && !out.includes(t)) out.push(t); };
  for (const k of ['defects', 'findings', 'evidence']) flat(result?.[k]).forEach(push);
  push(result?.error);
  for (const p of deniedPaths(result, {})) push(`write denied: ${p}`);
  if (result?.blocked === 'tool denied' && !deniedPaths(result, {}).length) push('tool denied');
  for (const t of failureText(result, stderr)) if (ENOSPC_RE.test(t) || MISSING_FILE_RE.test(t)) push(t);
  push(askText);
  return out.length ? out : ['the stage left no findings'];
}

// The ask card for a repeated identical rejection, shaped like the questions openAsk takes
// ({question, options, default, why}) plus the marker the answer path reads. Stopping is the
// default: a third identical retry is never the answer nobody gave.
export function escalationAsk({ target, stage, gaps } = {}) {
  const list = flat(gaps).map(entryText).filter(Boolean);
  return {
    question: `${target} ${stage} was rejected twice for the same gaps${list.length ? `: ${list.join('; ')}` : ''}. Stop the stage, or retry once more with your answer as feedback?`,
    options: ['stop the stage', 'retry once more with my answer as feedback'],
    default: 'stop the stage',
    why: 'the same rejection twice means a plain retry will not pass',
    escalation: { target, stage, gaps: list },
  };
}
