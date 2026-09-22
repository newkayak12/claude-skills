// inspect-collect.mjs - what actually happened in a task, as data.
//
// view.mjs answers "where is it now". This answers "what did it do": for every node, the
// method it was told to load, the method it reported loading, what it wrote, and where its
// prompt and result are on disk. It exists because everything here was already being written
// to disk and none of it was reachable without hand-written scripts - which is how the
// 0.18.0 bug (no node had ever loaded a skill) survived every run until someone went looking.
//
// Pure reads. No model calls, no network, never mutates a run.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { loadRunAt, runState, kindSkills, kindOf, KINDS } from '../../mcp/graph.mjs';
import { graphStageSkills } from '../../mcp/mounts.mjs';
import { STAGE_SKILLS } from '../../mcp/taskmanager.mjs';
import { epicKey, storyKey, epicTicketState, storyTicketState } from '../../mcp/tickets.mjs';

const REASONING_VERDICT = { critique: 'sound', dispatch: 'accept', accept: 'accept', integrate: 'verified', gate: 'accept' };

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function sanitize(nodeId) { return String(nodeId).replace(/[^A-Za-z0-9._-]/g, '_'); }

// Every workspace/task shape this accepts: a bench workspace (holds .harness-tasks/), a tasks
// root (holds <task-id>/task.json), or a single task directory.
export function findTasks(path) {
  const out = [];
  const tryTask = (dir) => {
    const f = join(dir, 'task.json');
    const t = readJson(f);
    if (t && Array.isArray(t.nodes)) out.push({ dir, task: t });
  };
  if (!existsSync(path)) return out;
  tryTask(path);
  for (const sub of ['.harness-tasks', '']) {
    const root = sub ? join(path, sub) : path;
    let entries = [];
    try { entries = readdirSync(root); } catch { continue; }
    for (const e of entries) {
      const d = join(root, e);
      try { if (!statSync(d).isDirectory()) continue; } catch { continue; }
      if (out.some((o) => o.dir === d)) continue;
      tryTask(d);
    }
  }
  return out;
}

// The method a manager node was told to load. Mirrors taskmanager's stageSkills, which is not
// exported: an override object or `false` on the task wins over the built-in table.
export function managerSkillsAsked(task, n) {
  if (task.stage_skills === false) return [];
  const key = String(n.node_id).startsWith('gate:goal') ? 'gate:goal' : n.stage;
  const override = task.stage_skills && typeof task.stage_skills === 'object' ? task.stage_skills[key] : undefined;
  return (Array.isArray(override) ? override : STAGE_SKILLS[key] || []).map(String);
}

// The method a child-run node was told to load: a subgoal's own skills for an authoring stage,
// otherwise the kind's, plus whatever the stage itself mounts (mounts.mjs).
export function childSkillsAsked(run, n) {
  const asked = new Set();
  for (const s of graphStageSkills(run, n)) asked.add(s);
  const sgId = String(n.node_id).includes(':') ? String(n.node_id).split(':')[1] : null;
  const sg = sgId && run.spec && Array.isArray(run.spec.subgoals)
    ? run.spec.subgoals.find((x) => String(x.id) === sgId) : null;
  if (sg) {
    const kind = kindOf(sg);
    const own = Array.isArray(sg.skills) && sg.skills.length ? sg.skills : null;
    const chainStage = (KINDS[kind] && KINDS[kind].chain) || [];
    const authoring = chainStage.includes(n.stage) && n.stage !== 'gate';
    for (const s of (authoring && own) ? own : kindSkills(kind, n.stage)) asked.add(s);
  }
  return [...asked].map(String);
}

function skillsUsed(n) {
  const r = n.result || {};
  if (!Array.isArray(r.skills_used)) return null;           // the node was never asked to report
  const used = r.skills_used.map(String).filter((s) => s && s !== 'none');
  return used;
}

// Where this node's prompt and result were written. Two layouts, both real: a self-routed node
// writes <task>/briefings/<node>.md (manager) or <broker>/<run>/briefings/<node>.md (child); a
// vendor node writes <broker>/<run>/<node>/<ticket>/{prompt.md,result.json}.
function nodeFiles({ taskDir, runDir, run, n }) {
  const files = {};
  const name = `${sanitize(n.node_id)}.md`;
  for (const base of [taskDir && join(taskDir, 'briefings'), runDir && join(runDir, 'briefings')]) {
    if (base && existsSync(join(base, name))) { files.prompt = join(base, name); break; }
  }
  if (runDir && n.ticket) {
    const d = join(runDir, sanitize(n.node_id), String(n.ticket));
    if (existsSync(join(d, 'prompt.md'))) files.prompt = join(d, 'prompt.md');
    if (existsSync(join(d, 'result.json'))) files.result = join(d, 'result.json');
    if (existsSync(join(d, 'events.jsonl'))) files.events = join(d, 'events.jsonl');
  }
  if (!files.result && n.detail_path && existsSync(n.detail_path)) files.result = n.detail_path;
  void run;
  return files;
}

function nodeRow(n, asked, files) {
  const r = n.result || {};
  const verdictField = REASONING_VERDICT[n.stage];
  return {
    node_id: n.node_id,
    stage: n.stage,
    state: n.state,
    skills_asked: asked,
    skills_used: skillsUsed(n),
    changed_files: Array.isArray(r.changed_files) ? r.changed_files.map(String) : [],
    checks: Array.isArray(r.checks) ? r.checks.length : 0,
    gaps: Array.isArray(r.gaps) ? r.gaps.map(String) : [],
    defects: Array.isArray(r.defects) ? r.defects.length : null,
    unmet: Array.isArray(r.unmet) ? r.unmet.map(String) : null,
    user_stories: Array.isArray(r.user_stories) ? r.user_stories.length : null,
    match_pct: r.match_pct === undefined ? null : r.match_pct,
    verdict: verdictField && r[verdictField] !== undefined ? r[verdictField] : null,
    reason: n.state === 'failed' || n.state === 'blocked' ? String(r.reason || '') : '',
    files,
  };
}

// A run file is looked for under every root that could hold it, not only the cwd the node
// recorded: a workspace that was moved or archived keeps its runs, and an inspector that only
// tried the recorded absolute path reported every child as missing.
function collectChild(cwd, runId, roots = []) {
  let runDir = join(cwd, '.teams_output', 'broker', runId);
  let run = null;
  for (const root of [cwd, ...roots].filter(Boolean)) {
    run = loadRunAt(join(root, '.teams_output', 'broker', 'runs', `${runId}.json`));
    if (run) { runDir = join(root, '.teams_output', 'broker', runId); cwd = root; break; }
  }
  if (!run) return { run_id: runId, cwd, missing: true, nodes: [] };
  const st = runState(run);
  return {
    run_id: run.run_id,
    cwd,
    flow: run.flow,
    mixed: run.mixed !== false,
    state: st.state,
    goal: (run.spec && run.spec.goal) || run.goal || '',
    nodes: run.nodes.map((n) => nodeRow(n, childSkillsAsked(run, n), nodeFiles({ runDir, run, n }))),
  };
}

// Which documents the phase-document tree is supposed to hold, and whether each exists yet.
function docs(task) {
  const dir = join(task.cwd, (task.team && task.team.opts && task.team.opts.docs_dir) || join('.teams_output', 'team'));
  const names = ['INDEX.md', '10-planning.md', '10-prd.md', '60-qa.md', '65-audit.md'];
  return { dir, files: names.map((f) => ({ name: f, path: join(dir, f), exists: existsSync(join(dir, f)) })) };
}

// Files any node reported writing, deduplicated, with the node that claimed each.
function artifacts(children) {
  const by = new Map();
  for (const c of children) {
    for (const n of c.nodes) {
      for (const f of n.changed_files) {
        if (!by.has(f)) by.set(f, { path: f, by: [], exists: existsSync(f) || existsSync(join(c.cwd, f)) });
        by.get(f).by.push(`${c.run_id.slice(0, 8)}/${n.node_id}`);
      }
    }
  }
  return [...by.values()].sort((a, b) => a.path.localeCompare(b.path));
}

// The report the 0.18.0 bug needed: per skill, how often it was named and how often a node
// said it loaded it. `never_loaded` is the headline - a skill asked for many times and used
// zero times is either not mounted or being ignored, and both are defects.
export function skillsAudit(model) {
  const rows = new Map();
  const bump = (s, field) => {
    if (!rows.has(s)) rows.set(s, { skill: s, asked: 0, used: 0 });
    rows.get(s)[field]++;
  };
  let reporting = 0;
  let silent = 0;
  const walk = (nodes) => {
    for (const n of nodes) {
      for (const s of n.skills_asked) bump(s, 'asked');
      if (n.skills_used === null) { if (n.state === 'done') silent++; continue; }
      reporting++;
      for (const s of n.skills_used) bump(s, 'used');
    }
  };
  walk(model.manager.nodes);
  for (const c of model.children) walk(c.nodes);
  const list = [...rows.values()].sort((a, b) => b.asked - a.asked || a.skill.localeCompare(b.skill));
  return {
    skills: list,
    never_loaded: list.filter((r) => r.asked > 0 && r.used === 0).map((r) => r.skill),
    nodes_reporting: reporting,
    nodes_silent: silent,
  };
}


// The ticket surface a person asked for: current state from tickets.mjs's pure functions over
// task.json (the ground truth), plus board.jsonl's transition history (the JIRA-style log). Both
// were already written; nothing surfaced either, so "where do I see the ticket move" had no
// answer but reading raw JSONL.
function tickets(taskDirPath, task) {
  const rows = [];
  try {
    rows.push({ key: epicKey(task.run_id), kind: 'EPIC', state: epicTicketState(task), title: String(task.request || '').slice(0, 60) });
    for (const p of [task.planning_pkg, ...((task.spec && task.spec.packages) || []), task.qa_pkg, task.audit_pkg]) {
      if (!p) continue;
      rows.push({ key: storyKey(task.run_id, p.id), kind: 'STORY', state: storyTicketState(task, String(p.id)), title: String(p.title || p.id) });
    }
  } catch { /* a partial task still renders the history below */ }
  const seen = new Set();
  const current = rows.filter((t) => !seen.has(t.key) && seen.add(t.key));
  const history = [];
  try {
    for (const line of readFileSync(join(taskDirPath, 'board.jsonl'), 'utf8').trim().split('\n')) {
      if (!line) continue;
      try { history.push(JSON.parse(line)); } catch { /* a torn line is not a reason to show none */ }
    }
  } catch { /* no board yet */ }
  return { current, history };
}

export function collect(taskDirPath, task) {
  const managerNodes = task.nodes.map((n) => nodeRow(n, managerSkillsAsked(task, n), nodeFiles({ taskDir: taskDirPath, n })));
  const children = [];
  // Where else a child's run file could be: the task's own cwd, and the workspace the task
  // directory itself sits in (<ws>/.harness-tasks/<id>).
  const roots = [task.cwd, dirname(dirname(taskDirPath))];
  for (const n of task.nodes) {
    if (n.child && n.child.run_id) children.push({ node_id: n.node_id, ...collectChild(n.child.cwd, n.child.run_id, roots) });
  }
  if (task.s_run && task.s_run.run_id) children.push({ node_id: 'S', ...collectChild(task.s_run.cwd, task.s_run.run_id, roots) });
  const model = {
    task_id: task.run_id,
    dir: taskDirPath,
    name: basename(task.cwd),
    cwd: task.cwd,
    size: task.size || null,
    flow: task.flow === 'auto' ? (task.flow_chosen || 'auto') : task.flow,
    roles: (task.team && task.team.opts && task.team.opts.roles) || {},
    request: String(task.request || ''),
    state: null,
    manager: { nodes: managerNodes },
    children,
    docs: docs(task),
    tickets: tickets(taskDirPath, task),
  };
  model.artifacts = artifacts(children);
  model.skills = skillsAudit(model);
  return model;
}
