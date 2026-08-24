#!/usr/bin/env node
// codex-runner - external automation harness runner backed by Codex CLI.
//
// This is intentionally separate from pipeline.js and fallback.md. Claude's Workflow
// path remains unchanged. Active Codex sessions should not invoke this recursively; they
// should follow AGENTS.md and run the harness contract directly with native Codex tools.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADAPTER = join(HERE, 'codex-exec-adapter.mjs');
const CHECK = join(HERE, 'fallback-check.mjs');
const GOAL_MATCH_THRESHOLD = 90;

function usage() {
  process.stderr.write(
    'usage: node harness/engine/codex-runner.mjs --request TEXT [--cwd DIR] [--run-dir DIR] [--max-retries N]\n' +
      '   or: node harness/engine/codex-runner.mjs --request-file FILE [--cwd DIR] [--run-dir DIR] [--max-retries N]\n',
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const opts = { cwd: process.cwd(), maxRetries: 2 };
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  const val = args[i + 1];
  if (key === '--request') {
    opts.request = val;
    i++;
  } else if (key === '--request-file') {
    opts.requestFile = val;
    i++;
  } else if (key === '--cwd') {
    opts.cwd = val;
    i++;
  } else if (key === '--run-dir') {
    opts.runDir = val;
    i++;
  } else if (key === '--max-retries') {
    opts.maxRetries = Number(val);
    i++;
  } else {
    usage();
  }
}

if (opts.requestFile) opts.request = readFileSync(resolve(opts.requestFile), 'utf8');
if (!opts.request || !Number.isInteger(opts.maxRetries) || opts.maxRetries < 0) usage();

const cwd = resolve(opts.cwd);
const slug = String(opts.request)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48) || 'codex-run';
const runDir = resolve(opts.runDir || join(cwd, '.harness-run', slug));

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeText(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, String(value || '').trim() + '\n');
}

function runNode(args, label) {
  const result = spawnSync('node', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('empty JSON response');
  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1].trim());
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error(`no JSON object found in response: ${raw.slice(0, 500)}`);
}

function codexStage({ label, prompt, sandbox = 'read-only' }) {
  const promptPath = join(runDir, 'prompts', `${label}.md`);
  const summaryPath = join(runDir, 'events', `${label}.codex.json`);
  const eventsPath = join(runDir, 'events', `${label}.codex.events.jsonl`);
  writeText(promptPath, prompt);
  runNode([
    ADAPTER,
    '--cwd',
    cwd,
    '--prompt-file',
    promptPath,
    '--events-output',
    eventsPath,
    '--output',
    summaryPath,
    '--sandbox',
    sandbox,
  ], `codex stage ${label}`);
  const summary = readJson(summaryPath);
  if (!summary.ok) throw new Error(`codex stage ${label} returned non-ok summary`);
  return summary.last_message || summary.stdout || '';
}

function normalizeSubgoal(raw, index) {
  const id = String(raw.id || `s${index + 1}`).replace(/[^A-Za-z0-9._-]/g, '-');
  return {
    id,
    title: String(raw.title || `Subgoal ${index + 1}`),
    persona: raw.persona ? String(raw.persona) : '',
    skills: Array.isArray(raw.skills) ? raw.skills.map(String) : [],
    acceptance: Array.isArray(raw.acceptance) ? raw.acceptance.map(String) : [],
    test: Array.isArray(raw.test) ? raw.test.map(String) : [],
    deps: Array.isArray(raw.deps) ? raw.deps.map(String) : [],
  };
}

function orderSubgoals(subgoals) {
  const byId = new Map(subgoals.map((sg) => [sg.id, sg]));
  const done = new Set();
  const ordered = [];
  while (ordered.length < subgoals.length) {
    const ready = subgoals.find((sg) => !done.has(sg.id) && (sg.deps || []).every((d) => done.has(d) || !byId.has(d)));
    if (!ready) {
      for (const sg of subgoals) {
        if (!done.has(sg.id)) {
          ordered.push(sg);
          done.add(sg.id);
        }
      }
      break;
    }
    ordered.push(ready);
    done.add(ready.id);
  }
  return ordered;
}

function rejectionSig(verdict) {
  const norm = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const gaps = (verdict.gaps || []).map(norm).filter(Boolean).sort();
  return JSON.stringify([gaps, norm(verdict.reason)]);
}

function initRun() {
  ensureDir(runDir);
  writeJson(join(runDir, 'manifest.json'), {
    runner: 'codex',
    request: opts.request,
    max_retries: opts.maxRetries,
    subgoals: [],
    stages: {},
  });
  const detect = spawnSync('node', [
    ADAPTER,
    '--detect',
    '--cwd',
    cwd,
    '--output',
    join(runDir, 'providers.json'),
  ], { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (detect.status !== 0 && !existsSync(join(runDir, 'providers.json'))) {
    writeJson(join(runDir, 'providers.json'), {
      codex: { available: false, ready: false },
      error: detect.stderr || detect.stdout || 'codex detect failed',
    });
  }
}

function planStage() {
  const plan = codexStage({
    label: '01-plan',
    prompt:
      `Act as a systems analyst decomposing work into crisp, independently-verifiable, ` +
      `dependency-mapped units. Do not implement.\n\nRequest:\n${opts.request}\n\n` +
      `Return a concise Markdown plan with: units, real dependencies, likely repo skills, ` +
      `executor persona, deterministic checks, and relevant local conventions if present.`,
  });
  writeText(join(runDir, '01-plan.md'), plan);
  return plan;
}

function setGoalStage(plan) {
  const specText = codexStage({
    label: '02-setgoal',
    prompt:
      `Turn this request and plan into strict JSON matching harness/goal-spec.md.\n` +
      `Return only JSON. Include goal, goal-level acceptance[], subgoals[], and max_retries.\n` +
      `Each subgoal needs id, title, persona, skills[], acceptance[], test[], deps[].\n` +
      `Every acceptance/test entry must check the unit's own artifacts, not global repo state.\n` +
      `Do not use subjective or arbitrary-threshold criteria as hard pass/fail bars.\n\n` +
      `Request:\n${opts.request}\n\nPlan:\n${plan}`,
  });
  const spec = extractJson(specText);
  spec.subgoals = (spec.subgoals || []).map(normalizeSubgoal);
  if (!Array.isArray(spec.acceptance) || !spec.acceptance.length) {
    spec.acceptance = ['The assembled result satisfies the original request with deterministic evidence.'];
  }
  if (!spec.goal) spec.goal = opts.request;
  if (!Number.isInteger(spec.max_retries)) spec.max_retries = opts.maxRetries;
  writeJson(join(runDir, '02-goal-spec.json'), spec);

  const critiqueText = codexStage({
    label: '02-critique',
    prompt:
      `Adversarially critique this goal spec. Return only JSON: ` +
      `{"sound": boolean, "problems": string[]}.\n\nSpec:\n${JSON.stringify(spec, null, 2)}`,
  });
  const critique = extractJson(critiqueText);
  writeJson(join(runDir, '02-critique.json'), critique);
  return spec;
}

function updateManifest(subgoals) {
  const manifest = readJson(join(runDir, 'manifest.json'));
  manifest.subgoals = subgoals.map((sg, order) => ({ id: sg.id, order }));
  manifest.stages = {
    plan: '01-plan.md',
    setgoal: '02-goal-spec.json',
    critique: '02-critique.json',
  };
  writeJson(join(runDir, 'manifest.json'), manifest);
}

function runSubgoal(spec, sg, completed) {
  const dir = join(runDir, 'subgoals', sg.id);
  ensureDir(dir);
  const maxAttempts = 1 + (Number.isInteger(spec.max_retries) ? spec.max_retries : opts.maxRetries);
  let feedback = '';
  let prevSig = null;
  let finalVerdict = null;
  let attempt = 0;

  for (attempt = 1; attempt <= maxAttempts; attempt++) {
    const deps = (sg.deps || [])
      .map((id) => completed.get(id))
      .filter(Boolean)
      .map((item) => `- ${item.id}: ${item.handoff}`)
      .join('\n');
    const impl = codexStage({
      label: `impl-${sg.id}-${attempt}`,
      sandbox: 'workspace-write',
      prompt:
        `Goal: ${spec.goal}\nSubgoal: ${sg.title}\nPersona: ${sg.persona || 'software engineer'}\n` +
        `Skills to consider: ${(sg.skills || []).join(', ') || '(none)'}\n` +
        `Acceptance:\n${(sg.acceptance || []).map((a) => `- ${a}`).join('\n')}\n` +
        (deps ? `\nDependency handoffs:\n${deps}\n` : '') +
        (feedback ? `\nPrevious rejection to fix:\n${feedback}\n` : '') +
        `\nImplement the subgoal in this repository. End with a HANDOFF section under 1500 chars ` +
        `listing produced/changed paths, commands run, and interfaces for dependent work.`,
    });
    writeText(join(dir, `impl-${attempt}.md`), impl);

    const evidenceText = codexStage({
      label: `test-${sg.id}-${attempt}`,
      sandbox: 'workspace-write',
      prompt:
        `Independently verify this subgoal. Do not trust the implementation narrative. ` +
        `Run or inspect the concrete checks, then return only JSON: ` +
        `{"verified": boolean, "checks": string[], "evidence": string}.\n\n` +
        `Subgoal: ${sg.title}\nChecks:\n${(sg.test || []).map((t) => `- ${t}`).join('\n') || '- Inspect claimed artifacts directly'}\n\n` +
        `Implementation account:\n${impl}`,
    });
    const evidence = extractJson(evidenceText);
    writeJson(join(dir, `test-${attempt}.json`), evidence);

    const verdictText = codexStage({
      label: `gate-${sg.id}-${attempt}`,
      prompt:
        `Judge the subgoal against acceptance criteria. You did not implement it. ` +
        `Weigh independent evidence over the implementation account. Return only JSON: ` +
        `{"pass": boolean, "reason": string, "gaps": string[]}.\n\n` +
        `Acceptance:\n${(sg.acceptance || []).map((a) => `- ${a}`).join('\n')}\n\n` +
        `Evidence:\n${JSON.stringify(evidence, null, 2)}\n\nImplementation account:\n${impl}`,
    });
    finalVerdict = extractJson(verdictText);
    writeJson(join(dir, `gate-${attempt}.json`), finalVerdict);

    if (finalVerdict.pass) {
      const handoff = impl.match(/HANDOFF:\s*([\s\S]+)$/i)?.[1]?.trim() || impl.slice(0, 1500);
      writeJson(join(dir, 'result.json'), { id: sg.id, passed: true, attempts: attempt });
      return { id: sg.id, passed: true, attempts: attempt, handoff };
    }

    const sig = rejectionSig(finalVerdict);
    if (sig && sig === prevSig) break;
    prevSig = sig;
    feedback = `${finalVerdict.reason || 'rejected'}\n${(finalVerdict.gaps || []).map((g) => `- ${g}`).join('\n')}`;
  }

  writeJson(join(dir, 'result.json'), { id: sg.id, passed: false, attempts: attempt, stalled: attempt < maxAttempts });
  return {
    id: sg.id,
    passed: false,
    attempts: attempt,
    handoff: finalVerdict ? finalVerdict.reason : 'no verdict',
  };
}

function goalGateStage(spec, results) {
  const gateText = codexStage({
    label: '04-goal-gate',
    prompt:
      `Judge the assembled whole against the goal-level acceptance. Return only JSON: ` +
      `{"match_pct": number, "pass": boolean, "reason": string, "gaps": string[]}.\n` +
      `pass must be true only when match_pct >= ${GOAL_MATCH_THRESHOLD}.\n\n` +
      `Goal: ${spec.goal}\nAcceptance:\n${(spec.acceptance || []).map((a) => `- ${a}`).join('\n')}\n\n` +
      `Subgoal results:\n${JSON.stringify(results, null, 2)}`,
  });
  const gate = extractJson(gateText);
  gate.pass = Number(gate.match_pct) >= GOAL_MATCH_THRESHOLD;
  writeJson(join(runDir, '04-goal-gate.json'), gate);
  return gate;
}

function reportStage(spec, results, goalGate) {
  const report = codexStage({
    label: '05-report',
    prompt:
      `Write a concise final harness report for the requester. Outcome first, honest about failures, ` +
      `no invented claims.\n\nRequest: ${opts.request}\nGoal: ${spec.goal}\n` +
      `Goal gate: ${JSON.stringify(goalGate)}\nSubgoals:\n${JSON.stringify(results, null, 2)}`,
  });
  writeText(join(runDir, '05-report.md'), report);
}

function main() {
  initRun();
  const plan = planStage();
  const spec = setGoalStage(plan);
  const subgoals = orderSubgoals((spec.subgoals || []).map(normalizeSubgoal));
  updateManifest(subgoals);

  const completed = new Map();
  const results = [];
  for (const sg of subgoals) {
    const result = runSubgoal(spec, sg, completed);
    completed.set(sg.id, result);
    results.push(result);
  }
  const goalGate = goalGateStage(spec, results);
  reportStage(spec, results, goalGate);

  const check = runNode([CHECK, runDir], 'fallback check');
  process.stdout.write(check.stdout || '');
  process.stdout.write(`run_dir=${runDir}\n`);
}

main();
