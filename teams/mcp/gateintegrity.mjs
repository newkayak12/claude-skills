// Gate integrity: did a run weaken the tests it is judged by? Compares the working tree against a
// baseline commit and lists three kinds of weakening, only inside test files:
//   removed-test      a removed line holding a test(/it(/describe( call (or Python `def test_`),
//                     reported at its OLD line; a call whose title is re-added in the same file
//                     (reformat or move) is not reported
//   added-skip        an added line with .skip / .only / .todo / xit( / xtest( / xdescribe(,
//                     reported at its NEW line
//   deleted-test-file a test file deleted against the baseline, reported at line 1
// Pure functions plus a thin git reader, in the style of scope.mjs. Untracked files are not in
// `git diff`, so a new file never produces a finding.

import { execFileSync } from 'node:child_process';

// Parse `git diff --no-color -U0 --no-renames` output into
// [{ file, deleted, lines: [{ kind: '-' | '+', old, new, text }] }] in diff order.
// `old` is the old-side line number of a '-' line, `new` the new-side number of a '+' line.
export function parseDiff(diffText) {
  const files = [];
  let cur = null;
  let inHunk = false;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of String(diffText).split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.startsWith('diff --git ')) {
      const rest = line.slice('diff --git '.length);
      // With --no-renames both sides are the same path: "a/X b/X".
      const len = (rest.length - 5) / 2;
      let file = Number.isInteger(len) && len > 0 ? rest.slice(2, 2 + len) : rest.replace(/^a\//, '').replace(/ b\/.*$/, '');
      if (file.startsWith('"') && file.endsWith('"')) file = file.slice(1, -1);
      cur = { file, deleted: false, lines: [] };
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      if (line.startsWith('deleted file mode')) cur.deleted = true;
      else if (line.startsWith('--- a/')) cur.file = line.slice(6);
      else if (line.startsWith('+++ b/')) cur.file = line.slice(6);
      continue;
    }
    if (line.startsWith('-')) cur.lines.push({ kind: '-', old: oldNo++, new: 0, text: line.slice(1) });
    else if (line.startsWith('+')) cur.lines.push({ kind: '+', old: 0, new: newNo++, text: line.slice(1) });
  }
  return files;
}

export function isTestFile(path) {
  const p = String(path);
  const base = p.slice(p.lastIndexOf('/') + 1);
  return (
    /^test-.*\.(?:mjs|cjs|js|ts)$/.test(base) ||
    /\.(?:test|spec)\./.test(base) ||
    /^test_.*\.py$/.test(base) ||
    /_test\.py$/.test(base) ||
    /Test\.(?:java|kt)$/.test(base) ||
    /(?:^|\/)(?:tests|__tests__)\//.test(p)
  );
}

const TEST_CALL = /(?:^|[^\w.$])(?:test|it|describe)(?:\.\w+)*\s*[(`]/;
const PY_TEST = /^\s*(?:async\s+)?def\s+(test_\w*)/;
const SKIP = /\.(?:skip|only|todo)\b|(?:^|[^\w.$])(?:xit|xtest|xdescribe)\s*\(/;

// Title of a test line: the first string literal after the call, the function name for Python,
// else the whitespace-collapsed line (title on the next line of a multi-line call). Null when
// the line is not a test call.
function testKey(text) {
  const py = PY_TEST.exec(text);
  if (py) return `py:${py[1]}`;
  const m = TEST_CALL.exec(text);
  if (!m) return null;
  const lit = /(['"`])((?:\\.|(?!\1).)*)\1/.exec(text.slice(m.index + m[0].length));
  return lit ? `js:${lit[2]}` : `line:${text.trim().replace(/\s+/g, ' ')}`;
}

const clean = (t) => t.trim().replace(/\s+/g, ' ');

// Findings [{ tag, file, line, text }] from a parseDiff result, in diff order.
export function weakenings(parsedDiff) {
  const out = [];
  for (const f of parsedDiff) {
    if (!isTestFile(f.file)) continue;
    if (f.deleted) {
      out.push({ tag: 'deleted-test-file', file: f.file, line: 1, text: clean(f.file) });
      continue;
    }
    const readded = new Set();
    for (const l of f.lines) {
      if (l.kind !== '+') continue;
      const k = testKey(l.text);
      if (k) readded.add(k);
    }
    for (const l of f.lines) {
      if (l.kind === '-') {
        const k = testKey(l.text);
        if (k && !readded.has(k)) out.push({ tag: 'removed-test', file: f.file, line: l.old, text: clean(l.text) });
      } else if (SKIP.test(l.text)) {
        out.push({ tag: 'added-skip', file: f.file, line: l.new, text: clean(l.text) });
      }
    }
  }
  return out;
}

// One line per finding: "<tag>\t<file>:<line>\t<text>"; '' for none.
export function formatList(findings) {
  return findings.map((f) => `${f.tag}\t${f.file}:${f.line}\t${f.text}`).join('\n') + (findings.length ? '\n' : '');
}

// Findings for the working tree in `cwd` against `baseline`. Throws when git cannot resolve it.
export function gateIntegrity({ cwd, baseline }) {
  const out = execFileSync('git', ['-c', 'core.quotepath=off', 'diff', '--no-color', '-U0', '--no-renames', baseline], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return weakenings(parseDiff(out));
}
