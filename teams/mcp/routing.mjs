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
  // Measured, not assumed: a manager run's round-1 cost split was driving session ~55%,
  // judging on the host's premium model ~40%, execution ~3% - and that 40% was buying
  // nothing. Every gate in the same run returned match_pct within three points of the
  // others, a thermometer stuck at room temperature. Only two judges actually move a run:
  // critique, which can reject the spec before anything is built, and the goal gate, the
  // one node that sees the request again and can reject the assembled result. Every other
  // judging stage - a subgoal gate, review, test, report, plan, setgoal - takes the
  // default tier; it was never the discriminating one.
  const decisive = node.stage === 'critique' || (node.stage === 'gate' && !node.subgoal_id);
  if (decisive && vendor === run.host_vendor && run.host_model && !isPremiumModel(run.host_model)) return run.host_model;
  return DEFAULT_MODELS[vendor] || null;
}

// implement and test hand the work to the other vendor. report joins them so a run's
// account of itself is not written by the vendor that drove it - the same independence
// the same-actor penalty buys gate and critique. Model defaults stay tied to execution:
// a report that degrades back to the host is still reasoning work.
// repair joins the same group (Step 9): it writes to the tree fixing a goal-gate
// rejection, and is routed the way implement is - to the peer of whichever identity is
// driving, so the fix is not made by the same vendor that has been driving the run.
export const CROSS_VENDOR_STAGES = new Set(['implement', 'test', 'draft', 'report', 'repair']);
// Stages that do the work rather than judge it. draft joins implement and test: it writes
// the artifact, so it goes to the peer, and its review stays on the host - which is what
// makes author and reviewer different identities without anyone arranging it. repair joins
// them too: a run-level stage, but a mutating one, offered one at a time under isolation
// exactly like implement and draft.
export const EXECUTION_STAGES = new Set(['implement', 'test', 'draft', 'repair']);
// The node whose author a judging stage must not share an identity with.
// test joins: the node that verifies an implementation must not be the identity that wrote it.
// Measured on code-flat 2026-09-16: implement and test both went to the peer (both are
// CROSS_VENDOR_STAGES), the implementer's own "am I main" guard compared import.meta.url against
// an unresolved argv path, the tester invoked the CLI through the one path that hides that, three
// gates ran no checks, and the integrated CLI printed nothing when called by its /var symlink.
// gate gains `repair`: the goal-gate round that follows a repair pass (Step 9) is soft-
// discouraged from sharing an identity with whoever did the repair, the same way it
// already is with whoever implemented or drafted the subgoal it is judging.
const AUTHOR_OF = { critique: 'setgoal', gate: ['implement', 'draft', 'repair'], review: 'draft', test: 'implement' };

// audit (planning-audit's own kind) cannot appear in AUTHOR_OF above: that table's actor lookup
// walks `run.nodes` for a peer sharing this node's subgoal_id, and audit's author - the PLAN
// package's draft/revise - never ran in this run at all. It ran in a sibling child run the
// TaskManager opened earlier and folded away (taskmanager.mjs's openAudit), a run this one
// has no nodes from. openAudit reads that run once, up front, and stashes its author's
// identity here, on the audit run itself, as `external_author: {executor, vendor, model}` -
// the cross-run equivalent of the same-run `actor` lookup every other judging stage uses.
function externalAuthorOf(run, node) {
  return node.stage === 'audit' ? run.external_author : null;
}

export function rankCandidates(run, node, candidates) {
  const execution = EXECUTION_STAGES.has(node.stage);
  const cross = CROSS_VENDOR_STAGES.has(node.stage);
  const peers = run.nodes.filter(n => n.subgoal_id === node.subgoal_id && n.node_id !== node.node_id);
  const externalAuthor = externalAuthorOf(run, node);
  // test's preference is "not the implementer", wherever the implementer ended up: a peer that
  // fell back to the host still leaves the same blind spot in author and tester if test follows
  // the static cross-vendor rule to the same vendor. audit's own author never left a peer in
  // THIS run to find (externalAuthorOf above) - same preference, same reason, sourced from the
  // other run's identity instead of this run's own nodes.
  const implementer = node.stage === 'test' ? peers.filter(n => n.stage === 'implement' && n.state === 'done').at(-1) : null;
  const implVendor = implementer
    ? (implementer.executor || implementer.vendor)
    : (externalAuthor ? (externalAuthor.executor || externalAuthor.vendor) : null);
  const other = (v) => (v === 'claude' ? 'codex' : 'claude');
  const preferred = implVendor
    ? other(implVendor)
    : run.host_vendor
      ? (cross ? other(run.host_vendor) : run.host_vendor)
      : (cross ? 'codex' : 'claude');
  const authored = [].concat(AUTHOR_OF[node.stage] || []);
  const actor = node.stage === 'critique'
    ? run.nodes.filter(n => n.stage === 'setgoal' && n.state === 'done').at(-1)
    : peers.filter(n => authored.includes(n.stage) && n.state === 'done').at(-1);
  return [...new Set(candidates)].map((vendor, index) => {
    const history = run.nodes.filter(n => (n.executor || n.vendor) === vendor);
    const active = history.filter(n => n.state === 'running' || (n.state === 'pending' && n.assignment)).length;
    const completed = history.filter(n => n.state === 'done').length;
    // A negative gate verdict is useful judging work, not a failure of its vendor.
    const errors = history.filter(n => n.stage === node.stage && n.result?.stage_ok === false).length;
    const sameActor = (Boolean(AUTHOR_OF[node.stage])
      && actor && (actor.executor || actor.vendor) === vendor)
      || Boolean(externalAuthor && (externalAuthor.executor || externalAuthor.vendor) === vendor);
    // A retry that hands the work back to the identity whose attempt was just rejected
    // tends to get the same work back. goal-docs spent its entire budget that way: the
    // same author, in the same worktree, reached the same conclusion three times.
    const rejectedBefore = (node.attempt || 1) > 1 && run.nodes.some((n) => n.subgoal_id === node.subgoal_id
      && n.stage === node.stage && (n.attempt || 1) < (node.attempt || 1) && (n.executor || n.vendor) === vendor);
    // Keep reasoning on the driving host; execution is where load balancing helps.
    const score = (vendor === preferred ? 10 : 0) - active * 4 - (execution ? completed * 0.25 : 0) - errors * 3 - (sameActor ? 3 : 0) - (rejectedBefore ? 5 : 0);
    return { vendor, score, index, reason: `stage=${node.stage}; preference=${preferred}; active=${active}; completed=${completed}; execution_errors=${errors}; same_actor=${Boolean(sameActor)}; rejected_before=${Boolean(rejectedBefore)}` };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
}
