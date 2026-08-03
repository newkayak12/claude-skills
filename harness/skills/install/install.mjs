#!/usr/bin/env node
// Deterministic file ops for the harness `install` skill. The SKILL (agent) keeps the
// judgment/dialogue — proposing gate patterns, asking about embedding, resolving skill
// source dirs — then hands the CONFIRMED values here so the mechanical, error-prone parts
// (JSON merge, idempotent copies, path rewrites) run the same way every time.
//
// Usage:  node install.mjs '<json>'
// Input (all fields optional except as noted):
//   {
//     "projectDir": "/abs/path",          // default: process.cwd()
//     "refresh": false,                   // true → re-copy plugin-owned files after a version
//                                         //   bump (goal-gate.mjs, embedded engine/templates/
//                                         //   goal-spec + embedded skills). NEVER touches
//                                         //   user-owned files (gate, conventions, CLAUDE.md,
//                                         //   settings.json) even when true.
//     "gate": { "patterns": ["src/.*\\.kt$"], "window_hours": 2 },  // omit → skip gate write
//     "embed": {                          // omit → skip standalone embedding
//       "runtime": true,                  // copy engine + meta-skeleton + goal-spec
//       "skills": [                        // the engine's statically-mounted skills:
//         { "name": "agent-task-decomposer", "src": "/abs/agents/skills/agent-task-decomposer" },
//         { "name": "devils-advocate", "src": "/abs/think/skills/devils-advocate" },
//         { "name": "verification-before-completion", "src": "/abs/completion/skills/verification-before-completion" } ]
//     }
//   }
// Always installs the hook (script + settings.json merge) and the .gitignore line — those
// are the enforcement core. Default is idempotent and non-destructive: an existing file is
// never overwritten (reported 'kept'). With "refresh": true, plugin-owned copies are
// re-copied ('refreshed'/'unchanged') to pull a newer plugin version; user-owned files are
// still never overwritten. Prints a JSON report to stdout; exits non-zero only on bad input.
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // <plugin>/skills/install
const PLUGIN_ROOT = resolve(HERE, '..', '..'); // <plugin> (harness/)

function parseArgs() {
  const raw = process.argv[2];
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`install.mjs: argv[1] is not valid JSON: ${e.message}\n`);
    process.exit(2);
  }
}

function ensureDir(d) {
  mkdirSync(d, { recursive: true });
}

// Plugin-owned copies (verbatim of a plugin file) — safe to overwrite on refresh. When
// `refresh` is true and the destination already exists, it is re-copied and reported as
// 'refreshed' (or 'unchanged' if byte-identical). Otherwise the copy is non-destructive:
// an existing destination is 'kept'. NEVER call these for user-owned files (gate config,
// conventions, CLAUDE.md, settings.json) — refresh must not clobber those.
// Returns 'created' | 'kept' | 'refreshed' | 'unchanged' | 'missing-src'.
function copyFile(src, dest, refresh) {
  if (!existsSync(src)) return 'missing-src';
  if (existsSync(dest)) {
    if (!refresh) return 'kept';
    if (readFileSync(src).equals(readFileSync(dest))) return 'unchanged';
    cpSync(src, dest);
    return 'refreshed';
  }
  ensureDir(dirname(dest));
  cpSync(src, dest);
  return 'created';
}

// Directory-tree variant. On refresh, cpSync overwrites files present in src but leaves any
// extra files the destination already has; report 'refreshed' whenever the dir pre-existed.
function copyDir(src, dest, refresh) {
  if (!existsSync(src)) return 'missing-src';
  if (existsSync(dest)) {
    if (!refresh) return 'kept';
    cpSync(src, dest, { recursive: true, force: true });
    return 'refreshed';
  }
  ensureDir(dirname(dest));
  cpSync(src, dest, { recursive: true });
  return 'created';
}

function main() {
  const args = parseArgs();
  const projectDir = args.projectDir ? resolve(args.projectDir) : process.cwd();
  const claudeDir = join(projectDir, '.claude');
  const refresh = args.refresh === true; // re-copy plugin-owned files; user-owned files stay untouched
  const report = { projectDir, refresh, actions: {}, notes: [] };

  // ---- Gate (optional): .claude/harness-gate.json ----
  if (args.gate && Array.isArray(args.gate.patterns) && args.gate.patterns.length) {
    const gatePath = join(claudeDir, 'harness-gate.json');
    if (existsSync(gatePath)) {
      report.actions.gate = 'kept';
    } else {
      const cfg = { patterns: args.gate.patterns };
      if (Number(args.gate.window_hours) > 0) cfg.window_hours = Number(args.gate.window_hours);
      ensureDir(claudeDir);
      writeFileSync(gatePath, JSON.stringify(cfg, null, 2) + '\n');
      report.actions.gate = 'created';
    }
  } else {
    report.actions.gate = 'skipped';
    report.notes.push('gate: no patterns provided — .claude/harness-gate.json not written (gate stays inactive)');
  }

  // ---- Hook script: copy the self-contained goal-gate.mjs into the project (plugin-owned) ----
  report.actions.hookScript = copyFile(
    join(PLUGIN_ROOT, 'hooks', 'goal-gate.mjs'),
    join(claudeDir, 'hooks', 'goal-gate.mjs'),
    refresh,
  );

  // ---- Hook registration: merge a PreToolUse entry into committed .claude/settings.json ----
  {
    const settingsPath = join(claudeDir, 'settings.json');
    const tmpl = JSON.parse(
      readFileSync(join(HERE, 'templates', 'settings-hook.json'), 'utf8'),
    );
    const entries = (tmpl.hooks && tmpl.hooks.PreToolUse) || [];
    const existed = existsSync(settingsPath);
    let settings = {};
    let parseFailed = false;
    if (existed) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      } catch {
        parseFailed = true;
      }
    }
    if (parseFailed) {
      // Never rewrite an unparseable settings file — leave it for the user.
      report.actions.settings = 'parse-error';
      report.notes.push(
        'settings.json exists but is not valid JSON — left untouched. Add the PreToolUse ' +
          'entry from templates/settings-hook.json by hand.',
      );
    } else {
      settings.hooks = settings.hooks || {};
      const arr = (settings.hooks.PreToolUse = settings.hooks.PreToolUse || []);
      const alreadyRegistered = arr.some(
        (g) => (g.hooks || []).some((h) => String(h.command || '').includes('goal-gate.mjs')),
      );
      if (alreadyRegistered) {
        report.actions.settings = 'already';
      } else {
        arr.push(...entries);
        ensureDir(claudeDir);
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        report.actions.settings = existed ? 'registered' : 'created';
      }
    }
  }

  // ---- Standalone embedding (optional): .claude/harness/ ----
  if (args.embed && (args.embed.runtime || (args.embed.skills || []).length)) {
    const embedRoot = join(claudeDir, 'harness');
    const embed = { runtime: {}, skills: [] };
    if (args.embed.runtime) {
      embed.runtime['engine/pipeline.js'] = copyFile(
        join(PLUGIN_ROOT, 'engine', 'pipeline.js'),
        join(embedRoot, 'engine', 'pipeline.js'),
        refresh,
      );
      embed.runtime['templates/meta-skeleton.js'] = copyFile(
        join(PLUGIN_ROOT, 'templates', 'meta-skeleton.js'),
        join(embedRoot, 'templates', 'meta-skeleton.js'),
        refresh,
      );
      embed.runtime['goal-spec.md'] = copyFile(
        join(PLUGIN_ROOT, 'goal-spec.md'),
        join(embedRoot, 'goal-spec.md'),
        refresh,
      );
    }
    for (const s of args.embed.skills || []) {
      if (!s || !s.name || !s.src) {
        report.notes.push(`embed.skills: skipped an entry missing name/src`);
        continue;
      }
      const result = copyDir(resolve(s.src), join(embedRoot, 'skills', s.name), refresh);
      embed.skills.push({ name: s.name, result });
      if (result === 'missing-src') {
        report.notes.push(`embed.skills: source not found for "${s.name}" at ${s.src}`);
      }
    }
    report.actions.embed = embed;
    report.notes.push(
      'embedding covers runtime + the skills you passed only; subgoal skills[] are chosen ' +
        'dynamically by SetGoal and cannot be pre-enumerated — unembedded picks are absent ' +
        'in a plugin-less environment. If embedded, rewrite the Workflow scriptPath in the ' +
        "CLAUDE.md block to .claude/harness/engine/pipeline.js (engagement regex still matches).",
    );
  } else {
    report.actions.embed = 'skipped';
  }

  // ---- .gitignore: ensure the markers dir is ignored ----
  {
    const giPath = join(projectDir, '.gitignore');
    const line = '.claude/.harness-markers/';
    if (!existsSync(giPath)) {
      writeFileSync(giPath, line + '\n');
      report.actions.gitignore = 'created';
    } else {
      const cur = readFileSync(giPath, 'utf8');
      if (cur.split(/\r?\n/).some((l) => l.trim() === line)) {
        report.actions.gitignore = 'present';
      } else {
        writeFileSync(giPath, cur + (cur.endsWith('\n') ? '' : '\n') + line + '\n');
        report.actions.gitignore = 'appended';
      }
    }
  }

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main();
