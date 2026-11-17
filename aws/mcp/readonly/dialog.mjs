// macOS hidden-answer dialog. The answer comes back on osascript's stdout and goes nowhere else:
// the prompt is a label ('Access Key ID'), so no secret is ever in argv; errors carry no answer text.
// Cancel makes osascript exit non-zero with "(-128)" on stderr: null is returned, nothing is stored.
import { execFile } from 'node:child_process';

const TITLE = 'readonly-aws';
const asString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;

const canceled = (err) => err.code === -128 || /User canceled|\(-128\)/i.test(String(err.stderr ?? ''));

// run: execFile-shaped (file, args, cb); injectable for tests. Resolves the trimmed answer or null on Cancel.
export function hiddenDialog(prompt, { run = execFile } = {}) {
  const script = `display dialog ${asString(prompt)} default answer "" with hidden answer with title ${asString(TITLE)}`;
  return new Promise((resolve, reject) => {
    run('osascript', ['-e', script, '-e', 'text returned of result'], (err, stdout) => {
      if (!err) return resolve(String(stdout).trim());
      if (canceled(err)) return resolve(null);
      if (err.code === 'ENOENT') return reject(new Error('Hidden-answer dialog is not available: the `osascript` command was not found (macOS is required)'));
      reject(new Error('Hidden-answer dialog failed'));
    });
  });
}
