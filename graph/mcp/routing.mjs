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

export function rankCandidates(run, node, candidates) {
  const execution = ['implement', 'test'].includes(node.stage);
  const preferred = run.host_vendor
    ? (execution ? (run.host_vendor === 'claude' ? 'codex' : 'claude') : run.host_vendor)
    : (execution ? 'codex' : 'claude');
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
