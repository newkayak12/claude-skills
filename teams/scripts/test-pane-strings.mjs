// F4-AC-4: a user-visible literal outside the STRINGS table and the allow-list fails the scan, naming file and line.
//
// A regexp scan, not a parser. It looks at five spellings only, after comments and the table itself are cut:
//   JSX text between tags, a string or template child `{...}`, `label=` / `placeholder=` / `title=` / `alt=` values,
//   `title:` values, and the first argument of `.toast(` / `.status(` (and `message =`, the push text).
// From each literal it removes every `${...}` expression, then reports a Latin word (two or more letters) that is not on
// ALLOW (lang-allow.ts) and any Hangul. It does NOT cover: a literal built by concatenation or returned from a helper, a
// string held in a const and drawn later, default parameter values in teams-draw.tsx (judge/gap fallbacks), words inside a
// regexp, and literals in files the pane does not scan (the node scripts). Words the engine sends arrive as keys; text a
// model or person wrote arrives in a field and is never a literal in these files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALLOW, hangulIn, latinOutside } from '../hooks/lang-allow.ts';

const hooks = fileURLToPath(new URL('../hooks/', import.meta.url));
const FILES = ['mod.tsx', 'teams-draw.tsx', 'pane.ts'];

// comments and the two language tables are not drawn text
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/.*$/gm, '$1')
    .replace(/^(?:export )?const (?:en|STRINGS)\b[\s\S]*?\n\}\n/gm, (m) => m.replace(/[^\n]/g, ' '));
}

// a literal's own text: every `${...}` removed (innermost first, so an object inside one goes too), escapes of the — kind dropped
function literalText(lit) {
  return stripBraces(lit.slice(1, -1).replace(/\\u[0-9a-fA-F]{4}/g, ' '));
}
const Q = "'(?:[^'\\\\\\n]|\\\\.)*'|\"(?:[^\"\\\\\\n]|\\\\.)*\"|`(?:[^`\\\\]|\\\\.)*`";
const RULES = [
  // JSX text: <Tag ...>text</  ({...} parts inside it are expressions and are removed)
  { re: /<[A-Z]\w*(?:[^<>]|=>)*?>([^<>\n]+)<\//g, text: (m) => stripBraces(m[1]) },
  // a string or template child: {'x'} {`x ${y}`} (a key={`...`} is no drawn text)
  { re: new RegExp(`(?<!\\$|key=)\\{\\s*(${Q})\\s*\\}`, 'g'), text: (m) => literalText(m[1]) },
  // attributes: label="x" label={`x`} placeholder= title= alt=
  { re: new RegExp(`\\b(?:label|placeholder|title|alt)=(?:(${Q})|\\{\\s*(${Q})\\s*\\})`, 'g'), text: (m) => literalText(m[1] ?? m[2]) },
  // object keys: title: 'x'
  { re: new RegExp(`\\btitle:\\s*(${Q})`, 'g'), text: (m) => literalText(m[1]) },
  // toast and status line arguments, and the push message
  { re: new RegExp(`\\.(?:toast|status)\\(\\s*(${Q})`, 'g'), text: (m) => literalText(m[1]) },
  { re: new RegExp(`\\bmessage\\s*=\\s*(${Q})`, 'g'), text: (m) => literalText(m[1]) },
];

// text with its `{...}` and `${...}` expressions cut out (innermost first)
function stripBraces(t) {
  for (let prev = null; prev !== t;) {
    prev = t;
    t = t.replace(/\$?\{[^{}]*\}/g, ' ');
  }
  return t;
}

// every finding of one source text: { line, text, words }
export function scan(src, data = []) {
  const clean = strip(src);
  const found = [];
  for (const { re, text } of RULES) {
    re.lastIndex = 0;
    for (const m of clean.matchAll(re)) {
      const t = text(m);
      const words = [...latinOutside(t, data), ...hangulIn(t, data)];
      if (words.length === 0) continue;
      const at = m.index + m[0].indexOf(m[1] ?? m[2] ?? m[0]);
      found.push({ line: clean.slice(0, at).split('\n').length, text: t.trim(), words });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

test('pane strings: self-test, the planted cases fail and the table calls pass', () => {
  const fails = {
    'JSX text': '<Text>Hello world</Text>',
    'label=': '<Button label="Save changes" onPress={f} />',
    'a word in a {`...`} template inside a Text': '<Text>{`Hello ${x}`}</Text>',
    'a word in a template passed to toast': '$.ui.toast(`Hello ${x}`)',
    'a word in a template passed to $.ui.status': '$.ui.status(`Hello ${x}`)',
  };
  for (const [name, code] of Object.entries(fails)) assert.ok(scan(code).length > 0, `${name} must fail: ${code}`);
  const passes = {
    "s('x')": "<Text>{s('x')}</Text>",
    '`${s(\'x\')}`': "<Text>{`${s('x')}`}</Text>",
    'toast of a table word': "$.ui.toast(`↻ ${run} ${s('x')}`)",
    'an allow-listed word': '<Text>Teams</Text>',
    'an id token': '<Text>{`SG1 ${s("x")}`}</Text>',
  };
  for (const [name, code] of Object.entries(passes)) assert.deepEqual(scan(code), [], `${name} must pass: ${code}`);
  // the finding names its line
  assert.equal(scan('const a = 1\n<Text>Hello</Text>')[0].line, 2);
  // a comment and the table itself are not scanned
  assert.deepEqual(scan('// <Text>Hello</Text>\n/* label="Hello" */'), []);
  assert.deepEqual(scan("const en = {\n  a: 'Hello',\n}\n<Text>{s('a')}</Text>"), []);
});

test('pane strings: self-test of the id-token rule, ids are data and a word glued to a digit is not', () => {
  for (const ok of ['SG1', 'P1', 'QA-F1', 'E-1a2b', 'S-3', 'E-dcacc53c/P2']) assert.deepEqual(latinOutside(ok), [], ok);
  assert.deepEqual(latinOutside('Stories3'), ['Stories']);
  assert.deepEqual(latinOutside('retrying2'), ['retrying']);
  assert.deepEqual(latinOutside('SG1-stalled'), ['stalled']);
  assert.deepEqual(latinOutside('P1_failed'), ['failed']);
  assert.deepEqual(latinOutside('SG'), ['SG']);
  assert.ok(ALLOW.includes('Teams'));
});

test('pane strings: no user-visible literal outside the table in mod.tsx, teams-draw.tsx and pane.ts', () => {
  const findings = [];
  for (const f of FILES) {
    for (const x of scan(readFileSync(hooks + f, 'utf8'))) findings.push(`${f}:${x.line}  ${x.words.join(', ')}  in  ${x.text}`);
  }
  assert.equal(findings.length, 0, `${findings.length} literal(s) outside the table:\n${findings.join('\n')}`);
});

// F2-AC-41..43: the stall mark comes from workers[] minutes; the pane reads no mtime and no pid
test('pane strings: no pane code reads an mtime or a pid', () => {
  for (const f of FILES) {
    assert.doesNotMatch(readFileSync(hooks + f, 'utf8'), /statSync|\bmtime\b|process\.kill|\bpid\b|taskStalled|drivers\.stalled/, f);
  }
});

// F4-AC-25: the toggle writes lang and langChosen and nothing else: no file write, no process run, no other state write
test('pane strings: the toggleLang body writes only lang and langChosen', () => {
  const src = readFileSync(hooks + 'mod.tsx', 'utf8');
  const start = src.indexOf('async function toggleLang(');
  assert.ok(start >= 0, 'toggleLang not found');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.ok(body.includes('update($, lang,') && body.includes('update($, langChosen,'), 'the toggle no longer writes lang and langChosen');
  assert.deepEqual([...body.matchAll(/update\(\$, (\w+),/g)].map((m) => m[1]), ['lang', 'langChosen']);
  for (const bad of [/writeFile|appendFile|mkdir|rename|unlink|rm\(/, /\$\.fs\b/, /\.write\(/, /process\.run|\$\.process|spawn|exec/]) assert.ok(!bad.test(body), `toggleLang body matches ${bad}`);
});
