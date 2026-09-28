#!/usr/bin/env node
// Sleep until a usage-limit notice's reset has passed (plus the grace), then exit 0.
//
//   node until-reset.mjs "<limit text>" [--since-file <path>]
//
// For drive.sh's session arms (stable, none, sprint, DRIVE_VIA=session) - the ones with a
// `claude -p` session and no task for `teams run` to wait on. The parsing and the minute-step
// sleep are teams/scripts/run.mjs's own (--resume-on-limit), not a second copy: drive.sh's bash
// parser used BSD `date -j` and silently read every reset as epoch 0 anywhere but macOS.
//
// --since-file is the stream the limit was read from: its mtime is when the session hit the
// limit, and the reset is the first one after THAT - so a driver that reads the notice a few
// minutes past the reset resumes at once instead of rolling to tomorrow's clock time.

import { statSync } from 'node:fs';
import { limitResumeAt, sleepUntil } from '../../run.mjs';

const args = process.argv.slice(2);
const i = args.indexOf('--since-file');
let since = Date.now();
if (i >= 0) {
  try { since = statSync(args[i + 1]).mtimeMs; } catch { /* missing file: now */ }
  args.splice(i, 2);
}
const text = args.join(' ');
const at = limitResumeAt(text, since);
const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
if (at <= Date.now()) {
  process.stdout.write(`${stamp()} limit hit; reset time already passed, resuming\n`);
} else {
  process.stdout.write(`${stamp()} limit hit; sleeping until ${new Date(at).toISOString()}\n`);
  await sleepUntil(at);
}
