// macOS hidden-answer dialog. The answer comes back on osascript's stdout and goes nowhere else:
// the prompt is a label ('AWS username'), so no secret is ever in argv; errors carry no answer text.
// Cancel makes osascript exit non-zero (code 1) with "(-128)" on stderr: null is returned, nothing is stored.
// Node's execFile hands stderr to the callback as its 3rd argument (err.stderr is not set), and err.message embeds it.
import { execFile } from 'node:child_process';

const TITLE = 'readonly-aws';
const asString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;

const stderrOf = (err, stderr) => String(stderr || err.stderr || err.message || '');
const canceled = (err, text) => err.code === -128 || /User canceled|\(-128\)/i.test(text);
// Only the osascript error number is ever shown; stderr, err.message and stdout text are not.
const failure = (text) => {
  const n = /\((-?\d+)\)/.exec(text)?.[1];
  return new Error(n ? `Hidden-answer dialog failed (osascript error ${n})` : 'Hidden-answer dialog failed');
};

// run: execFile-shaped (file, args, cb); injectable for tests. Resolves the trimmed answer or null on Cancel.
export function hiddenDialog(prompt, { run = execFile } = {}) {
  const script = `display dialog ${asString(prompt)} default answer "" with hidden answer with title ${asString(TITLE)}`;
  return new Promise((resolve, reject) => {
    run('osascript', ['-e', script, '-e', 'text returned of result'], (err, stdout, stderr) => {
      if (!err) return resolve(String(stdout).trim());
      const text = stderrOf(err, stderr);
      if (canceled(err, text)) return resolve(null);
      if (err.code === 'ENOENT') return reject(new Error('Hidden-answer dialog is not available: the `osascript` command was not found (macOS is required)'));
      reject(failure(text));
    });
  });
}
