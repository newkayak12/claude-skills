#!/usr/bin/env node
// Fresh print-mode session per invocation. read-only and workspace-write defer to the
// project's permission settings; danger-full-access is an explicit per-run opt-in that
// bypasses the prompt. A sandbox name here is a tool profile, not an OS sandbox claim.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { DISALLOWED_BASH, neededDenials } from '../mcp/denials.mjs';

const args = process.argv.slice(2);
const opts = { sandbox: 'workspace-write', addDirs: [] };
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === '--detect' || key === '--isolated' || key === '--verify' || key === '--no-wiki') opts[key.slice(2)] = true;
  else if (key === '--add-dir') opts.addDirs.push(args[++i]);
  else if (['--cwd', '--output', '--prompt-file', '--events-output', '--stage', '--sandbox', '--model'].includes(key)) opts[key.slice(2)] = args[++i];
  else throw new Error(`unknown argument ${key}`);
}
if (!opts.cwd || !opts.output || (!opts.detect && !opts['prompt-file'])) throw new Error('cwd, output and prompt-file (unless detect) are required');
if (!['read-only', 'workspace-write', 'danger-full-access'].includes(opts.sandbox)) throw new Error(`unsupported sandbox ${opts.sandbox}`);
opts.cwd = resolve(opts.cwd);
opts.output = resolve(opts.output);
mkdirSync(dirname(opts.output), { recursive: true });

function parse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// Verbatim copy of unexplainedRefusal in mcp/daemon.mjs (about lines 189-201): importing the daemon
// would run its startup in this short-lived child. test-claude-adapter.mjs pins the two together.
function unexplainedRefusal(result) {
  if (!result || typeof result !== 'object' || result.judge_failed) return null;
  const refused = result.stage_ok === false || result.accept === false || result.verified === false || result.sound === false;
  if (!refused) return null;
  const said = (v) => (Array.isArray(v) ? v.some((x) => String(x == null ? '' : (typeof x === 'object' ? JSON.stringify(x) : x)).trim()) : String(v == null ? '' : v).trim() !== '');
  if (['reason', 'gaps', 'problems', 'blocking', 'unowned', 'evidence', 'conflicts', 'retry', 'contradictions', 'uncovered', 'duplicates', 'new_areas'].some((k) => said(result[k]))) return null;
  return { ...result, stage_ok: false, judge_failed: true, reason: 'the judge refused without a reason or gaps - a refusal nobody can act on; asked again' };
}

// The project wiki: when the engine sets TEAMS_WIKI_ROOT (task.cwd, never a worktree) a worker
// gets exactly one MCP server, teams-wiki, rooted there, and its tools are allowed by name so
// writes need no approval. --tools only limits built-ins, so MCP tools are named in
// --allowedTools. Judging stages arrive with --no-wiki (broker.mjs) and get the empty config.
const WIKI_TOOLS = ['wiki_search', 'wiki_get', 'wiki_resume', 'wiki_list', 'wiki_status', 'wiki_write'].map(t => `mcp__teams-wiki__${t}`);
const wikiRoot = process.env.TEAMS_WIKI_ROOT;
const withWiki = Boolean(wikiRoot) && !opts['no-wiki'] && !opts.detect;
const mcpConfig = withWiki
  ? JSON.stringify({ mcpServers: { 'teams-wiki': { command: process.execPath, args: [fileURLToPath(new URL('../mcp/wiki.mjs', import.meta.url)), '--root', wikiRoot] } } })
  : '{"mcpServers":{}}';

async function invoke(prompt) {
  const readOnly = opts.sandbox === 'read-only';
  const permissionMode = readOnly ? 'dontAsk'
    : opts.sandbox === 'danger-full-access' ? 'bypassPermissions'
      : 'acceptEdits';
  // review/gate's contract asks them to re-run the command an acceptance item names, not
  // trust the authoring node's report of it - impossible with no Bash, which is exactly why
  // a review node kept splitting verified:true/false on identical evidence (P4:review:U1,
  // portfolio-refresh Sprint: "no Bash tool available in this reasoning node"). --verify grants
  // Bash under this profile for those two stages only (broker.mjs decides which). Edit and
  // Write stay off the list regardless - there is no tool that writes a file - and
  // --disallowedTools blocks the Bash verbs that mutate the tree or its history anyway (a
  // `git commit` leaves the working tree clean, so "no Edit/Write tool" alone would not
  // catch it). This is a tool-profile denylist, not an OS sandbox: a redirect into a tracked
  // file (`echo x > path`) is not expressible as a command-prefix pattern and is not blocked
  // by it - the review/gate prompt's own instruction not to write is the other half of this.
  const verifyTools = readOnly && opts.verify;
  const cli = ['-p', '--output-format', 'json', '--no-session-persistence',
    '--strict-mcp-config', '--mcp-config', mcpConfig,
    '--model', opts.model || 'sonnet',
    '--tools', readOnly ? (verifyTools ? 'Read,Glob,Grep,Bash' : 'Read,Glob,Grep') : 'Read,Glob,Grep,Edit,Write,Bash',
    '--permission-mode', permissionMode];
  if (verifyTools) {
    cli.push('--disallowedTools', DISALLOWED_BASH.join(','));
  }
  // dontAsk denies every tool call no allow rule names, so Bash on --tools alone is never run:
  // every --verify gate read 'tool denied' (E-64cda2b0, E-910c1de2). Allowing Bash here is
  // safe because --disallowedTools wins over an allow rule (live probe 2026-10-21: `node --test`
  // ran, `rm` stayed denied).
  const allowed = [...(verifyTools ? ['Bash'] : []), ...(withWiki ? WIKI_TOOLS : [])];
  if (allowed.length) cli.push('--allowedTools', allowed.join(','));
  for (const dir of opts.addDirs) cli.push('--add-dir', dir);
  return await new Promise(resolveResult => {
    const child = spawn('claude', cli, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', stopped = false;
    const stop = () => {
      stopped = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1000).unref();
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
    const finish = status => {
      process.removeListener('SIGTERM', stop);
      process.removeListener('SIGINT', stop);
      resolveResult({ status, stdout, stderr, stopped });
    };
    child.on('error', error => { stderr = error.message; });
    child.on('close', finish);
  });
}

let probeDir;
try {
  const marker = randomUUID();
  if (opts.detect) probeDir = mkdtempSync(join(opts.cwd, '.graph-claude-probe-'));
  const probeFile = probeDir && join(probeDir, 'ready.txt');
  const prompt = opts.detect
    ? opts.sandbox === 'read-only'
      ? `Return exactly ${marker}. Do not use any tools.`
      // Writable is not enough: implement/test/gate run commands. acceptEdits (this profile's
      // permission mode) lets Write through and leaves Bash to the project's settings, which
      // headless denies unless they allow it - code-sprint-S3 (2026-09-26) had every claude node
      // report "This command requires approval" for `node --test`, while this probe, asking only
      // for Write, had said ready. The file must hold a sha256 only running node can produce.
      : `Use Bash to run exactly this command, then return ${marker}: node -e "require('fs').writeFileSync(process.argv[1], require('crypto').createHash('sha256').update(process.argv[2]).digest('hex'))" ${JSON.stringify(probeFile)} ${marker}`
    : readFileSync(opts['prompt-file'], 'utf8');
  const proc = await invoke(prompt);
  if (opts['events-output']) {
    mkdirSync(dirname(resolve(opts['events-output'])), { recursive: true });
    writeFileSync(opts['events-output'], proc.stdout);
  }
  const envelope = parse(proc.stdout);
  const ok = proc.status === 0 && !proc.stopped && envelope && !envelope.is_error;
  const message = String(envelope?.result || '');
  let report;
  if (opts.detect) {
    let written = false;
    const expected = createHash('sha256').update(marker).digest('hex');
    try { written = readFileSync(probeFile, 'utf8').trim() === expected; } catch { /* probe did not run a command */ }
    const reachable = Boolean(ok && message.includes(marker));
    const ready = Boolean(ok && written);
    report = { vendor: { reachable, ready, reason: (opts.sandbox === 'read-only' ? reachable : ready) ? '' : proc.stderr || (reachable ? 'Claude answered but could not run a command in this profile (Bash needs approval under the project permission settings)' : 'Claude readiness probe failed') } };
    process.exitCode = (opts.sandbox === 'read-only' ? reachable : ready) ? 0 : 1;
  } else {
    const result = envelope?.structured_output || parse(message) || parse(message.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] || '');
    const usable = result && typeof result === 'object' && !Array.isArray(result);
    report = { stage_ok: Boolean(ok && usable && result.stage_ok === true), result: usable ? result : undefined,
      last_message: message, error: envelope?.error, errors: envelope?.errors, stderr: proc.stderr, usage: envelope?.usage, model_usage: envelope?.modelUsage,
      verification_error: ok && usable ? '' : proc.stderr || message || 'Claude returned no valid stage JSON' };
    process.exitCode = ok && usable ? 0 : 1;
    // A node denied a Bash call it needed. If its last reply is still a usable result (the same
    // parse the non-denied path accepts, and not an unexplained refusal) it judged despite the
    // denial: the result stands with the denied commands attached, and stage_ok, verification_error
    // and the exit code stay as computed (E-57170ac9: a denied optional command blocked a node that
    // had answered). With no usable result it judged nothing: not a reject. Exit 0, because the
    // broker drops the report of a non-zero exit (transportOk) and with it the blocked marker.
    const denied = neededDenials(envelope, opts.cwd);
    if (denied.length && proc.status === 0 && !proc.stopped) {
      if (ok && usable && !unexplainedRefusal(result)) {
        report.result = { ...result, denied };
      } else {
        report.stage_ok = false;
        report.result = { stage_ok: false, blocked: 'tool denied', reason: 'blocked: tool denied', denied };
        report.verification_error = 'blocked: tool denied';
        process.exitCode = 0;
      }
    }
  }
  writeFileSync(opts.output, JSON.stringify(report, null, 2) + '\n');
} catch (error) {
  writeFileSync(opts.output, JSON.stringify({ stage_ok: false, verification_error: error.message }));
  process.exitCode = 1;
} finally {
  if (probeDir) rmSync(probeDir, { recursive: true, force: true });
}
