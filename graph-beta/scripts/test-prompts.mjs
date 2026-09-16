import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { composePrompt, HANDOFF_CAP, DEGENERATE_SPEC_DIAGNOSIS } from '../mcp/prompts.mjs';
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
