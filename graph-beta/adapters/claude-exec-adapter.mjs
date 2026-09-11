#!/usr/bin/env node
// Fresh print-mode session per invocation. read-only and workspace-write defer to the
// project's permission settings; danger-full-access is an explicit per-run opt-in that
// bypasses the prompt. A sandbox name here is a tool profile, not an OS sandbox claim.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const opts = { sandbox: 'workspace-write', addDirs: [] };
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === '--detect' || key === '--isolated') opts[key.slice(2)] = true;
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

async function invoke(prompt) {
  const readOnly = opts.sandbox === 'read-only';
  const permissionMode = readOnly ? 'dontAsk'
    : opts.sandbox === 'danger-full-access' ? 'bypassPermissions'
      : 'acceptEdits';
  const cli = ['-p', '--output-format', 'json', '--no-session-persistence',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--model', opts.model || 'sonnet',
    '--tools', readOnly ? 'Read,Glob,Grep' : 'Read,Glob,Grep,Edit,Write,Bash',
    '--permission-mode', permissionMode];
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
      : `Use Write to create ${probeFile} containing exactly ${marker}. Do not change anything else. Return ${marker}.`
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
    try { written = readFileSync(probeFile, 'utf8') === marker; } catch { /* probe did not write */ }
    const reachable = Boolean(ok && message.includes(marker));
    const ready = Boolean(ok && written);
    report = { vendor: { reachable, ready, reason: (opts.sandbox === 'read-only' ? reachable : ready) ? '' : proc.stderr || 'Claude readiness probe failed' } };
    process.exitCode = (opts.sandbox === 'read-only' ? reachable : ready) ? 0 : 1;
  } else {
    const result = envelope?.structured_output || parse(message) || parse(message.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] || '');
    const usable = result && typeof result === 'object' && !Array.isArray(result);
    report = { stage_ok: Boolean(ok && usable && result.stage_ok === true), result: usable ? result : undefined,
      last_message: message, error: envelope?.error, errors: envelope?.errors, stderr: proc.stderr, usage: envelope?.usage, model_usage: envelope?.modelUsage,
      verification_error: ok && usable ? '' : proc.stderr || message || 'Claude returned no valid stage JSON' };
    process.exitCode = ok && usable ? 0 : 1;
  }
  writeFileSync(opts.output, JSON.stringify(report, null, 2) + '\n');
} catch (error) {
  writeFileSync(opts.output, JSON.stringify({ stage_ok: false, verification_error: error.message }));
  process.exitCode = 1;
} finally {
  if (probeDir) rmSync(probeDir, { recursive: true, force: true });
}
