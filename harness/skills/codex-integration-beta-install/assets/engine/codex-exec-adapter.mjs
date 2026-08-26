#!/usr/bin/env node
// codex-exec-adapter - structured Codex provider bridge for Claude harness runs.
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
      '[--stage implement|test] [--add-dir DIR] ' +
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
      const stageOk = opts.stage ? transportOk && !!result && result.stage_ok === true : transportOk;
      writeReport({
        ok: stageOk,
        transport_ok: transportOk,
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
