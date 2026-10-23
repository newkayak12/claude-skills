// Deterministic, inspectable routing. These preferences are heuristics, not claims
// about universal vendor quality. No token, cost, or turn caps are imposed here.
export const DEFAULT_MODELS = { claude: 'sonnet', codex: 'gpt-5.6-sol' };
export function isPremiumModel(model) { return /(?:fable|astra)/i.test(model || ''); }
export function capacityFailure(report, stderr = '') {
  if (report?.failure_kind === 'quota') return true;
  const eventErrors = String(report?.stdout || '').split('\n').flatMap(line => {
    try {
      const event = JSON.parse(line);
      return ['error', 'turn.failed'].includes(event.type) ? [event.message || event.error?.message || ''] : [];
    } catch { return []; }
  });
  const text = [stderr, report?.stderr, report?.error?.message, report?.error?.type,
    typeof report?.error === 'string' ? report.error : '',
    !report?.result ? report?.last_message : '', ...(Array.isArray(report?.errors) ? report.errors : []), ...eventErrors].filter(Boolean).join('\n');
  return /(?:insufficient_quota|rate_limit_error|usage_limit_reached|quota (?:exceeded|exhausted)|(?:usage|rate|token|credit) limit (?:has been )?(?:reached|exceeded)|out of (?:credits|tokens)|hit your (?:usage )?limit|exceeded your current quota)/i.test(text);
}
export function selectModel(run, node, vendor, explicit) {
  if (explicit) return explicit;
  const execution = ['implement', 'test'].includes(node.stage);
  if (!execution && vendor === run.host_vendor && run.host_model && !isPremiumModel(run.host_model)) return run.host_model;
  return DEFAULT_MODELS[vendor] || null;
}

// implement and test hand the work to the other vendor. report joins them so a run's
// account of itself is not written by the vendor that drove it - the same independence
// the same-actor penalty buys gate and critique. Model defaults stay tied to execution:
// a report that degrades back to the host is still reasoning work.
export const CROSS_VENDOR_STAGES = new Set(['implement', 'test', 'report']);

export function rankCandidates(run, node, candidates) {
  const execution = ['implement', 'test'].includes(node.stage);
  const cross = CROSS_VENDOR_STAGES.has(node.stage);
  const preferred = run.host_vendor
    ? (cross ? (run.host_vendor === 'claude' ? 'codex' : 'claude') : run.host_vendor)
    : (cross ? 'codex' : 'claude');
  const peers = run.nodes.filter(n => n.subgoal_id === node.subgoal_id && n.node_id !== node.node_id);
  const actor = node.stage === 'critique'
    ? run.nodes.filter(n => n.stage === 'setgoal' && n.state === 'done').at(-1)
    : peers.filter(n => n.stage === 'implement' && n.state === 'done').at(-1);
  return [...new Set(candidates)].map((vendor, index) => {
    const history = run.nodes.filter(n => (n.executor || n.vendor) === vendor);
    const active = history.filter(n => n.state === 'running' || (n.state === 'pending' && n.assignment)).length;
    const completed = history.filter(n => n.state === 'done').length;
    // A negative gate verdict is useful judging work, not a failure of its vendor.
    const errors = history.filter(n => n.stage === node.stage && n.result?.stage_ok === false).length;
    const sameActor = ['gate', 'critique'].includes(node.stage)
      && actor && (actor.executor || actor.vendor) === vendor;
    // Keep reasoning on the driving host; execution is where load balancing helps.
    const score = (vendor === preferred ? 10 : 0) - active * 4 - (execution ? completed * 0.25 : 0) - errors * 3 - (sameActor ? 3 : 0);
    return { vendor, score, index, reason: `stage=${node.stage}; preference=${preferred}; active=${active}; completed=${completed}; execution_errors=${errors}; same_actor=${Boolean(sameActor)}` };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
}

// ---- Codex availability: which adapter answers, and when a node falls back to Claude ----
// Both functions are pure: the caller passes the probe result it got from the adapter.
import { join } from 'node:path';

// The harness adapter is referenced by path, never copied; graph's own file is the standalone
// fallback for a plugin installed without the sibling harness/ directory.
const HARNESS_CODEX_ADAPTER = 'harness/engine/codex-exec-adapter.mjs';
const GRAPH_CODEX_ADAPTER = 'adapters/codex-exec-adapter.mjs';
const NESTED_CODEX = 'Codex hosts must use native agents; nested Codex CLI is disabled';

// graphRoot is the graph plugin directory; exists(path) is injected so the choice is testable.
export function codexAdapterPath(graphRoot, exists) {
  const harness = join(graphRoot, '..', HARNESS_CODEX_ADAPTER);
  if (exists(harness)) return { path: harness, source: 'harness', reason: '' };
  return { path: join(graphRoot, GRAPH_CODEX_ADAPTER), source: 'graph', reason: 'harness/engine/codex-exec-adapter.mjs not present; using graph/adapters copy' };
}

// probe: {ready, reachable, adapter, reason}. Implement and test need a Codex that can write
// (ready); a reasoning stage needs only a reachable one. Not executable, unreachable and
// reachable-but-not-ready all leave Codex unavailable for the stage that needs more than it has.
// A Codex host (host_vendor 'codex') or a set threadId (CODEX_THREAD_ID) never nests the CLI.
export function routeCodex({ stage, probe, host_vendor, threadId, at = new Date().toISOString() } = {}) {
  const p = probe || {};
  const record = (reason) => ({
    from: 'codex', to: 'claude', reason,
    ready: Boolean(p.ready), reachable: Boolean(p.reachable), adapter: p.adapter ?? null, at,
  });
  if (host_vendor === 'codex' || threadId) return { executor: 'claude', fallback: record(NESTED_CODEX) };
  const execution = ['implement', 'test'].includes(stage);
  if (execution ? p.ready : p.reachable) return { executor: 'codex', fallback: null };
  return { executor: 'claude', fallback: record(p.reason || 'codex unavailable') };
}
