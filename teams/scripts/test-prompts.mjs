import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { composePrompt, HANDOFF_CAP, DEGENERATE_SPEC_DIAGNOSIS, CONTRACT, EXERCISE_RULE, FIDELITY_RULE, PRD_CONTRACT } from '../mcp/prompts.mjs';
import { loadConventions, conventionsBlock, CONVENTIONS_CAP } from '../mcp/conventions.mjs';
import { nodeBriefing } from '../mcp/graph.mjs';

function tmpProject() {
  return mkdtempSync(join(tmpdir(), 'test-prompts-'));
}

function baseRun(cwd, overrides = {}) {
  return {
    run_id: 'r1',
    cwd,
    request: 'do the thing',
    context: '',
    allocation: 'ordered',
    flow: 'auto',
    flow_chosen: null,
    mixed: true,
    size: null,
    spec: null,
    nodes: [],
    ...overrides,
  };
}

function baseBriefing(overrides = {}) {
  return {
    flow: 'auto',
    flow_chosen: null,
    default_kind: 'subgoal',
    mixed: true,
    size: null,
    goal: null,
    goal_acceptance: [],
    subgoal: null,
    subgoals: null,
    whole_run: null,
    upstream: [],
    prior_feedback: '',
    spec_problems: null,
    ...overrides,
  };
}

function baseNode(overrides = {}) {
  return { node_id: 'n1', stage: 'plan', attempt: 1, ...overrides };
}

// ---------- conventions ----------

test('conventions dir absent: no block, no heading in the prompt', () => {
  const cwd = tmpProject();
  try {
    assert.deepEqual(loadConventions(cwd), []);
    assert.equal(conventionsBlock(cwd, { stage: 'plan' }), '');

    const run = baseRun(cwd);
    const n = baseNode({ stage: 'plan' });
    const prompt = composePrompt(run, n, baseBriefing());
    assert.ok(!prompt.includes('## Conventions'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('conventions present: plan lists every file with its first heading and an instruction', () => {
  const cwd = tmpProject();
  try {
    mkdirSync(join(cwd, '.claude', 'conventions', 'backend'), { recursive: true });
    writeFileSync(join(cwd, '.claude', 'conventions', 'general.md'), '# General\nWrite clear commit messages.\n');
    writeFileSync(join(cwd, '.claude', 'conventions', 'backend', 'api.md'), '# API rules\nEvery endpoint needs an integration test.\n');

    const entries = loadConventions(cwd);
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((e) => e.path).sort(), ['.claude/conventions/backend/api.md', '.claude/conventions/general.md']);

    const run = baseRun(cwd);
    const n = baseNode({ stage: 'plan' });
    const prompt = composePrompt(run, n, baseBriefing());
    assert.ok(prompt.includes('## Conventions'));
    assert.ok(prompt.includes('.claude/conventions/general.md: General'));
    assert.ok(prompt.includes('.claude/conventions/backend/api.md: API rules'));
    assert.ok(prompt.includes('List the rules that must constrain the work in `plan`.'));
    // plan does not get the full text of any convention, only the list + instruction.
    assert.ok(!prompt.includes('Every endpoint needs an integration test.'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('setgoal gets the list plus the fold-into-acceptance instruction', () => {
  const cwd = tmpProject();
  try {
    mkdirSync(join(cwd, '.claude', 'conventions'), { recursive: true });
    writeFileSync(join(cwd, '.claude', 'conventions', 'general.md'), '# General\nWrite clear commit messages.\n');

    const run = baseRun(cwd);
    const n = baseNode({ stage: 'setgoal' });
    const prompt = composePrompt(run, n, baseBriefing());
    assert.ok(prompt.includes('## Conventions'));
    assert.ok(prompt.includes('Fold applicable conventions into subgoal `acceptance` and `test[]`'));
    assert.ok(prompt.includes('name the convention file in the criterion'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('implement gets the full text of conventions matching its target files, not of ones that do not match', () => {
  const cwd = tmpProject();
  try {
    mkdirSync(join(cwd, '.claude', 'conventions', 'backend'), { recursive: true });
    writeFileSync(join(cwd, '.claude', 'conventions', 'general.md'), '# General\nWrite clear commit messages.\n');
    writeFileSync(join(cwd, '.claude', 'conventions', 'backend', 'api.md'), '# API rules\nEvery endpoint needs an integration test.\n');

    const run = baseRun(cwd);
    const n = baseNode({ stage: 'implement' });
    const sg = { id: 'U1', title: 'Handler', acceptance: ['works'], files: ['backend/api/handler.js'] };
    const prompt = composePrompt(run, n, baseBriefing({ subgoal: sg }));

    assert.ok(prompt.includes('### .claude/conventions/backend/api.md'));
    assert.ok(prompt.includes('Every endpoint needs an integration test.'));
    // general.md never matches backend/api/handler.js, so only its list line appears -
    // never its own heading with the full text.
    assert.ok(!prompt.includes('### .claude/conventions/general.md'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('draft gets matching text the same way implement does', () => {
  const cwd = tmpProject();
  try {
    mkdirSync(join(cwd, '.claude', 'conventions'), { recursive: true });
    writeFileSync(join(cwd, '.claude', 'conventions', 'docs.md'), '# Docs style\nEvery section needs a runnable example.\n');

    const run = baseRun(cwd);
    const n = baseNode({ stage: 'draft' });
    const sg = { id: 'D1', title: 'Guide', acceptance: ['reads well'], files: ['docs/guide.md'] };
    const prompt = composePrompt(run, n, baseBriefing({ subgoal: sg }));
    assert.ok(prompt.includes('Every section needs a runnable example.'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the conventions block is capped, with a truncation note naming what was cut', () => {
  const cwd = tmpProject();
  try {
    mkdirSync(join(cwd, '.claude', 'conventions'), { recursive: true });
    // One huge convention matching the target file's extension, well past the cap.
    const big = '# API rules\n' + 'x'.repeat(6000) + '\n';
    writeFileSync(join(cwd, '.claude', 'conventions', 'api.md'), big);

    const block = conventionsBlock(cwd, { stage: 'implement', files: ['src/api.md'] });
    assert.ok(block.length <= CONVENTIONS_CAP + 60);
    assert.match(block, /… \[conventions truncated at 4000 of \d+ chars\]/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------- setgoal unwinnable-criteria guard ----------

test('the setgoal contract forbids whole-repo-state criteria and aspirational/arbitrary thresholds by name', () => {
  const run = baseRun(tmpProject());
  const n = baseNode({ stage: 'setgoal' });
  const prompt = composePrompt(run, n, baseBriefing());
  assert.match(prompt.toLowerCase(), /whole-repo state/);
  assert.match(prompt.toLowerCase(), /aspirational/);
  assert.match(prompt.toLowerCase(), /arbitrary-threshold/);
});

// ---------- degenerate-spec diagnosis ----------

test('a setgoal retry after validateSpec rejected the draft gets the fixed diagnosis paragraph', () => {
  const cwd = tmpProject();
  try {
    const run = baseRun(cwd, {
      nodes: [
        {
          node_id: 'setgoal', stage: 'setgoal', deps: [], after: [], state: 'failed', attempt: 1,
          result: { stage_ok: false, spec_problems: ['subgoal U1 has no acceptance criteria'], reason: 'unusable spec: subgoal U1 has no acceptance criteria' },
        },
        {
          node_id: 'setgoal:2', stage: 'setgoal', deps: ['plan'], after: [], state: 'pending', attempt: 2,
          feedback: 'unusable spec: subgoal U1 has no acceptance criteria',
        },
      ],
    });
    const n = run.nodes[1];
    const briefing = nodeBriefing(run, n);
    assert.deepEqual(briefing.spec_problems, ['subgoal U1 has no acceptance criteria']);

    const prompt = composePrompt(run, n, briefing);
    assert.ok(prompt.includes(DEGENERATE_SPEC_DIAGNOSIS));
    assert.ok(prompt.includes('subgoal U1 has no acceptance criteria'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a setgoal retry after critique rejected the spec on its merits gets no degenerate-spec diagnosis', () => {
  const cwd = tmpProject();
  try {
    const run = baseRun(cwd, {
      nodes: [
        { node_id: 'setgoal', stage: 'setgoal', deps: [], after: [], state: 'done', attempt: 1, result: { stage_ok: true, spec: {} } },
        { node_id: 'critique', stage: 'critique', deps: ['setgoal'], after: [], state: 'failed', attempt: 1, result: { stage_ok: true, sound: false, blocking: ['the decomposition skips deployment entirely'] } },
        {
          node_id: 'setgoal:2', stage: 'setgoal', deps: ['plan'], after: [], state: 'pending', attempt: 2,
          feedback: 'the decomposition skips deployment entirely',
        },
      ],
    });
    const n = run.nodes[2];
    const briefing = nodeBriefing(run, n);
    assert.equal(briefing.spec_problems, null);

    const prompt = composePrompt(run, n, briefing);
    assert.ok(!prompt.includes(DEGENERATE_SPEC_DIAGNOSIS));
    assert.ok(prompt.includes('the decomposition skips deployment entirely'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------- handoff cap ----------

test('an upstream handoff over the cap is truncated with a marker naming the original length', () => {
  const cwd = tmpProject();
  const run = baseRun(cwd);
  const n = baseNode({ stage: 'gate', subgoal_id: 'U1' });
  const longHandoff = 'h'.repeat(HANDOFF_CAP + 500);
  const briefing = baseBriefing({
    upstream: [
      { node_id: 'implement:U1:1', stage: 'implement', state: 'done', handoff: longHandoff, evidence: '', checks: [], changed_files: [], commands: [] },
    ],
  });
  const prompt = composePrompt(run, n, briefing);
  assert.ok(!prompt.includes(longHandoff));
  assert.ok(prompt.includes('h'.repeat(HANDOFF_CAP)));
  assert.match(prompt, new RegExp(`… \\[handoff truncated at ${HANDOFF_CAP} of ${HANDOFF_CAP + 500} chars\\]`));
});

test('a short handoff is left exactly alone, in upstream and whole_run alike', () => {
  const cwd = tmpProject();
  const run = baseRun(cwd);
  const n = baseNode({ stage: 'report' });
  const shortHandoff = 'built the widget at src/widget.js';
  const briefing = baseBriefing({
    upstream: [
      { node_id: 'implement:U1:1', stage: 'implement', state: 'done', handoff: shortHandoff, evidence: '', checks: [], changed_files: [], commands: [] },
    ],
    whole_run: [
      { node_id: 'gate:U1:1', stage: 'gate', state: 'done', handoff: shortHandoff, evidence: '', checks: ['ran it -> passed'], changed_files: [], gaps: [] },
    ],
  });
  const prompt = composePrompt(run, n, briefing);
  const occurrences = prompt.split(shortHandoff).length - 1;
  assert.equal(occurrences, 2);
  assert.ok(!prompt.includes('truncated'));
});

// ---------- new-kind contracts: revise, cases, execute ----------

test('revise, cases and execute each get their own Required output contract, not the implement fallback', () => {
  const cwd = tmpProject();
  try {
    const run = baseRun(cwd);
    for (const stage of ['revise', 'cases', 'execute']) {
      const prompt = composePrompt(run, baseNode({ stage }), baseBriefing());
      assert.ok(prompt.includes('## Required output'));
      // The implement contract's own signature line - if this appears, the lookup fell
      // back instead of finding a contract keyed to this stage name.
      assert.doesNotMatch(prompt, /"handoff": "<paths, names, interfaces the dependent work needs>"/,
        `${stage} must not fall back to CONTRACT.implement`);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('reduce contract folds the set, reports every mismatch, and repairs nothing', () => {
  const cwd = tmpProject();
  try {
    const prompt = composePrompt(baseRun(cwd), baseNode({ stage: 'reduce' }), baseBriefing());
    assert.ok(prompt.includes('## Required output'));
    assert.doesNotMatch(prompt, /"handoff": "<paths, names, interfaces the dependent work needs>"/,
      'reduce must not fall back to CONTRACT.implement');
    for (const f of ['"declared"', '"undeclared"', '"collisions"', '"orphans"', '"repairs_needed"']) {
      assert.ok(prompt.includes(f), `${f} must be in the required output`);
    }
    // The level above decides; this stage only looks. A reduce that repaired what it found
    // would be deciding at the level that was asked to observe, and would hide the defect
    // from the gate that should have seen it.
    assert.match(prompt, /You report; you do not repair/);
    assert.match(prompt, /Change no files at all/);
    assert.doesNotMatch(prompt, /"changed_files"/, 'a stage that writes nothing claims no files');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('investigate contract demands sourced findings, separates them from unknowns, and refuses to punish an honest blank', () => {
  const cwd = tmpProject();
  try {
    const prompt = composePrompt(baseRun(cwd), baseNode({ stage: 'investigate' }), baseBriefing());
    assert.ok(prompt.includes('## Required output'));
    assert.doesNotMatch(prompt, /"handoff": "<paths, names, interfaces the dependent work needs>"/,
      'investigate must not fall back to CONTRACT.implement');
    assert.match(prompt, /"sources"/);
    assert.match(prompt, /"findings"/);
    assert.match(prompt, /"unknowns"/);
    // The distinction is the stage's whole point: an unsourced claim is an unknown, and a
    // stage that comes back mostly unknowns has still succeeded.
    assert.match(prompt, /a FINDING is something a source you opened says/);
    assert.match(prompt, /the unknowns ARE the deliverable/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the findings path is derived from the subgoal path, not chosen by the investigator', () => {
  const cwd = tmpProject();
  try {
    // Five sibling investigators naming their own files produced five conventions and an
    // orphan (idol-plan-2, 2026-09-23). The rule is fixed in the contract so that siblings and
    // later attempts land on one path, which is also what lets reduce tell an expected file
    // from an undeclared one.
    const prompt = composePrompt(baseRun(cwd), baseNode({ stage: 'investigate' }), baseBriefing());
    assert.match(prompt, /that path is derived, not chosen/);
    assert.match(prompt, /drop its extension, and append/);
    assert.match(prompt, /docs\/policy-findings\.md/);

    const red = composePrompt(baseRun(cwd), baseNode({ stage: 'reduce' }), baseBriefing());
    assert.match(red, /One file is expected without being declared/);
    assert.match(red, /a findings file under any OTHER name is/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the planning draft is told to write from investigate findings and to carry its unknowns rather than answer them', () => {
  const cwd = tmpProject();
  try {
    const prompt = composePrompt(baseRun(cwd), baseNode({ stage: 'draft' }), baseBriefing());
    assert.match(prompt, /the investigate stage above is your source/);
    assert.match(prompt, /carry every one of its unknowns into the document as an open question/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('revise contract allows editing and asks for claim-vs-evidence checks, unlike review', () => {
  const cwd = tmpProject();
  try {
    const prompt = composePrompt(baseRun(cwd), baseNode({ stage: 'revise' }), baseBriefing());
    assert.match(prompt, /you may edit the artifact/i);
    assert.match(prompt, /"changed_files"/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('execute contract asks for defects, forbids touching src/, and carries a verdict like test', () => {
  const cwd = tmpProject();
  try {
    const prompt = composePrompt(baseRun(cwd), baseNode({ stage: 'execute' }), baseBriefing());
    assert.match(prompt, /"defects"/);
    assert.match(prompt, /do not touch src\//i);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('cases contract writes a scenario spec derived from acceptance, not from the implementation', () => {
  const cwd = tmpProject();
  try {
    const prompt = composePrompt(baseRun(cwd), baseNode({ stage: 'cases' }), baseBriefing());
    assert.match(prompt, /scenario\/case specification/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------- planning-audit kind: the audit stage contract ----------
//
// taskmanager.mjs's openAudit opens these nodes now (v0.12.1 Task 2); these tests still only
// pin the contract text composePrompt produces when handed an audit node, the same way the
// revise/cases/execute tests above do for their own stages.

test('audit gets its own Required output contract, not the implement fallback', () => {
  const cwd = tmpProject();
  try {
    const prompt = composePrompt(baseRun(cwd), baseNode({ stage: 'audit' }), baseBriefing());
    assert.ok(prompt.includes('## Required output'));
    assert.doesNotMatch(prompt, /"handoff": "<paths, names, interfaces the dependent work needs>"/,
      'audit must not fall back to CONTRACT.implement');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('audit contract forbids editing files and asks for unmet user stories', () => {
  const cwd = tmpProject();
  try {
    const prompt = composePrompt(baseRun(cwd), baseNode({ stage: 'audit' }), baseBriefing());
    assert.match(prompt, /"unmet"/);
    assert.match(prompt, /do not modify any files/i);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('audit prompt reads correctly with no QA report present - no upstream section, contract still names the no-QA branch', () => {
  const cwd = tmpProject();
  try {
    const briefing = baseBriefing({ upstream: [] });
    const prompt = composePrompt(baseRun(cwd), baseNode({ stage: 'audit' }), briefing);
    assert.ok(!prompt.includes('## Completed upstream nodes'));
    assert.match(prompt, /if no qa report appears/i);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('audit prompt surfaces a QA report when present, via the ordinary upstream-nodes section', () => {
  const cwd = tmpProject();
  try {
    const briefing = baseBriefing({
      upstream: [
        {
          node_id: 'accept:QA:1', stage: 'gate', state: 'done',
          handoff: 'QA found 1 defect in checkout', evidence: '',
          checks: ['ran scenario -> failed'], changed_files: [], commands: [],
        },
      ],
    });
    const prompt = composePrompt(baseRun(cwd), baseNode({ stage: 'audit', deps: ['accept:QA:1'] }), briefing);
    assert.ok(prompt.includes('## Completed upstream nodes'));
    assert.ok(prompt.includes('accept:QA:1'));
    assert.match(prompt, /if a qa report appears/i);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('audit contract adds the product-owner pass: missing, duplication and volume questions, each with its own field', () => {
  const cwd = tmpProject();
  try {
    const prompt = composePrompt(baseRun(cwd), baseNode({ stage: 'audit' }), baseBriefing());
    // The three questions must be separately findable, both as named JSON fields and as
    // the prose instruction telling the agent what evidence belongs in each.
    assert.match(prompt, /"unowned"/);
    assert.match(prompt, /"duplication"/);
    assert.match(prompt, /"volume"/);
    assert.match(prompt, /map every requirement in the prd or request to the package that implemented it/i);
    assert.match(prompt, /name any responsibility two or more packages each implemented/i);
    assert.match(prompt, /for each package, give file\/loc\/test counts/i);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------- planning contract: PRD user stories ----------
//
// taskmanager.mjs's dispatch:PLAN bridge reads `g.user_stories` off the child run's own
// gate:goal result (composeTaskPrompt / finish()), and audit's contract already tells it to
// "Open the PRD and its user_stories[]" - so both ends (draft, which writes the PRD, and
// gate:goal, which is the only node that hands the ids back to the manager) must actually
// require them, not just audit's read of them.

test('draft contract requires a PRD to carry a "## User stories" section with US-n ids', () => {
  const cwd = tmpProject();
  try {
    const prompt = composePrompt(baseRun(cwd), baseNode({ stage: 'draft' }), baseBriefing());
    assert.match(prompt, /## User stories/);
    assert.match(prompt, /US-1/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('gate:goal contract requires user_stories[] (ids + acceptance[]) back in its JSON for a planning-kind run', () => {
  const cwd = tmpProject();
  try {
    const n = baseNode({ node_id: 'gate:goal:1', stage: 'gate' });
    const prompt = composePrompt(baseRun(cwd), n, baseBriefing());
    assert.match(prompt, /"user_stories"/);
    assert.match(prompt, /"id": "US-1"/);
    assert.match(prompt, /"acceptance"/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// A PRD governs the whole tree, so selecting conventions by the paths a subgoal touches was the
// wrong filter for it: a rule about how a domain works matches no source path, so it appeared as
// a title only. idol-pm-1 (2026-09-22) produced a domain-empty PRD with the mechanism right
// there. The manager's judging stages had no conventions wiring at all.

test('a planning subgoal gets every convention in full, not the ones its paths matched', () => {
  const cwd = tmpProject();
  try {
    mkdirSync(join(cwd, '.claude', 'conventions'), { recursive: true });
    writeFileSync(join(cwd, '.claude', 'conventions', 'domain.md'),
      '# Ticketing domain\nFan-club presale tiers decide priority before anything else.\n');

    const planning = conventionsBlock(cwd, { stage: 'planning' });
    assert.match(planning, /Fan-club presale tiers decide priority/, 'the body, not just the title');
    assert.match(planning, /requirements on what you write/);
    assert.match(planning, /named in Out of scope with the reason/, 'skipping a rule must be recorded');

    // What the path filter does instead: matchesFiles compares the file's extension and
    // directory names as substrings of the convention's path and title, so whether a domain rule
    // reaches the PRD is luck. ".md" happens to match ".../domain.md"; a subgoal writing
    // anything else drops the same rule to a title.
    const byPath = conventionsBlock(cwd, { stage: 'draft', files: ['a.py'] });
    assert.doesNotMatch(byPath, /Fan-club presale tiers decide priority/, 'the path filter drops it');
    assert.match(byPath, /domain\.md: Ticketing domain/, 'leaving only the title');
    // The planning stage does not depend on that luck: same call, files that match nothing.
    assert.match(conventionsBlock(cwd, { stage: 'planning', files: ['a.py'] }), /Fan-club presale tiers decide priority/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the manager stages are told to judge and shape against the project rules', () => {
  const cwd = tmpProject();
  try {
    mkdirSync(join(cwd, '.claude', 'conventions'), { recursive: true });
    writeFileSync(join(cwd, '.claude', 'conventions', 'domain.md'), '# Ticketing domain\nFan-club presale tiers decide priority.\n');
    const manager = conventionsBlock(cwd, { stage: 'manager' });
    assert.match(manager, /Fan-club presale tiers decide priority/);
    assert.match(manager, /Judge and shape against them/);
    assert.match(manager, /a result that ignores one has a gap/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// A seven-section PRD took 81 minutes because setgoal copied the product's story dependencies
// (U1 -> U3 -> U2 -> U4 -> U6) onto the sections that describe them, turning a set that could
// have been written at once into a chain (2026-09-22).
test('the setgoal contract defines deps as start-order, not subject-matter order', () => {
  const setgoal = CONTRACT.setgoal;
  assert.match(setgoal, /cannot START until that one has finished/);
  assert.match(setgoal, /not the order the product is built in/);
  assert.match(setgoal, /independent to WRITE even when the things they describe depend/);
  // Removing the deps must not create a shared-file conflict instead.
  assert.match(setgoal, /give each one the section it owns, by heading/);
});

// --- ask: the one briefing in this file written for a person (D2 step 2) ---

test('an ask card prints the choice, its consequences and who owns it', () => {
  const cwd = tmpProject();
  try {
    const n = baseNode({
      node_id: 'ask:P1:1', stage: 'ask', subgoal_id: 'P1',
      questions: [{
        question: 'How many tickets may one account hold?',
        owner: 'Product/policy',
        options: [
          { option: '2 across presale and general combined', consequence: 'scalpers buy two accounts' },
          { option: '2 per sale phase', consequence: 'one person can hold four' },
        ],
      }],
    });
    const prompt = composePrompt(baseRun(cwd), n, baseBriefing());
    assert.ok(prompt.includes('## Decisions waiting on you'));
    assert.ok(prompt.includes('How many tickets may one account hold?'));
    assert.ok(prompt.includes('Owner: Product/policy'));
    assert.ok(prompt.includes('2 across presale and general combined'));
    assert.ok(prompt.includes('scalpers buy two accounts'), 'a candidate without its consequence is not a choice');
    assert.match(prompt, /\[what the investigation would recommend\]/, 'the first candidate is the recommendation');
    // Its own contract, not implement's: this card is handed to a human, and the fallback
    // would ask them for changed_files.
    assert.ok(prompt.includes('"decisions"'));
    assert.doesNotMatch(prompt, /"handoff": "<paths, names, interfaces the dependent work needs>"/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the ask contract lets the answer be none of the candidates, and lets it be handed back', () => {
  assert.match(CONTRACT.ask, /not bound to the candidates/);
  assert.match(CONTRACT.ask, /leave this open/);
  assert.match(CONTRACT.ask, /nothing times it out/, 'zero compute while waiting is the promise, not a deadline');
});

test('investigate asks for candidates but is told that naming them is not deciding', () => {
  assert.match(CONTRACT.investigate, /"options"/);
  assert.match(CONTRACT.investigate, /two to four/);
  assert.match(CONTRACT.investigate, /This is not you deciding/);
});

test('draft is told an answered unknown is a rule, not an open question', () => {
  assert.match(CONTRACT.draft, /settled, not open/);
});

test('slack-list: a result that contradicts the request or regresses is a gap at the goal gate and a blocker at critique, not drift', () => {
  assert.match(CONTRACT['gate:goal'], /Narrowing is drift; contradicting is not/);
  assert.match(CONTRACT['gate:goal'], /breaks behaviour that worked before this run, it is a gap even when the spec asked for it/);
  assert.match(CONTRACT.critique, /a criterion that contradicts the request, or would break behaviour that works today/);
});

test('slack-list: the subgoal gate reads the comments the change wrote against its own evidence', () => {
  assert.match(CONTRACT.gate, /a cause or a behaviour the code, or this run's own evidence, contradicts is a gap/);
});

// P4:review:U1 (portfolio-refresh Sprint): a reviewer with no Bash rejected the same evidence
// twice on verified:false ("no Bash tool available in this reasoning node"), then passed on
// attempt 3 on the identical evidence - a tools gap read as a quality rejection because there
// was no third way to record it. review/gate now carry Bash (broker.mjs's --verify) for
// exactly the acceptance items a command names, and whatever --verify still cannot reach must
// come back as "unverifiable: <why>", never MISSING or a failing check.
test('P4:review:U1 - a tools gap is unverifiable, not a rejection, and review/gate can re-run what a command names', () => {
  assert.match(CONTRACT.review, /unverifiable: <why>/);
  assert.match(CONTRACT.review, /An acceptance item you have no tool to check is not a defect in the work/);
  assert.match(CONTRACT.review, /must not by itself cost verified, accept, or stage_ok/);
  assert.match(CONTRACT.review, /run it yourself with Bash rather than trusting the draft's report of it/);
  assert.match(CONTRACT.review, /do not use Bash to write, move, or commit anything in this tree/);
  assert.match(CONTRACT.review, /every item has a quoted passage or is marked unverifiable/);

  assert.match(CONTRACT.gate, /Re-run a check that names a command yourself with Bash/);
  assert.match(CONTRACT.gate, /An acceptance item you have no tool to check is not a defect in the work/);

  assert.match(CONTRACT['gate:goal'], /This stage carries Bash to run "checks" and "attacks" yourself/);
  assert.match(CONTRACT['gate:goal'], /An acceptance item you have no tool to check is not a defect in the work/);
});

test('portfolio-refresh: model instructions are run, not grepped - setgoal requires it, critique blocks without it', () => {
  assert.match(EXERCISE_RULE, /it is code, not a document/);
  assert.match(EXERCISE_RULE, /pre-change version run on the same input/);
  assert.ok(CONTRACT.setgoal.includes(EXERCISE_RULE));
  assert.match(CONTRACT.critique, /model instructions \(a skill, a prompt\) whose acceptance never runs them/);
});

test('portfolio-refresh: the manager shape, critique, accept and QA carry the same rule', async () => {
  const tm = await import('../mcp/taskmanager.mjs');
  const src = (await import('node:fs')).readFileSync(new URL('../mcp/taskmanager.mjs', import.meta.url), 'utf8');
  assert.ok(tm.CONTRACT.shape.includes(EXERCISE_RULE));
  assert.match(tm.CONTRACT.critique, /no acceptance item that runs them/);
  assert.match(tm.CONTRACT.accept, /a grep that the words are there is absent evidence for it/);
  assert.match(src, /Reading the file is a review, not QA\./);
});

// portfolio-consolidate-8518d5dd (teams 0.35.1): the request asked the beta not to regress
// feedback's verdict; the plan demanded equal tally counts the unchanged skill itself varies on
// (P3 failed 8 runs of a correct skill), P1 required the old jd-fit to show a mark it never
// shows, and P4 (main work) dep'd on P3 (a beta lane) - both critiques let all three through.
test('portfolio-consolidate-8518d5dd: a criterion holds work to the request\'s bar - PRD, setgoal and critique carry the rule', () => {
  assert.equal(typeof FIDELITY_RULE, 'string');
  assert.ok(!FIDELITY_RULE.includes('\n'), 'FIDELITY_RULE sits on the PRD Success criteria line - one line, no fake section');
  assert.match(FIDELITY_RULE, /the request's own bar, never a stricter one/);
  assert.match(FIDELITY_RULE, /never exact equality of a count/);
  assert.match(FIDELITY_RULE, /allows the spread the pre-change version shows between its own runs/);
  assert.match(FIDELITY_RULE, /never requires the old version to show a property it demonstrably lacks/);
  assert.match(FIDELITY_RULE, /a property it only might lack, with nothing you can read showing the lack, does not make the criterion stricter/);
  assert.match(FIDELITY_RULE, /Establish the lack by reading the pre-change version where you can - "git show <base>:<path>", or the old text the brief quotes/);
  assert.match(FIDELITY_RULE, /when the brief, the pre-change file or a run shows the old version lacks the property, the criterion is stricter than the request and blocks/);
  assert.match(FIDELITY_RULE, /comparing a verdict or a categorical choice across runs .* is allowed and is not a stricter bar/);
  assert.ok(CONTRACT.critique.includes('a property it demonstrably lacks'));
  assert.match(PRD_CONTRACT, /^  Success criteria - .*/m);
  assert.ok(PRD_CONTRACT.split('\n').find((l) => l.startsWith('  Success criteria -')).includes(FIDELITY_RULE));
  assert.ok(CONTRACT.setgoal.includes(EXERCISE_RULE) && CONTRACT.setgoal.includes(FIDELITY_RULE));
  assert.ok(CONTRACT.critique.includes(FIDELITY_RULE));
  assert.match(CONTRACT.critique, /a criterion stricter than the request/);
  assert.match(CONTRACT.critique, /A stricter bar counts as contradicting the request/);
  assert.match(CONTRACT.critique, /a criterion that contradicts the request, or would break behaviour that works today/);
});

test('portfolio-consolidate-8518d5dd: shape carries rules Five and Six, and its critique blocks both defects', async () => {
  const tm = await import('../mcp/taskmanager.mjs');
  const shape = tm.CONTRACT.shape;
  assert.match(shape, /Six rules critique will refuse the shape over/);
  assert.ok(shape.includes(`Five: ${FIDELITY_RULE}`));
  assert.match(shape, /Six: a package never deps, for any part of its own work, on a package whose failure the request tolerates/);
  assert.match(shape, /nor on a package of lower priority than itself, since a budget stop drops lower priority first/);
  assert.match(shape, /Every package is protected this way, whatever its own priority/);
  assert.match(shape, /A dep on a higher-priority package whose failure the request does not tolerate is fine/);
  assert.match(shape, /a tolerated package ranked above the dependent one by its priority number is still tolerated/);
  // the attempt-2 regression: priority restricting the PROTECTED side; "higher-priority" only in the "is fine" sense
  assert.doesNotMatch(shape, /main or higher-priority/);
  assert.equal(shape.match(/higher-priority/g).length, 1);
  assert.match(shape, /work the request says may fail/);
  assert.match(shape, /even when that part is a real data dependency/);
  assert.match(shape, /first, the dependent package does that part from the request alone, without the edge/);
  assert.match(shape, /move that part into the tolerated or lower-priority package itself, or into another package the request tolerates too - valid only when the move creates no touches\[\] overlap/);
  assert.ok(shape.indexOf('from the request alone') < shape.indexOf('move that part into the tolerated'), 'the no-edge remedy is listed first');
  assert.doesNotMatch(shape, /a later package/);
  const critique = tm.CONTRACT.critique;
  const iRun = critique.indexOf('unrunnable:');
  const iJudge = critique.indexOf('unjudgeable:');
  assert.ok(iRun >= 0 && iJudge > iRun, 'unrunnable: precedes unjudgeable:');
  const unrunnable = critique.slice(iRun, iJudge);
  const unjudgeable = critique.slice(iJudge);
  assert.match(unrunnable, /a dependency on a package whose failure the request tolerates \(an experimental, beta or optional lane, or work the request says may fail\)/);
  assert.match(unrunnable, /or on a package of lower priority than the dependent one \(a budget stop drops lower priority first\)/);
  assert.match(unrunnable, /it protects every package, whatever its own priority/);
  assert.match(unrunnable, /a beta lane ranked above the dependent package is still tolerated/);
  assert.match(unrunnable, /A dep on a higher-priority package whose failure the request does not tolerate is fine/);
  assert.doesNotMatch(critique, /main or higher-priority/);
  assert.equal(critique.match(/higher-priority/g).length, 1);
  assert.match(critique, /deps on a package whose failure the request tolerates, whatever their priority numbers, or on a package of lower priority than itself - blocking/);
  assert.match(unrunnable, /blocks even when the brief names a real data dependency/);
  assert.match(unrunnable, /first, the dependent package does that part from the request alone, without the edge/);
  assert.match(unrunnable, /is a fix only when it creates no touches\[\] overlap/);
  assert.doesNotMatch(critique, /a later package/);
  assert.match(unjudgeable, /a goal-level or package acceptance criterion stricter than the request/);
  assert.match(unjudgeable, /exact agreement between model runs/);
  assert.match(unjudgeable, /a pre-change version required to show a property it demonstrably lacks/);
  assert.match(unjudgeable, /not a property it might lack/);
  assert.match(unjudgeable, /when the brief or the pre-change file shows the lack, the criterion blocks/);
  assert.match(unjudgeable, /Agreement on a verdict or a categorical choice across runs is not stricter and does not block/);
  assert.ok(unjudgeable.includes(FIDELITY_RULE), 'the shape critique quotes the one rule');
  assert.match(unjudgeable, /A criterion you would merely improve is a problem, not a blocker: block only a criterion that correct work would fail/);
  assert.match(unjudgeable, /block every such criterion, the one with a rerun clause included/);
  assert.doesNotMatch(unrunnable, /stricter than the request/);
  assert.match(unjudgeable, /allows a rerun on mismatch but still demands exact agreement/);
  assert.match(unjudgeable, /not a cure/);
  assert.match(critique, /three kinds/);
});

// QUESTIONS_CONTRACT had two byte-identical literals (prompts.mjs and taskmanager.mjs, D2 slice 3,
// 0.29.0); the 2026-10-02 architecture review folded them into one export so the child-run graph's
// stages and the manager's judging stages cannot drift apart on the questions[] wording.
test('QUESTIONS_CONTRACT: exported once from prompts.mjs, imported (not copied) by stagecontract.mjs', async () => {
  const prompts = await import('../mcp/prompts.mjs');
  assert.equal(typeof prompts.QUESTIONS_CONTRACT, 'string');
  assert.match(prompts.QUESTIONS_CONTRACT, /^Optional: "questions": \[/);
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../mcp/taskmanager.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /const QUESTIONS_CONTRACT\b/, 'no local copy in taskmanager.mjs');
  const contractSrc = readFileSync(new URL('../mcp/stagecontract.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(contractSrc, /const QUESTIONS_CONTRACT\b/, 'no local copy in stagecontract.mjs');
  assert.match(contractSrc, /^import \{[^}]*\bQUESTIONS_CONTRACT\b[^}]*\} from '\.\/prompts\.mjs';$/m);
});

// ---------- the project wiki paragraph ----------

import { JUDGING_STAGES } from '../mcp/routing.mjs';

const WIKI_HEAD = '## Project wiki';
const NO_WIKI_LINE = 'Do not read or write the project wiki; it is not evidence.';
const WIKI_CWD = '/tmp/wiki-prompt-cwd'; // never touched: composePrompt only prints it
const wikiPrompt = (nodeOver, runOver = {}, stage = 'implement') =>
  composePrompt(baseRun(WIKI_CWD, runOver), baseNode({ stage, node_id: 'implement:U1:1', ...nodeOver }), baseBriefing());

test('wiki paragraph: a claude or codex executor (adapter, self on its host, null on its host) gets it', () => {
  for (const [label, node, run] of [
    ['adapter claude', { executor: 'claude', vendor: 'claude' }, {}],
    ['self claude', { executor: 'claude', vendor: 'self' }, { host_vendor: 'codex' }],
    ['null executor, host claude', {}, { host_vendor: 'claude' }],
    ['codex adapter', { executor: 'codex', vendor: 'codex' }, { host_vendor: 'claude' }],
    ['self codex', { executor: 'codex', vendor: 'self' }, { host_vendor: 'claude' }],
    ['null executor, host codex', {}, { host_vendor: 'codex' }],
  ]) {
    const p = wikiPrompt(node, run);
    assert.ok(p.includes(WIKI_HEAD), label);
    assert.ok(p.includes('source = "implement:U1:1"'), `${label}: the literal node id`);
    assert.match(p, /wiki_search \(and wiki_get\)/);
    assert.match(p, /worth remembering later/);
    assert.doesNotMatch(p, /EPIC|wiki_resume|space log/);
    assert.match(p, /wiki_write/);
    assert.match(p, /\[\[space\/slug\]\]/);
    assert.ok(!p.includes(NO_WIKI_LINE), label);
  }
});

test('wiki paragraph: a prompt that gets neither block is the claude prompt minus exactly that paragraph', () => {
  const withWiki = wikiPrompt({ executor: 'claude', vendor: 'claude' });
  const without = wikiPrompt({ executor: 'human', vendor: 'human', assignment: { executor: 'human' } });
  const start = withWiki.indexOf(WIKI_HEAD);
  const end = withWiki.indexOf('\n\n', start) + 2;
  assert.equal(withWiki.slice(0, start) + withWiki.slice(end), without);
});

test('every judging stage gets the one no-wiki line for every executor, and never the paragraph', () => {
  assert.deepEqual([...JUDGING_STAGES].sort(), ['accept', 'audit', 'critique', 'execute', 'gate', 'review', 'test']);
  for (const stage of JUDGING_STAGES) {
    for (const node of [{ executor: 'claude', vendor: 'claude' }, { executor: 'claude', vendor: 'self' }, { executor: 'codex', vendor: 'codex' }, {}]) {
      const p = wikiPrompt(node, { host_vendor: 'claude' }, stage);
      assert.ok(p.includes(NO_WIKI_LINE), `${stage} ${JSON.stringify(node)}`);
      assert.ok(!p.includes(WIKI_HEAD), stage);
    }
  }
});

test('wiki: a node pinned to a person gets neither the paragraph nor the line', () => {
  const p = wikiPrompt({ executor: 'human', vendor: 'human', assignment: { executor: 'human' } }, { host_vendor: 'claude' });
  assert.ok(!p.includes(WIKI_HEAD) && !p.includes(NO_WIKI_LINE));
});
