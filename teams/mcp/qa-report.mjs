// qa-report.mjs - card 129 item 2: the engine writes the QA report from the QA execute result when
// the driver did not (its write was denied, or it never wrote). Pure except writeQaReport's one
// write; imports nothing from taskmanager / daemon / broker modules.
//
// The QA chain is cases -> execute -> gate and `cases` writes the case set to the same files[] path
// the report goes to, so "the file is absent" never holds in a real run. The engine therefore
// remembers the file's hash when cases finishes (recordCasesBaseline) and, at execute, treats a file
// still byte-equal to that as "execute wrote nothing": the results section is appended and the case
// set stays. A file execute did change is the driver's own report and is never touched.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { kindOf } from './graph-kinds.mjs';

const REPORT_RE = /\.(md|markdown)$/i;
const sha = (text) => createHash('sha256').update(text).digest('hex');

function qaSubgoal(run, subgoalId) {
  const sg = ((run && run.spec && run.spec.subgoals) || []).find((s) => s && String(s.id) === String(subgoalId));
  return sg && kindOf(sg) === 'qa' ? sg : null;
}

// Absolute report paths of a QA subgoal; entries resolving outside run.cwd are dropped.
export function qaReportPaths(run, subgoalId) {
  const sg = qaSubgoal(run, subgoalId);
  if (!sg || !run.cwd) return [];
  return (Array.isArray(sg.files) ? sg.files : [])
    .filter((f) => typeof f === 'string' && REPORT_RE.test(f))
    .map((f) => resolve(run.cwd, f))
    .filter((p) => { const r = relative(run.cwd, p); return r !== '' && !r.startsWith('..') && !isAbsolute(r); });
}

const line = (v) => String(v ?? '').trim();

export function renderQaReport(sg, result) {
  const r = result || {};
  const checks = Array.isArray(r.checks) ? r.checks : [];
  const defects = Array.isArray(r.defects) ? r.defects : [];
  const out = [
    `# QA report — ${sg.id} ${sg.title}`,
    '',
    'The engine wrote this report from the execute result (the driver did not write it).',
    '',
    '## Cases',
    ...(checks.length ? checks.map((c) => `- ${line(typeof c === 'string' ? c : JSON.stringify(c))}`) : ['- none']),
    '',
    '## Defects',
  ];
  if (!defects.length) out.push('none');
  defects.forEach((d, i) => {
    const x = d || {};
    const rp = x.repro || {};
    out.push(`### ${i + 1}. ${line(x.title)}${x.severity ? ` (${line(x.severity)})` : ''}`);
    if (x.evidence) out.push(`- evidence: ${line(x.evidence)}`);
    if (rp.command) out.push(`- repro: \`${line(rp.command)}\``);
    if (rp.observed) out.push(`- observed: ${line(rp.observed)}`);
    if (rp.expected) out.push(`- expected: ${line(rp.expected)}`);
  });
  out.push('', '## Evidence', line(r.evidence) || 'none', '');
  return out.join('\n');
}

function casesNode(run, n) {
  return (run.nodes || []).find((x) => x.stage === 'cases' && x.subgoal_id === n.subgoal_id && (x.attempt || 1) === (n.attempt || 1));
}

// Called when a qa `cases` node finishes: remember the report file's hash ('absent' when missing).
export function recordCasesBaseline(run, n) {
  try {
    if (!n || n.stage !== 'cases') return;
    const p = qaReportPaths(run, n.subgoal_id)[0];
    if (!p) return;
    n.report_sha = existsSync(p) ? sha(readFileSync(p)) : 'absent';
  } catch { /* the baseline is best effort */ }
}

// Writes (or appends to an untouched case set) the report; returns the path written or null.
export function writeQaReport(run, n, result) {
  try {
    if (!n || n.stage !== 'execute' || !result || result.blocked) return null;
    if (!Array.isArray(result.checks) && !Array.isArray(result.defects)) return null;
    const sg = qaSubgoal(run, n.subgoal_id);
    const p = sg && qaReportPaths(run, n.subgoal_id)[0];
    if (!p) return null;
    const body = renderQaReport(sg, result);
    mkdirSync(dirname(p), { recursive: true });
    if (!existsSync(p)) { writeFileSync(p, body); return p; }
    const base = (casesNode(run, n) || {}).report_sha;
    if (!base || base === 'absent' || sha(readFileSync(p)) !== base) return null;
    appendFileSync(p, `\n\n${body}`);
    return p;
  } catch { return null; }
}
