// test-skillrefs.mjs - every skill the engine names must actually be mountable.
//
// The bug this covers (2026-09-22): KINDS.planning.skills.draft named 'pm:prd-development',
// but pm is not published in the marketplace, so the plugin could never be mounted and the
// reference was silently dropped. The planning draft node therefore ran with no PRD method at
// all, and the PRD it produced was a module-level design spec with zero user stories. A skill
// reference that cannot resolve is a defect, not a graceful degradation: the contract text is
// written assuming the method arrives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS } from '../mcp/graph.mjs';
import { GRAPH_STAGE_SKILLS } from '../mcp/mounts.mjs';
import { STAGE_SKILLS } from '../mcp/taskmanager.mjs';
import { PRD_CONTRACT } from '../mcp/prompts.mjs';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function publishedPlugins() {
  const m = JSON.parse(readFileSync(join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8'));
  return new Set((m.plugins || []).map((p) => p.name));
}

function everySkillReference() {
  const out = new Map(); // skill -> where it is named
  const add = (skill, where) => { if (!out.has(skill)) out.set(skill, where); };
  for (const [kind, def] of Object.entries(KINDS)) {
    for (const [stage, list] of Object.entries(def.skills || {})) {
      for (const s of list) add(s, `KINDS.${kind}.skills.${stage}`);
    }
  }
  for (const [stage, list] of Object.entries(GRAPH_STAGE_SKILLS)) {
    for (const s of list || []) add(s, `GRAPH_STAGE_SKILLS.${stage}`);
  }
  for (const [stage, list] of Object.entries(STAGE_SKILLS)) {
    for (const s of list || []) add(s, `STAGE_SKILLS.${stage}`);
  }
  return out;
}

test('every engine skill reference names a published plugin', () => {
  const published = publishedPlugins();
  const bad = [];
  for (const [skill, where] of everySkillReference()) {
    const plugin = skill.split(':')[0];
    if (!published.has(plugin)) bad.push(`${skill} (${where}) - plugin "${plugin}" is not in marketplace.json`);
  }
  assert.deepEqual(bad, [], `unmountable skill references:\n  ${bad.join('\n  ')}`);
});

test('every engine skill reference exists on disk', () => {
  const bad = [];
  for (const [skill, where] of everySkillReference()) {
    const [plugin, name] = skill.split(':');
    if (!existsSync(join(REPO, plugin, 'skills', name, 'SKILL.md'))) bad.push(`${skill} (${where})`);
  }
  assert.deepEqual(bad, [], `skill references with no SKILL.md:\n  ${bad.join('\n  ')}`);
});

test('the engine names no PM plugin - the PRD method is inlined instead', () => {
  for (const [skill] of everySkillReference()) {
    assert.notEqual(skill.split(':')[0], 'pm', `${skill} is back; pm is unpublished and can never mount`);
  }
  assert.match(PRD_CONTRACT, /You are writing this request's planning documents/);
});

test('PRD_CONTRACT names every section the PRD must carry', () => {
  for (const section of ['Problem', 'Target users', 'Solution overview', 'Success criteria', 'User stories', 'Out of scope', 'Open questions']) {
    assert.match(PRD_CONTRACT, new RegExp(`^  ${section} -`, 'm'), `PRD_CONTRACT does not require a "${section}" section`);
  }
});

test('PRD_CONTRACT keeps design work out of the PRD', () => {
  // The measured failure: the PRD opened at package splits and data shapes, doing shape's job.
  assert.match(PRD_CONTRACT, /not a design spec/);
  assert.match(PRD_CONTRACT, /shaping stage's job/);
});

test('the planning draft contract carries the PRD contract', async () => {
  const { composePrompt } = await import('../mcp/prompts.mjs');
  const run = { run_id: 'r1', flow: 'plan', goal: 'Produce a PRD for X', cwd: '/tmp/x', allocation: 'balanced', nodes: [] };
  const n = { node_id: 'draft:U1:1', stage: 'draft', subgoal_id: 'U1', attempt: 1 };
  const briefing = { subgoal: { id: 'U1', title: 'PRD', kind: 'planning', acceptance: ['a'], files: ['PRD.md'] }, upstream: [], problems: [] };
  assert.ok(composePrompt(run, n, briefing).includes("You are writing this request's planning documents"));
});

// Both real planning runs wrote one PRD in sections and filed the domain's own rules under Out
// of scope or an open question (idol-pm-2, 2026-09-22: fan-club presale "assumed to exist" with
// no story; refunds, transfers and the price catalog all excluded). Nobody asked for one
// document - setgoal simply never heard that deciding the set was its job.
test('a planning setgoal is told to decide its own document set', async () => {
  const { composePrompt, PLANNING_SETGOAL } = await import('../mcp/prompts.mjs');
  assert.match(PLANNING_SETGOAL, /SET of planning documents/);
  assert.match(PLANNING_SETGOAL, /floor, never the ceiling/);
  assert.match(PLANNING_SETGOAL, /do not produce four documents because that sentence lists four/);

  const run = { run_id: 'r1', flow: 'plan', goal: 'Produce a PRD for X', cwd: '/tmp/x', allocation: 'balanced', nodes: [] };
  const setgoal = composePrompt(run, { node_id: 'setgoal', stage: 'setgoal' }, { upstream: [], problems: [], flow: 'plan', default_kind: 'planning' });
  assert.ok(setgoal.includes('SET of planning documents'), 'the planning setgoal hears it');

  // Not a document run, not a develop run - this is planning's own instruction.
  const docRun = { ...run, flow: 'document' };
  const docSetgoal = composePrompt(docRun, { node_id: 'setgoal', stage: 'setgoal' }, { upstream: [], problems: [], flow: 'document', default_kind: 'document' });
  assert.ok(!docSetgoal.includes('SET of planning documents'), 'a document run is not handed planning\'s set rule');
});

// Out of scope had become the cheapest way past the domain clause: name the practice, exclude
// it, pass. A rule a user story rests on is decided or owned, never filed.
test('PRD_CONTRACT closes the Out-of-scope escape hatch for undecided rules', () => {
  assert.match(PRD_CONTRACT, /not a place to put a rule you did not decide/);
  assert.match(PRD_CONTRACT, /Open question with a named owner/);
  assert.match(PRD_CONTRACT, /an omission wearing a heading/);
});

// idol-pm-1 (2026-09-22) produced a PRD whose own accept node called it "a generic high-demand
// ticketing PRD with 'idol concert' in the title": fan-club / presale / membership / tour scored
// zero mentions, `bot` scored 41. The contract asked for the seven sections and nothing about
// the domain, so the model filled them from what it already knew.
test('PRD_CONTRACT makes the domain a requirement, not a hope', () => {
  assert.match(PRD_CONTRACT, /name the domain the request belongs to/);
  // The failure mode named, so the model can recognise itself doing it.
  assert.match(PRD_CONTRACT, /general version of a problem is the one you already know/);
  // Its own vocabulary, not a neutral paraphrase.
  assert.match(PRD_CONTRACT, /domain's own vocabulary/);
  // And the escape hatch is explicit scoping, never silence.
  assert.match(PRD_CONTRACT, /named in Out of scope/);
  assert.match(PRD_CONTRACT, /has not been scoped, it has been overlooked/);
});
