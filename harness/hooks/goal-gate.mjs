#!/usr/bin/env node
// PreToolUse gate: deny edits to gated paths unless the harness is engaged.
// Opt-in per project via .claude/harness-gate.json — no config, no gate.
// Fail-open on every error/ambiguity (v0 lesson: never brick a session).
//
// Parallel-subagent support: every call that confirms engagement (and every
// Task/Agent dispatch while engaged) refreshes a session marker under the
// project's .claude/.harness-markers/. Subagents lack the engagement record
// in their own transcript, so markers pass them through:
//   - exact session_id marker → same-session subagent
//   - any marker within window_hours → parallel subagent with its own session_id
//     (accepted hole: unrelated concurrent sessions also pass — this is a nudge,
//     not security)
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

const ENGAGE_RE =
  /harness\/engine\/pipeline\.js|"skill"\s*:\s*"harness"|<command-name>\/?harness<\/command-name>/;
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const CLEAN_MS = 24 * 60 * 60 * 1000;

const sanitize = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');

function refreshMarker(dir, sid) {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, sanitize(sid)), String(Date.now()));
  } catch {
    /* best-effort */
  }
}

function exactMarker(dir, sid) {
  try {
    statSync(join(dir, sanitize(sid)));
    return true;
  } catch {
    return false;
  }
}

// Broker engagement: an open node in the MCP broker's ledger is a stronger
// signal than the transcript regex - it means a node was actually routed and is
// mid-flight, whoever is executing it (Codex or Claude).
function anyOpenBrokerNode(cwd, windowMs) {
  try {
    const open = JSON.parse(
      readFileSync(join(cwd, '.harness-run', 'broker', 'open-nodes.json'), 'utf8'),
    );
    const now = Date.now();
    for (const k of Object.keys(open)) {
      const ts = Number(open[k] && open[k].opened_at) || 0;
      if (ts && now - ts <= windowMs) return true;
    }
  } catch {
    /* no broker ledger -> not engaged this way */
  }
  return false;
}

function anyRecentMarker(dir, windowMs) {
  const now = Date.now();
  let recent = false;
  try {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      let ts = 0;
      try {
        ts = parseInt(readFileSync(p, 'utf8'), 10) || 0;
      } catch {
        /* ignore */
      }
      if (now - ts <= windowMs) recent = true;
      else if (now - ts > CLEAN_MS) {
        try {
          rmSync(p);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* no dir yet */
  }
  return recent;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.exit(0);
  }
  if (!input || typeof input !== 'object') process.exit(0);

  const cwd = input.cwd || process.cwd();

  // Opt-in: no readable config → gate inactive.
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(join(cwd, '.claude', 'harness-gate.json'), 'utf8'));
  } catch {
    process.exit(0);
  }
  let patterns;
  try {
    patterns = (cfg.patterns || []).map((p) => new RegExp(p));
  } catch {
    process.exit(0); // bad regex in config → fail-open
  }
  if (!patterns.length) process.exit(0);
  const windowMs = (Number(cfg.window_hours) > 0 ? Number(cfg.window_hours) : 2) * 60 * 60 * 1000;
  const markerDir = join(cwd, '.claude', '.harness-markers');

  const tool = input.tool_name;
  const sid = input.session_id || 'unknown';

  // Engagement = harness skill/engine appears anywhere in this transcript.
  let engaged = false;
  let transcriptReadable = false;
  if (input.transcript_path) {
    try {
      const t = readFileSync(input.transcript_path, 'utf8');
      transcriptReadable = true;
      engaged = ENGAGE_RE.test(t);
    } catch {
      /* fail-open below */
    }
  }

  // An open broker node counts as engagement on its own: the harness routed this
  // node, so the edit is harness work even if the transcript never named the skill.
  if (!engaged && anyOpenBrokerNode(cwd, windowMs)) engaged = true;

  if (engaged) refreshMarker(markerDir, sid);

  // Deny applies to edit tools only; everything else just refreshed markers.
  if (!EDIT_TOOLS.has(tool)) process.exit(0);

  const fp = (input.tool_input && (input.tool_input.file_path || input.tool_input.notebook_path)) || '';
  const norm = String(fp).replace(/\\/g, '/');
  if (!patterns.some((re) => re.test(norm))) process.exit(0);

  if (engaged) process.exit(0);
  if (!transcriptReadable) process.exit(0); // fail-open
  if (exactMarker(markerDir, sid)) process.exit(0);
  if (anyRecentMarker(markerDir, windowMs)) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'This path is gated by the harness (.claude/harness-gate.json). Engage it first: ' +
          'open a node with the graph MCP tool graph_open, or invoke the ' +
          '"harness" skill (or run the six-stage engine via ' +
          'Workflow({ scriptPath: "harness/engine/pipeline.js", args: { request: ... } })), ' +
          'then retry the edit.',
      },
    }),
  );
  process.exit(0);
}

try {
  main();
} catch {
  process.exit(0); // fail-open: never let an uncaught throw block the tool call
}
