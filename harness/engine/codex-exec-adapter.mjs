#!/usr/bin/env node
// codex-exec-adapter - structured Codex provider bridge for Claude harness runs.
//
// Claude remains the orchestrator. Codex is invoked as a bounded external process that
// writes explicit artifacts: an optional JSONL event log plus a final JSON summary.

import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

function usage() {
  process.stderr.write(
    'usage: node harness/engine/codex-exec-adapter.mjs ' +
      '[--detect] --cwd DIR --output FILE [--prompt-file FILE] [--events-output FILE] ' +
      '[--stage implement|test] [--add-dir DIR] [--isolated] ' +
      '[--sandbox read-only|workspace-write|danger-full-access] [--model MODEL]\n',
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const opts = { sandbox: 'workspace-write', addDirs: [] };

for (let i = 0; i < args.length; i++) {
  const key = args[i];
  const val = args[i + 1];
  if (key === '--detect') {
    opts.detect = true;
  } else if (key === '--isolated') {
    // Caller asserts this cwd is a private worktree with exactly one node running
    // in it, which is what makes positive change attribution sound.
    opts.isolated = true;
  } else if (key === '--cwd') {
    opts.cwd = val;
    i++;
  } else if (key === '--prompt-file') {
    opts.promptFile = val;
    i++;
  } else if (key === '--output') {
    opts.output = val;
    i++;
  } else if (key === '--events-output') {
    opts.eventsOutput = val;
    i++;
  } else if (key === '--stage') {
    opts.stage = val;
    i++;
  } else if (key === '--add-dir') {
    opts.addDirs.push(val);
    i++;
  } else if (key === '--sandbox') {
    opts.sandbox = val;
    i++;
  } else if (key === '--model') {
    opts.model = val;
    i++;
  } else {
    usage();
  }
}

if (!opts.cwd || !opts.output || (!opts.detect && !opts.promptFile)) usage();
if (!['read-only', 'workspace-write', 'danger-full-access'].includes(opts.sandbox)) usage();
if (opts.stage && !['implement', 'test'].includes(opts.stage)) usage();

const cwd = resolve(opts.cwd);
const outputPath = resolve(opts.output);
const eventsPath = opts.eventsOutput ? resolve(opts.eventsOutput) : null;

// The caller is not required to have created these directories; createWriteStream
// and writeFileSync both fail hard (unhandled 'error' event) if the parent is absent.
mkdirSync(dirname(outputPath), { recursive: true });
if (eventsPath) mkdirSync(dirname(eventsPath), { recursive: true });

const STAGE_SCHEMAS = {
  implement: {
    type: 'object',
    properties: {
      stage_ok: { type: 'boolean' },
      handoff: { type: 'string' },
      changed_files: { type: 'array', items: { type: 'string' } },
      checks: { type: 'array', items: { type: 'string' } },
      evidence: { type: 'string' },
    },
    required: ['stage_ok', 'handoff', 'changed_files', 'checks', 'evidence'],
    additionalProperties: false,
  },
  test: {
    type: 'object',
    properties: {
      stage_ok: { type: 'boolean' },
      verified: { type: 'boolean' },
      checks: { type: 'array', items: { type: 'string' } },
      evidence: { type: 'string' },
    },
    required: ['stage_ok', 'verified', 'checks', 'evidence'],
    additionalProperties: false,
  },
};

function validStageResult(stage, value) {
  if (!value || typeof value !== 'object' || typeof value.stage_ok !== 'boolean') return false;
  if (!Array.isArray(value.checks) || !value.checks.every((item) => typeof item === 'string')) return false;
  if (typeof value.evidence !== 'string') return false;
  if (stage === 'implement') {
    return typeof value.handoff === 'string' &&
      Array.isArray(value.changed_files) && value.changed_files.every((item) => typeof item === 'string');
  }
  return typeof value.verified === 'boolean';
}

// Ground truth for "did this node actually change anything". A node reporting
// stage_ok=true with changed_files it never wrote is the failure this catches:
// codex can exit 0 after its sandbox blocked every write.
//
// Identity is the file's CONTENT HASH, never its porcelain status code: staging a
// pre-dirty tree (`git add -A`) flips ' M' to 'M ' while writing nothing, and two
// different edits to one file can share the same numstat line counts.
const HASH_CAP = 2000;

function git(args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function repoRoot() {
  const top = git(['rev-parse', '--show-toplevel']);
  return top.status === 0 ? top.stdout.trim() : null;
}

// -z keeps paths raw: without it git C-quotes and octal-escapes anything with a
// space or non-ASCII character, which never matches a claim.
function candidatePaths() {
  let res = git(['status', '--porcelain', '-uall', '--ignored=matching', '-z']);
  if (res.status !== 0) res = git(['status', '--porcelain', '-uall', '-z']);
  if (res.status !== 0) return null;
  const fields = String(res.stdout || '').split('\0');
  const paths = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (!entry || entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    paths.push(entry.slice(3));
    // Rename/copy entries are followed by the source path in its own field.
    if (xy.includes('R') || xy.includes('C')) {
      i++;
      if (fields[i]) paths.push(fields[i]);
    }
  }
  return [...new Set(paths)];
}

function gitSnapshot() {
  const root = repoRoot();
  if (!root) return null; // not a git worktree; verification unavailable
  const paths = candidatePaths();
  if (!paths) return null;
  if (paths.length > HASH_CAP) return { root, degraded: true, paths: new Set(paths) };
  const hashes = new Map();
  for (const rel of paths) {
    try {
      hashes.set(rel, createHash('sha256').update(readFileSync(join(root, rel))).digest('hex'));
    } catch {
      hashes.set(rel, 'ABSENT'); // deleted, or a directory/symlink we cannot read
    }
  }
  return { root, degraded: false, hashes, paths: new Set(paths) };
}

function observedChanges(before, after) {
  if (!before || !after) return null;
  if (before.degraded || after.degraded) {
    const names = new Set([...before.paths, ...after.paths]);
    const changed = [...names].filter((n) => before.paths.has(n) !== after.paths.has(n));
    return { changed: changed.sort(), degraded: true, root: after.root };
  }
  const names = new Set([...before.hashes.keys(), ...after.hashes.keys()]);
  const changed = [];
  for (const name of names) {
    if (before.hashes.get(name) !== after.hashes.get(name)) changed.push(name);
  }
  return { changed: changed.sort(), degraded: false, root: after.root };
}

// Claims arrive however Codex chose to spell them: "./a.js", an absolute path, or
// relative to a --cwd that is a subdirectory. Observed paths are always repo-root
// relative with forward slashes, so normalize claims into that space.
function normalizeClaim(root, claim) {
  const raw = String(claim || '').trim();
  if (!raw) return raw;
  const abs = isAbsolute(raw) ? resolve(raw) : resolve(cwd, raw.replace(/^\.\/+/, ''));
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..')) return raw.replace(/^\.\/+/, '');
  return rel.split(sep).join('/');
}

// Codex's own event log is a second, independent record of what the run did:
// `command_execution` items carry the command and its exit code, `file_change` items
// record writes. A Test node that claims verified=true having executed nothing is the
// exact failure the harness exists to prevent — "do not trust the narrative".
function readEventEvidence() {
  if (!eventsPath) return null;
  let raw = '';
  try {
    raw = readFileSync(eventsPath, 'utf8');
  } catch {
    return null;
  }
  const evidence = { commands_executed: 0, commands_failed: 0, file_changes: 0, commands: [] };
  const seen = new Set();
  for (const line of raw.split('\n')) {
    const text = line.trim();
    if (!text) continue;
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      continue;
    }
    const item = event && event.item;
    if (!item || typeof item !== 'object') continue;
    const kind = item.item_type || item.type;
    // item.started and item.completed both carry the same id; count each item once.
    const id = item.id ? `${kind}:${item.id}` : null;
    if (id && seen.has(id)) {
      if (kind === 'command_execution' && typeof item.exit_code === 'number' && item.exit_code !== 0) {
        evidence.commands_failed++;
      }
      continue;
    }
    if (id) seen.add(id);
    if (kind === 'command_execution') {
      evidence.commands_executed++;
      if (evidence.commands.length < 20) evidence.commands.push(String(item.command || '').slice(0, 200));
      if (typeof item.exit_code === 'number' && item.exit_code !== 0) evidence.commands_failed++;
    } else if (kind === 'file_change') {
      evidence.file_changes++;
    }
  }
  return evidence;
}

function writeReport(report) {
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
}

function codexVersion() {
  const result = spawnSync('codex', ['--version'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    exit_code: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? String(result.error.message || result.error) : '',
  };
}

// Ground truth for "can Codex actually do Implement work here": ask it to create one
// throwaway file under the sandbox Implement uses, then look at the filesystem ourselves.
// Codex exits 0 even when every write was rejected, so its exit code proves nothing.
function probeWrite() {
  const name = `.codex-write-probe-${randomUUID()}`;
  const target = join(cwd, name);
  let probe;
  try {
    probe = spawnSync('codex', [
      'exec', '--ephemeral', '-s', opts.sandbox, '-C', cwd,
      `Create a file named ${name} in the current directory containing exactly: PROBE_OK\nThen stop. Do not modify anything else.`,
    ], { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    return { ok: false, sandbox: opts.sandbox, reason: `write probe could not spawn codex: ${String(error && error.message || error)}` };
  }
  const wrote = existsSync(target);
  if (wrote) { try { rmSync(target, { force: true }); } catch { /* probe cleanup is best-effort */ } }
  const stderr = String(probe.stderr || '');
  const lines = stderr.split('\n').map(l => l.trim()).filter(Boolean);
  const isBanner = l => /^sandbox:/i.test(l) || /could not find bubblewrap on PATH/i.test(l);
  const causes = lines.filter(l => !isBanner(l) && /bwrap:|denied|reject|not permitted|Failed to write|sandbox helper failed/i.test(l));
  const detail = (causes.length ? causes : lines.filter(l => !isBanner(l))).slice(0, 3).join(' | ');
  return {
    ok: wrote,
    sandbox: opts.sandbox,
    exit_code: probe.status,
    file_observed: wrote,
    reason: wrote ? '' :
      `Codex ran under --sandbox ${opts.sandbox} but wrote nothing (exit ${probe.status}). ` +
      `Implement nodes cannot work here. ${detail || String(probe.stdout || '').slice(-200)}`,
  };
}

function detectCodex() {
  const binary = codexVersion();
  if (!binary.ok) {
    writeReport({
      ok: false,
      cwd,
      codex: {
        available: false,
        ready: false,
        implement: false,
        test: false,
        reason: 'codex CLI is not executable',
        binary,
      },
    });
    return false;
  }

  const probe = spawnSync('codex', [
    'exec',
    '--ephemeral',
    '-s',
    'read-only',
    '-C',
    cwd,
    'Reply with exactly: CODEX_READY',
  ], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const observed = `${probe.stdout || ''}\n${probe.stderr || ''}`;
  const reachable = probe.status === 0 && /\bCODEX_READY\b/.test(observed);

  // The read-only smoke proves the CLI answers; it does NOT prove Codex can write.
  // Implement nodes are useless without writes, and a sandbox that cannot start still
  // exits 0, so probe an actual write under the sandbox Implement will really use.
  const write = reachable ? probeWrite() : { ok: false, reason: 'codex unreachable', sandbox: opts.sandbox };
  const ready = reachable && write.ok;

  writeReport({
    ok: ready,
    cwd,
    codex: {
      available: true,
      ready,
      reachable,
      implement: ready,
      test: reachable,
      sandbox: opts.sandbox,
      write_probe: write,
      reason: ready ? '' : (write.reason || 'codex smoke test failed'),
      binary,
      smoke: {
        exit_code: probe.status,
        signal: probe.signal,
        matched_ready_token: /\bCODEX_READY\b/.test(observed),
        stdout: probe.stdout || '',
        stderr: probe.stderr || '',
        error: probe.error ? String(probe.error.message || probe.error) : '',
      },
    },
  });
  return ready;
}

function runCodex() {
  const prompt = readFileSync(resolve(opts.promptFile), 'utf8');
  const scratchDir = mkdtempSync(join(tmpdir(), 'harness-codex-'));
  const lastMessagePath = join(scratchDir, 'last-message.md');
  const schemaPath = opts.stage ? join(scratchDir, `${opts.stage}-schema.json`) : null;
  if (schemaPath) writeFileSync(schemaPath, JSON.stringify(STAGE_SCHEMAS[opts.stage], null, 2) + '\n');
  const codexArgs = [
    'exec',
    '--ephemeral',
    '-s',
    opts.sandbox,
    '-C',
    cwd,
    '-o',
    lastMessagePath,
  ];
  for (const dir of opts.addDirs) codexArgs.push('--add-dir', resolve(dir));
  if (schemaPath) codexArgs.push('--output-schema', schemaPath);
  if (eventsPath) codexArgs.push('--json');
  if (opts.model) codexArgs.push('-m', opts.model);
  codexArgs.push(prompt);

  const beforeSnapshot = gitSnapshot();

  const child = spawn('codex', codexArgs, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdoutChunks = [];
  const stderrChunks = [];
  const eventStream = eventsPath ? createWriteStream(eventsPath, { flags: 'w' }) : null;

  child.stdout.on('data', (chunk) => {
    stdoutChunks.push(chunk);
    if (eventStream) eventStream.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderrChunks.push(chunk);
  });
  child.on('error', (error) => {
    stderrChunks.push(Buffer.from(String(error.message || error)));
  });
  child.on('close', (code, signal) => {
    const finish = () => {
      let lastMessage = '';
      try {
        lastMessage = readFileSync(lastMessagePath, 'utf8');
      } catch {
        // Codex may fail before creating the output file; stdout/stderr below keep
        // the failure debuggable.
      }
      let result = null;
      let structuredError = '';
      if (opts.stage) {
        try {
          result = JSON.parse(lastMessage);
          if (!validStageResult(opts.stage, result)) {
            structuredError = `Codex returned an invalid ${opts.stage} stage result`;
            result = null;
          }
        } catch (error) {
          structuredError = `Codex returned non-JSON ${opts.stage} output: ${error.message}`;
        }
      }
      const transportOk = code === 0;
      let stageOk = opts.stage ? transportOk && !!result && result.stage_ok === true : transportOk;

      // Cross-check the node's claim against the worktree. Only ever downgrades a
      // claimed success; never promotes a failure, and never fires outside a git
      // worktree or when the node already reported stage_ok=false.
      //
      // Observation describes the WORKTREE OVER A TIME WINDOW, not this process. In a
      // worktree shared with concurrently running nodes a sibling's writes land inside
      // our window, so "the file I claimed is present" would certify a node that wrote
      // nothing. Positive attribution is therefore sound only under --isolated. Without
      // it we still trust the one conclusion concurrency cannot fabricate: if NOTHING
      // changed anywhere, this node changed nothing.
      const snap = observedChanges(beforeSnapshot, gitSnapshot());
      const observed = snap ? snap.changed : null;
      const claimedRaw = result && Array.isArray(result.changed_files) ? result.changed_files : [];
      const claimed = snap ? claimedRaw.map((c) => normalizeClaim(snap.root, c)) : claimedRaw;
      let changedFilesVerified = null;
      const attribution = !snap
        ? 'unavailable'
        : snap.degraded
          ? 'degraded'
          : opts.isolated ? 'isolated' : 'shared-worktree';

      if (opts.stage === 'implement' && stageOk && snap) {
        const unobserved = claimed.filter((path) => !observed.includes(path));
        if (claimedRaw.length === 0) {
          changedFilesVerified = false;
          structuredError = 'Codex reported stage_ok=true for an implement node with no changed_files';
        } else if (observed.length === 0) {
          changedFilesVerified = false;
          structuredError = `Codex claimed changed_files but the worktree shows no change at all: ${claimed.join(', ')}`;
        } else if (attribution === 'isolated') {
          changedFilesVerified = unobserved.length === 0;
          if (!changedFilesVerified) {
            structuredError = `Codex claimed changed_files the worktree does not show: ${unobserved.join(', ')}`;
          }
        } else {
          // Changes exist but may belong to a concurrent node, or the tree was too
          // large to hash. Refuse to certify rather than report a verification this
          // run cannot support.
          changedFilesVerified = null;
        }
        if (changedFilesVerified === false) stageOk = false;
      }

      // Test nodes never touch the worktree, so their ground truth is Codex's event
      // log instead: a claimed verification that ran no command verified nothing.
      const eventEvidence = readEventEvidence();
      if (opts.stage === 'test' && stageOk && result && result.verified === true && eventEvidence) {
        if (eventEvidence.commands_executed === 0) {
          stageOk = false;
          result.verified = false;
          structuredError = 'Codex reported verified=true for a test node that executed no commands';
        }
      }

      // The engine's Implement node is produced by a subagent told to "copy result
      // fields", so a downgrade recorded only at top level would never reach it.
      // Mirror the verdict into `result` so the copied field carries it too.
      if (result && typeof result === 'object') {
        result.stage_ok = opts.stage ? stageOk : result.stage_ok;
        result.changed_files_verified = changedFilesVerified;
        result.change_attribution = attribution;
        result.observed_changed_files = observed;
        if (eventEvidence) result.event_evidence = eventEvidence;
        if (structuredError) result.verification_error = structuredError;
      }

      writeReport({
        ok: stageOk,
        transport_ok: transportOk,
        observed_changed_files: observed,
        changed_files_verified: changedFilesVerified,
        change_attribution: attribution,
        event_evidence: eventEvidence,
        provider: 'codex',
        stage: opts.stage || null,
        stage_ok: stageOk,
        exit_code: code,
        signal,
        cwd,
        sandbox: opts.sandbox,
        events_output: eventsPath,
        additional_writable_dirs: opts.addDirs.map((dir) => resolve(dir)),
        result,
        structured_error: structuredError,
        last_message: lastMessage,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
      process.exit(stageOk ? 0 : 1);
    };
    if (eventStream) eventStream.end(finish);
    else finish();
  });
}

if (opts.detect) {
  process.exit(detectCodex() ? 0 : 1);
}

runCodex();
