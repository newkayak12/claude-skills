// graph-kinds.mjs - the stage, kind and flow tables of the graph engine (cut from graph.mjs).
//
// What a subgoal IS (its kind) decides which node chain it expands into; a flow is what the
// entry chose. Nothing here touches disk or a run's node list beyond reading a spec - the
// other graph-*.mjs modules build the graph from these tables. graph.mjs re-exports it all.

import { VERDICT_FIELD } from './verdictfields.mjs';

export const STAGES = [
  'plan',      // decompose the raw request
  'setgoal',   // turn the plan into a goal-spec
  'critique',  // adversarial pass over the goal-spec (judge != author)
  'implement', // per code subgoal
  'test',      // per code subgoal, verification-only
  'draft',     // per document subgoal
  'review',    // per document subgoal, reader's pass (reviewer != author)
  'gate',      // per subgoal, then once at goal level (judge != actor)
  'repair',    // run-level, opened when goal-gate consensus rejects the assembled result
  'report',    // synthesize from the ledger
];

// What kind of work a subgoal is decides which node chain it expands into. The engine
// below - edges, readiness, retries, settled failure - does not care what the stages are
// called; only this table and the contracts in prompts.mjs do. The chain's first node
// carries the subgoal's deps and `after`, each later node depends on the one before it,
// and the last node is the gate the goal gate collects.
//
//   subgoal   the code flow the stable engine has always run. implement mutates the
//             worktree and is cross-checked against git; test runs commands.
//   document  a written artifact. draft mutates the worktree too (it writes the file)
//             but the check on it is a reading, not a command: review is a reasoning
//             node, and its verdict - like test's - is `verified`. A document that
//             touched nothing is not contradicted by git; it is judged by its reviewer.
//
// `reasoning` names the chain stages that write nothing. Everything not listed there,
// and not in BASE_REASONING, is a mutating stage: routed to a writable sandbox, offered
// one at a time under isolation, and cross-checked against the worktree.
//
// `skills` is method, by the stage that does the work. It is named here rather than asked
// for in the spec because asking did not work: the first live runs came back with
// `skills: []` on every subgoal and no `skills` field at all on any package, while
// `persona` - asked for in the same breath - was filled in every time and filled well.
// The difference is that the flow hands setgoal a list of personas to choose from, and the
// skills contract handed it a shape (`["plugin:skill"]`) and no candidates. An agent that
// cannot see what is installed will not invent a name, and an empty array is the honest
// answer to an impossible question. A kind knows what its own stages are for, so the kind
// is where the list belongs - which is also how the generation this replaced did it, with
// skill names written into the prompts rather than chosen at runtime.
export const KINDS = {
  subgoal: {
    chain: ['implement', 'test', 'gate'],
    reasoning: [],
    skills: {
      implement: ['develop:clean-code'],
      test: ['develop:testing-workflow', 'completion:verification-before-completion'],
      // clean-code picks its mode from the stage it is called in: on implement it is the kind's
      // default method (implement mode - a spec's own sg.skills replace it there, so it is a
      // default, not a guarantee); on the gate it is the gate's own method from the kind (gate
      // mode), never the author's spec-picked skill - a judging stage reads only kindSkills.
      // devils-advocate stays beside it as the independent view: implementer and judge loading
      // the same rubric would share blind spots. test-master is not mounted on this chain: test
      // is a verdict stage, and implement mode's tests-first step already references it.
      // (User direction 2026-10-02; clean-code 2.0.0 gate mode.)
      gate: ['develop:clean-code', 'think:devils-advocate'],
    },
  },
  document: {
    chain: ['draft', 'review', 'gate'],
    reasoning: ['review'],
    skills: {
      draft: ['write:prd', 'develop:architecture-designer'],
      review:['write:writer-verification'],
      gate: ['think:devils-advocate'],
    },
  },
  // planning and qa both mutate on every authoring stage, unlike document's review: revise
  // rewrites the PRD itself (a different identity from draft, with edit rights - not only a
  // judge, per the design doc), and execute is qa's test - it runs the case set and reports
  // defects, not a verdict on someone else's claim. Neither belongs in `reasoning`; only the
  // closing `gate` judges. (The design doc's own table listed revise as reasoning while also
  // describing it as having edit rights - a contradiction; this follows document's precedent
  // instead: the mutating stage is never reasoning.)
  planning: {
    // `investigate` leads because the two real planning runs (idol-pm-1/2, 2026-09-22) had no
    // stage that ever touched a source: draft wrote from the request alone, revise rewrote what
    // draft had written, gate scored it. Every other kind meets reality somewhere - subgoal's
    // test runs commands, qa's execute runs the case set - and planning met it nowhere, so a
    // domain's own rules (a presale's eligibility, a cancellation window, a per-person limit)
    // could only be invented or omitted. No amount of contract wording fixes a stage with zero
    // input; a stage that reads first does. Its second job is naming what no source could
    // answer, so draft carries those as open questions instead of inventing them.
    chain: ['investigate', 'draft', 'revise', 'gate'],
    reasoning: [],
    author: 'draft',
    skills: {
      // No PM plugin is named here: pm is unpublished, so 'pm:prd-development' could never
      // mount and left every planning draft with no method at all. The PRD method now lives
      // in prompts.mjs's PRD_CONTRACT, inside the draft contract itself.
      investigate: ['develop:domain-driven-design', 'cognition:assumption-extractor', 'write:requirements'],
      draft: ['write:prd', 'develop:architecture-designer'],
      revise: ['write:writer-verification', 'think:devils-advocate'],
      gate: ['think:devils-advocate'],
    },
  },
  // The light PLAN chain (_repo/docs/plans/2026-09-28-teams-light-plan.md §2.2): for a backlog whose
  // acceptance criteria are already declared (acceptance.mjs's hasDeclaredAcceptance), draft
  // and revise fold into one template-fill - copy the declared criteria into the document in
  // backlog order, cite investigate's findings beside them, carry every unknown - and the gate
  // additionally checks per-item rule coverage and that no unknown was lost (§2.3). investigate
  // stays whole: it is the only stage that reads sources and the only route an unknown takes to
  // an `ask` card. A separate kind rather than a `chain_light` field on `planning` (§5-2): every
  // lookup here (chain, author, gate stage, skills) and reducers.mjs's REGISTRY are keyed by
  // kind, so a kind of its own needs no run-aware variant of any of them. A light run gets it by
  // run.planning_mode === 'light' (normalizeSpec below), never by setgoal naming it.
  'planning-light': {
    chain: ['investigate', 'template-fill', 'gate'],
    reasoning: [],
    author: 'template-fill',
    skills: {
      investigate: ['develop:domain-driven-design', 'cognition:assumption-extractor', 'write:requirements'],
      'template-fill': ['write:prd'],
      gate: ['think:devils-advocate'],
    },
  },
  qa: {
    chain: ['cases', 'execute', 'gate'],
    reasoning: [],
    skills: {
      cases: ['develop:test-master', 'develop:scenario-director'],
      execute: ['develop:scenario-actor', 'completion:verification-before-completion'],
      gate: ['think:devils-advocate'],
    },
  },
  // planning's own second pass over an EPIC, after integration: audit compares the PRD's
  // user_stories[] against what was actually built (and, when a QA report exists, against
  // it too) and gate judges completeness. Unlike planning's revise, audit has no edit
  // rights - that is stated in the audit stage's own Required-output contract
  // (prompts.mjs), not encoded here via `reasoning`, because this table follows the same
  // shape planning and qa already use: every non-final chain stage counts as mutating, and
  // only the closing gate judges. audit's own skill is think:devils-advocate, same as
  // gate - its character is judgment, not authorship, so there is no draft/revise-style
  // authoring skill to name. taskmanager.mjs's openAudit opens a child run of this kind once
  // integration (and QA, when it is on) has finished, whenever roles.planning is set.
  'planning-audit': {
    chain: ['audit', 'gate'],
    reasoning: [],
    skills: {
      audit: ['think:devils-advocate'],
      gate: ['think:devils-advocate'],
    },
  },
};

// The method a node inherits from its kind. A spec that names its own `skills` for the
// subgoal replaces the family for authoring stages - setgoal knows this particular piece
// of work, the kind only knows the shape of the work - but a judging stage keeps its own:
// a gate's method is the gate's, and handing it the author's was the bug that made a gate
// act as the implementer it was supposed to be checking.
export function kindSkills(kind, stage) {
  const table = (KINDS[kind] || KINDS[DEFAULT_KIND]).skills || {};
  return (table[stage] || []).slice();
}
export const DEFAULT_KIND = 'subgoal';

export function kindOf(sg) {
  return sg && sg.kind != null ? String(sg.kind) : DEFAULT_KIND;
}

// Stages whose work is reasoning rather than file mutation. They are still routed and
// still adjudicated, but a claimed file list is not what makes them true, so the
// worktree cross-check has nothing to contradict. The run-level stages are fixed; the
// per-subgoal ones come from the kind table so a new kind cannot forget to declare them.
// `reduce` is here because it reports and does not repair. The level above decides what to
// do about what it finds - that is the same rule the ticket model already runs on, where a
// TASK is a card a sub picks up and the level above it owns the outcome. A reduce that
// deleted an orphan on its own authority would be deciding at the level that observed,
// which is exactly the confusion the engine keeps out of its judging stages.
const BASE_REASONING = ['plan', 'setgoal', 'critique', 'gate', 'report', 'reduce', 'ask'];
export const REASONING_STAGES = new Set([
  ...BASE_REASONING,
  ...Object.values(KINDS).flatMap((k) => k.reasoning || []),
]);

// The field that carries a judging node's verdict. stage_ok on these nodes means only
// "the judging itself worked"; the verdict must be present and affirmative for the node
// to count as done. A stage absent here has no verdict beyond stage_ok.
// The map lives in verdictfields.mjs; this is its engine view.
export { VERDICT_FIELD };

// Why a judging node said no, when it never said so in a `reason`. review's and test's schema
// have no reason field at all, and a manager integrate/accept/critique can come back
// verified/accept/sound:false with empty gaps/blocking - only `checks`/`evidence` explain it.
// The first check reading as a failure, else the evidence summary, else every check. '' when
// the result already carries its own reason (or gaps/blocking for the fields that have them),
// or has nothing to synthesize from. Shared by the broker (child nodes), taskmanager.finish
// (manager nodes) and runlog.classify (records written before either filled it).
export function reasonFromVerdict(result, field) {
  const r = result || {};
  if (!field || r[field] !== false) return '';
  if (r.reason || r.verification_error) return '';
  if (field === 'accept' && (r.gaps || []).length) return '';
  if (field === 'sound' && (r.blocking || []).length) return '';
  const checks = Array.isArray(r.checks) ? r.checks : [];
  // Read a check's outcome (after its last "->"), quoted text removed: a passing check that
  // quotes the rule it verified ("-> 'does NOT move the score'") is not a failure.
  const readsAsFailure = (c) => {
    const s = String(c);
    const outcome = s.includes('->') ? s.slice(s.lastIndexOf('->') + 2) : s;
    // An in-word apostrophe (주장's, don't) is not a quote mark.
    const unquoted = outcome.replace(/([^\s'"`])'(?=[a-z])/gi, '$1').replace(/"[^"]{0,200}"|'[^']{0,200}'|`[^`]{0,200}`/g, '');
    return /\b(missing|fail(ed|ing|s)?|not met|unmet|does not|refused)\b/i.test(unquoted);
  };
  const flagged = checks.find(readsAsFailure);
  return String(flagged || (r.evidence ? String(r.evidence) : '') || checks.join('; ')).slice(0, 300);
}

// A flow is what the user-facing entry chose - or, under `auto`, what the plan node decided
// from the request. It sets the kind a subgoal gets when setgoal names none, and gives
// setgoal a persona set to draw from. With `mixed: false` it also forbids the other kinds,
// which is what a manual `teams:document` entry means by "this is a writing job".
export const FLOWS = {
  develop: {
    kind: 'subgoal',
    personas: ['implementer who owns the module being changed', 'test engineer who distrusts the implementation narrative', 'reviewer who has to maintain this code next year'],
  },
  document: {
    kind: 'document',
    personas: ['technical writer who has never seen this codebase', 'the reader the document is for - name their role', 'editor checking every claim against the source'],
  },
  // Flow name collides in spelling with the `plan` STAGE (the run's own decomposition node) -
  // different namespace, same word, because that is what the design doc names the entry skill.
  // A node id is never a flow name and vice versa, so nothing in the engine confuses them.
  plan: {
    kind: 'planning',
    personas: ['PO who owns value and scope', 'domain expert who owns terminology and rules', 'implementation lead reading for feasibility'],
  },
  qa: {
    kind: 'qa',
    personas: ['QA who represents the user', 'release manager weighing risk', 'someone deliberately trying malicious or malformed input'],
  },
  // The 기획 크로스 검수 (planning cross-review) pass: planning's own identity, run a
  // second time against the integrated result, so its persona list is planning's own -
  // verbatim, not a new set (a decision already made, not this file's to reopen).
  audit: {
    kind: 'planning-audit',
    personas: ['PO who owns value and scope', 'domain expert who owns terminology and rules', 'implementation lead reading for feasibility'],
  },
};
export const DEFAULT_FLOW = 'develop';

// The flow this run is actually in: fixed by the entry, or chosen by plan under `auto`.
export function flowOf(run) {
  const f = run.flow && run.flow !== 'auto' ? run.flow : run.flow_chosen;
  return FLOWS[f] ? f : null;
}

export function defaultKind(run) {
  const f = flowOf(run);
  const kind = f ? FLOWS[f].kind : DEFAULT_KIND;
  // A PLAN run the manager opened in light mode (taskmanager.mjs's planning_mode) runs every
  // planning subgoal as planning-light - same flow, same personas, shorter chain.
  return kind === 'planning' && run.planning_mode === 'light' ? 'planning-light' : kind;
}

// Every subgoal leaves setgoal with an explicit kind, so nothing downstream - retries, the
// author check, the cross-check - has to know what the run's default was at the time.
// In a light PLAN run an explicit kind "planning" (what PLANNING_SETGOAL tells setgoal to write)
// is read as planning-light too: the mode is the manager's decision, not setgoal's.
export function normalizeSpec(run, spec) {
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.subgoals)) return spec;
  const dflt = defaultKind(run);
  const light = dflt === 'planning-light';
  // A package child run (run.package, opened by the task manager's openChild) is judged by its
  // manager against the package's own acceptance - so its spec carries every item verbatim,
  // whatever setgoal wrote. setgoal is told so (prompts.mjs's packageBlock); this is the
  // deterministic half, so a dropped or reworded item cannot slip past gate:goal unjudged.
  const pkgAcc = run && run.package && Array.isArray(run.package.acceptance) ? run.package.acceptance : [];
  if (pkgAcc.length) {
    const own = Array.isArray(spec.acceptance) ? spec.acceptance.map(String) : [];
    const missing = pkgAcc.filter((a) => !own.includes(a));
    if (missing.length) spec = { ...spec, acceptance: [...missing, ...own] };
  }
  return { ...spec, subgoals:spec.subgoals.map((sg) => (sg && typeof sg === 'object' && (sg.kind == null || (light && sg.kind === 'planning')) ? { ...sg, kind: dflt } : sg)) };
}

// The stage that AUTHORS the artifact - the identity a later reviewing stage must not be.
// This was chain[0] until planning grew an `investigate` stage in front of `draft`: the
// investigator reads sources and writes findings, it does not write the document, so
// comparing revise against it would have let the drafter revise their own draft. A kind
// may name its author explicitly; chain[0] remains the default, which is still correct for
// every other kind (implement, draft, cases).
export function authorStage(kind) {
  const k = KINDS[kind] || KINDS[DEFAULT_KIND];
  return k.author || k.chain[0];
}

// Is this node the one that MUTATES the worktree for its subgoal (implement/draft/cases/audit -
// whatever authorStage(kind) names)? The checkpoint/rollback mechanism (broker.mjs) only cares
// about these: a judging stage (test/review/gate/critique) reads the tree, it does not write it,
// so there is nothing on its own attempt worth snapshotting.
export function isAuthorNode(run, n) {
  if (!n || !n.subgoal_id) return false;
  const sg = ((run.spec && run.spec.subgoals) || []).find((s) => String(s.id) === String(n.subgoal_id));
  return n.stage === authorStage(kindOf(sg));
}
