// Pre-checks on a shape's packages: path overlaps, who carries which PRD acceptance criterion,
// and planning acceptance items that point at a criterion instead of stating one. Pure functions
// (no I/O, no import of taskmanager.mjs, which imports this); the CLI at the bottom reads files.
//
//   node teams/mcp/shapecheck.mjs --prd <10-prd.md> (--task <task.json> | --shape <shape.json>)
//
// Exit 0 clean, 1 problems found, 2 unreadable input.
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// A touches entry as the path it claims: a trailing /** or /* claims the directory, so
// "src/a/**", "src/a/*" and "src/a" are one scope. Any other wildcard is left as written and
// only ever matches itself.
export function touchScope(t) {
  return t.replace(/\/\*\*?$/, '');
}

export function scopesOverlap(a, b) {
  if (a === b) return true;
  if (/[*?[]/.test(a) || /[*?[]/.test(b)) return false;
  return a.startsWith(b + '/') || b.startsWith(a + '/');
}

// Containment counts, not only equality. Every overlap is reported, none deduplicated.
export function pathOverlapProblems(packages) {
  const problems = [];
  const claimsOf = new Map();
  for (const p of Array.isArray(packages) ? packages : []) {
    for (const t of (p && p.touches) || []) {
      const raw = String(t).replace(/\/+$/, '');
      const key = touchScope(raw);
      for (const [other, [oid, oraw]] of claimsOf) {
        if (oid === String(p.id) || !scopesOverlap(key, other)) continue;
        problems.push(raw === oraw
          ? `packages ${oid} and ${p.id} both touch ${raw}`
          : `packages ${oid} and ${p.id} both touch ${key.length >= other.length ? raw : oraw}: ${oid}'s ${oraw} and ${p.id}'s ${raw} overlap - narrow one so each path has one owner`);
      }
      if (!claimsOf.has(key)) claimsOf.set(key, [String(p.id), raw]);
    }
  }
  return problems;
}

// An acceptance ID as the PRD writes it ("F1-AC-2") or a model shortens it ("AC-2").
const AC_ID = /\b(?:F\d+-)?AC-\d+\b/g;
const LEAD_AC = /^\s*(?:F\d+-)?AC-\d+\s*[:.)—–-]*\s*/;
const BARE_IDS = /^(?:(?:F\d+-)?AC-\d+(?:\s*(?:[,;&/]|\band\b)\s*|\s+)?)+[.,;:]*$/i;
// A pointer to criteria elsewhere. These are flagged unless the item also states a criterion.
const HARD_POINTER = /copied verbatim|listed under|ids listed/i;
// Weaker wording: only a pointer when the item talks about criteria and is not a long sentence.
const SOFT_POINTER = /\bsee (?:the )?(?:document|PRD)\b|\bin the (?:document|PRD)\b/i;
const POINTER_WORDS = /\b(see|ids?|criteria|criterion|acceptance|ACs?|copy|copied|verbatim|listed|stated|written)\b/i;

function storyIdOf(s) {
  if (s && typeof s === 'object') return String(s.id || s.US || s.story_id || '').trim();
  return String(s == null ? '' : s).trim();
}

// Acceptance items of a planning story that are only a bare id ("F3-AC-1", "AC-2, AC-3") or a
// placeholder ("the F2-AC ids listed under F2-US-1 in the document, copied verbatim"): they pass
// for a criterion and carry none. An item with Given ... Then, or real text, is never flagged.
export function placeholderAcceptance(stories) {
  const out = [];
  for (const s of Array.isArray(stories) ? stories : []) {
    const story = storyIdOf(s);
    const card = s && typeof s === 'object' && s.card != null ? s.card : null;
    const acc = s && typeof s === 'object' && Array.isArray(s.acceptance) ? s.acceptance : [];
    for (const raw of acc) {
      const item = String(raw);
      const plain = item.replace(/[*`]/g, '').trim();
      if (!plain) continue;
      if (BARE_IDS.test(plain)) { out.push({ story, card, item, kind: 'bare-id' }); continue; }
      const text = plain.replace(LEAD_AC, '');
      if (/\bGiven\b/.test(text) && /\bThen\b/.test(text)) continue;
      const hard = HARD_POINTER.test(text);
      const soft = SOFT_POINTER.test(text) && POINTER_WORDS.test(text) && !/`/.test(item) && text.split(/\s+/).length <= 25;
      if (hard || soft) out.push({ story, card, item, kind: 'placeholder' });
    }
  }
  return out;
}

// Which package carries which PRD acceptance criterion. A package carries an AC when its
// acceptance[] cites it; the AC is assigned when a package that implements or enables the owning
// story carries it. Same id semantics as validateShape: "AC-2" resolves to "F2-AC-2" when only
// one PRD AC ends that way.
export function acAssignment(packages, userStories) {
  const empty = { unassigned: [], multi: [], unknown: [] };
  if (!Array.isArray(userStories)) return empty;
  const prdAc = new Map(); // AC id -> the story that owns it
  for (const u of userStories) {
    const sid = storyIdOf(u);
    const acc = u && typeof u === 'object' && Array.isArray(u.acceptance) ? u.acceptance : [];
    for (const x of acc) for (const m of String(x).match(AC_ID) || []) if (!prdAc.has(m)) prdAc.set(m, sid);
  }
  if (!prdAc.size) return empty;
  const resolve1 = (t) => {
    if (prdAc.has(t)) return t;
    if (/^F\d+-/.test(t)) return null;
    const hits = [...prdAc.keys()].filter((k) => k.endsWith(`-${t}`));
    return hits.length === 1 ? hits[0] : null;
  };
  const citedBy = new Map(); // AC id -> package ids, first cite first
  const assigned = new Set();
  const unknown = [];
  for (const p of Array.isArray(packages) ? packages : []) {
    const pid = String(p && p.id != null ? p.id : '');
    const owns = new Set([...(Array.isArray(p && p.implements) ? p.implements : []), ...(Array.isArray(p && p.enables) ? p.enables : [])].map(String));
    for (const x of Array.isArray(p && p.acceptance) ? p.acceptance : []) {
      for (const t of String(x).match(AC_ID) || []) {
        const k = resolve1(t);
        if (!k) { if (!unknown.includes(t)) unknown.push(t); continue; }
        const list = citedBy.get(k) || [];
        if (!list.includes(pid)) list.push(pid);
        citedBy.set(k, list);
        if (owns.has(String(prdAc.get(k)))) assigned.add(k);
      }
    }
  }
  const unassigned = [...prdAc.keys()].filter((k) => !assigned.has(k)).map((k) => ({
    ac: k,
    story: prdAc.get(k),
    nonOwners: citedBy.get(k) || [],
  }));
  const multi = [...citedBy].filter(([, ids]) => ids.length > 1).map(([ac, ids]) => ({ ac, story: prdAc.get(ac), packages: ids }));
  return { unassigned, multi, unknown };
}

// One string per group, every offender named in it; groups in the order unassigned, multi,
// unknown, then each path overlap on its own.
export function shapePrecheck(spec, userStories) {
  const packages = spec && Array.isArray(spec.packages) ? spec.packages : [];
  const { unassigned, multi, unknown } = acAssignment(packages, userStories);
  const overlaps = pathOverlapProblems(packages);
  const problems = [];
  if (unassigned.length) {
    const names = unassigned.map((u) => (u.nonOwners.length
      ? `${u.ac} (cited only by ${u.nonOwners.join(', ')}, which does not implement or enable ${u.story})`
      : `${u.ac} (no package cites it)`));
    problems.push(`PRD acceptance criteria missing from every implementing package's acceptance[]: ${names.join(', ')} - copy each AC-n item verbatim, ID-prefixed, into the acceptance[] of the package that implements (or enables) its story`);
  }
  if (multi.length) {
    problems.push(`PRD acceptance criteria carried by more than one package: ${multi.map((m) => `${m.ac} (${m.packages.join(', ')})`).join('; ')} - each AC-n belongs to exactly one package; move it out of all but the package that implements or enables its story`);
  }
  if (unknown.length) {
    problems.push(`acceptance IDs not in the PRD: ${unknown.join(', ')} - a package may cite only the AC-n its stories wrote`);
  }
  problems.push(...overlaps);
  return { ok: problems.length === 0, unassigned, multi, unknown, overlaps, problems };
}

// One message for a rejected shape: each distinct problem once, in order.
export function formatShapeFeedback(problems) {
  const seen = [];
  for (const p of Array.isArray(problems) ? problems : []) {
    const s = String(p);
    if (s && !seen.includes(s)) seen.push(s);
  }
  return seen.length ? `\n- ${seen.join('\n- ')}` : '';
}

// ---------- CLI ----------

function block(nodeId, r) {
  const lines = [`${nodeId}: ${r.ok ? 'ok' : `${r.problems.length} problem${r.problems.length === 1 ? '' : 's'}`}`];
  const group = (title, items) => {
    if (!items.length) return;
    lines.push(`  ${title}:`);
    for (const i of items) lines.push(`    - ${i}`);
  };
  group('unassigned AC', r.unassigned.map((u) => (u.nonOwners.length ? `${u.ac} (story ${u.story}) cited only by ${u.nonOwners.join(', ')}` : `${u.ac} (story ${u.story}) cited by no package`)));
  group('multi-carried AC', r.multi.map((m) => `${m.ac} (story ${m.story}) carried by ${m.packages.join(', ')}`));
  group('unknown AC', r.unknown);
  group('path overlaps', r.overlaps);
  return lines.join('\n');
}

// prdStories reads only the first "## User stories" section, and a merged multi-card PRD keeps
// each story's AC bullets under its own "#### F2-US-5 ..." heading further down. Add every
// "- F2-AC-26: ..." bullet found under a story heading to that story's acceptance (new stories
// are appended), so the check sees the criteria the document actually wrote.
function mergeDocAcceptance(stories, text) {
  const byId = new Map(stories.map((s) => [s.id, { ...s, acceptance: [...s.acceptance] }]));
  let cur = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^#{2,6}\s*((?:[A-Za-z][A-Za-z0-9]*-)?US-\d+)\b/);
    if (h) {
      if (!byId.has(h[1])) byId.set(h[1], { id: h[1], title: '', acceptance: [], source: 'prd' });
      cur = byId.get(h[1]);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) { cur = null; continue; }
    const ac = cur && line.match(/^\s*[-*]\s+((?:F\d+-)?AC-\d+)\b/);
    if (ac && !cur.acceptance.some((x) => String(x).match(AC_ID)?.includes(ac[1]))) cur.acceptance.push(line.replace(/^\s*[-*]\s+/, '').trim());
  }
  return [...byId.values()];
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv) {
  const prd = arg(argv, '--prd');
  const task = arg(argv, '--task');
  const shape = arg(argv, '--shape');
  if (!prd || (!task && !shape) || (task && shape)) {
    process.stderr.write('usage: shapecheck.mjs --prd <10-prd.md> (--task <task.json> | --shape <shape.json>)\n');
    return 2;
  }
  const prdPath = resolve(prd);
  let input;
  try {
    readFileSync(prdPath, 'utf8');
    input = JSON.parse(readFileSync(resolve(task || shape), 'utf8'));
  } catch (e) {
    process.stderr.write(`shapecheck: cannot read input: ${e.message}\n`);
    return 2;
  }
  const { prdStories } = await import('./taskmanager.mjs');
  const stories = mergeDocAcceptance(prdStories(dirname(prdPath), [basename(prdPath)]), readFileSync(prdPath, 'utf8'));
  const targets = [];
  if (task) {
    for (const n of Array.isArray(input.nodes) ? input.nodes : []) {
      if (n && n.stage === 'shape' && n.result && Array.isArray(n.result.packages)) targets.push([String(n.node_id), n.result]);
    }
    if (!targets.length) { process.stderr.write('shapecheck: no shape node with result.packages in the task\n'); return 2; }
  } else {
    const spec = Array.isArray(input) ? { packages: input } : input;
    if (!spec || !Array.isArray(spec.packages)) { process.stderr.write('shapecheck: the shape JSON has no packages array\n'); return 2; }
    targets.push(['shape', spec]);
  }
  let bad = 0;
  for (const [id, spec] of targets) {
    const r = shapePrecheck(spec, stories);
    if (!r.ok) bad += 1;
    process.stdout.write(`${block(id, r)}\n`);
  }
  return bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
