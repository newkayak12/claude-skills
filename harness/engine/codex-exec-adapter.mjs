#!/usr/bin/env node
// codex-exec-adapter - CLI straight-control bridge for Workflow-less harness runs.
//
// Claude remains the orchestrator. Codex is invoked as a bounded external process that
// writes explicit artifacts: an optional JSONL event log plus a final JSON summary.

import { createWriteStream, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

function usage() {
  process.stderr.write(
    'usage: node harness/engine/codex-exec-adapter.mjs ' +
      '[--detect] --cwd DIR --output FILE [--prompt-file FILE] [--events-output FILE] ' +
      '[--sandbox read-only|workspace-write|danger-full-access] [--model MODEL]\n',
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const opts = { sandbox: 'workspace-write' };

for (let i = 0; i < args.length; i++) {
  const key = args[i];
  const val = args[i + 1];
  if (key === '--detect') {
    opts.detect = true;
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

const cwd = resolve(opts.cwd);
const outputPath = resolve(opts.output);
const eventsPath = opts.eventsOutput ? resolve(opts.eventsOutput) : null;

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
  const ready = probe.status === 0 && /\bCODEX_READY\b/.test(observed);

  writeReport({
    ok: ready,
    cwd,
    codex: {
      available: true,
      ready,
      implement: ready,
      test: ready,
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
  if (eventsPath) codexArgs.push('--json');
  if (opts.model) codexArgs.push('-m', opts.model);
  codexArgs.push(prompt);

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
      writeReport({
        ok: code === 0,
        provider: 'codex',
        exit_code: code,
        signal,
        cwd,
        sandbox: opts.sandbox,
        events_output: eventsPath,
        last_message: lastMessage,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
      process.exit(code === 0 ? 0 : 1);
    };
    if (eventStream) eventStream.end(finish);
    else finish();
  });
}

if (opts.detect) {
  process.exit(detectCodex() ? 0 : 1);
}

runCodex();
