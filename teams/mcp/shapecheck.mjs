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

// What an area's title + brief claims: files (path-like tokens with an extension, "./" dropped),
// call-shaped names (`name()`; a bare name is not a function) and line ranges tied to a file
// ("file:12-40", or "lines 12-40" within 60 characters of a file mention). Pure.
export function areaClaims(area) {
  const text = `${area && area.title != null ? area.title : ''}\n${area && area.brief != null ? area.brief : ''}`;
  const files = new Set();
  const mentions = [];
  const ranges = [];
  for (const m of text.matchAll(/[\w@.\-/]+\.[A-Za-z][A-Za-z0-9]{1,4}\b(?::(\d+)(?:\s*[-–]\s*(\d+))?)?/g)) {
    const file = m[0].replace(/:[\d\s\-–]*$/, '').replace(/^(?:\.\/)+/, '');
    if (/^[A-Z][a-z]+\.(?:js|ts)$/.test(file)) continue; // a product name ("Node.js"), not a path
    files.add(file);
    mentions.push({ file, at: m.index });
    if (m[1]) ranges.push({ file, a: +m[1], b: +(m[2] || m[1]) });
  }
  for (const m of text.matchAll(/\blines?\s+(\d+)\s*[-–]\s*(\d+)/gi)) {
    let best = null;
    for (const f of mentions) {
      const d = Math.abs(f.at - m.index);
      if (d <= 60 && (!best || d < best.d)) best = { d, file: f.file };
    }
    if (best) ranges.push({ file: best.file, a: +m[1], b: +m[2] });
  }
  const fns = new Set([...text.matchAll(/\b([A-Za-z_$][\w$]*)\(\)/g)].map((m) => m[1]));
  return { files, fns, ranges: ranges.map((r) => (r.a <= r.b ? r : { ...r, a: r.b, b: r.a })) };
}

// The claims an area makes to EDIT: only sentences that pair an edit verb with the file and the
// function/lines in the same sentence, and do not disclaim ("F1 owns f(), F2 does not touch it",
// "only calls f()"). A mention, a call or a handed-over owner is not a claim.
const EDIT_VERB = /\b(?:change|changes|rewrite|rewrites|edit|edits|modify|modifies|add to|touch|touches|reshape|reshapes|update|updates|replace|replaces|refactor|refactors|rename|renames|fix|fixes|extend|extends|patch|patches|remove|removes)\b/i;
const DISCLAIM = /\b(?:owns?|owned by|does not|doesn't|do not|don't|not touch|never|untouched|unchanged|leaves?|only (?:calls?|reads?|uses?))\b/i;
function areaEditClaims(area) {
  const text = `${area && area.title != null ? area.title : ''}\n${area && area.brief != null ? area.brief : ''}`;
  const out = { files: new Set(), fnsOf: new Map(), ranges: [] };
  for (const s of text.split(/\n|;|[.!?](?=\s)/)) {
    if (!EDIT_VERB.test(s) || DISCLAIM.test(s)) continue;
    const c = areaClaims({ brief: s });
    for (const f of c.files) {
      out.files.add(f);
      if (!out.fnsOf.has(f)) out.fnsOf.set(f, new Set());
      c.fns.forEach((n) => out.fnsOf.get(f).add(n)); // a function is tied to the files of its own sentence
    }
    out.ranges.push(...c.ranges);
  }
  return out;
}

// Two areas overlap when both plan to EDIT (see areaEditClaims) one file AND (a function name OR an
// intersecting line range). One string per pair; the earlier area by position owns the edit. Same
// file alone is not an overlap: that stays the judge's call.
export function areaOwnershipOverlaps(areas) {
  const list = Array.isArray(areas) ? areas.filter((a) => a && typeof a === 'object') : [];
  const claims = list.map(areaEditClaims);
  const idOf = (a, i) => (a.id != null && String(a.id) !== '' ? String(a.id) : `#${i + 1}`);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const A = claims[i];
      const B = claims[j];
      let what = null;
      for (const file of A.files) {
        if (!B.files.has(file)) continue;
        const bf = B.fnsOf.get(file);
        const fn = [...A.fnsOf.get(file)].find((f) => bf.has(f));
        if (fn) { what = `${fn}() in ${file}`; break; }
        for (const x of A.ranges.filter((r) => r.file === file)) {
          const y = B.ranges.find((r) => r.file === file && r.a <= x.b && x.a <= r.b);
          if (y) { what = `lines ${Math.max(x.a, y.a)}-${Math.min(x.b, y.b)} in ${file}`; break; }
        }
        if (what) break;
      }
      if (!what) continue;
      const a = idOf(list[i], i);
      const b = idOf(list[j], j);
      out.push(`overlap - ${a} and ${b} both plan the edit to ${what}; one owner: ${a} - take it out of ${b}'s brief`);
    }
  }
  return out;
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
  // A criterion is a (story, id) pair: stories may each number their own AC-1.., so a bare id
  // can name several criteria. A cite resolves to the pairs of the stories the package owns.
  const pairs = new Map(); // "story\0id" -> { story, id }
  const writers = new Map(); // AC id -> stories that wrote it
  for (const u of userStories) {
    const sid = storyIdOf(u);
    const acc = u && typeof u === 'object' && Array.isArray(u.acceptance) ? u.acceptance : [];
    for (const x of acc) {
      for (const m of String(x).match(AC_ID) || []) {
        const key = `${sid}\0${m}`;
        if (pairs.has(key)) continue;
        pairs.set(key, { story: sid, id: m });
        writers.set(m, [...(writers.get(m) || []), sid]);
      }
    }
  }
  if (!pairs.size) return empty;
  const resolve1 = (t) => {
    if (writers.has(t)) return t;
    if (/^F\d+-/.test(t)) return null;
    const hits = [...writers.keys()].filter((k) => k.endsWith(`-${t}`));
    return hits.length === 1 ? hits[0] : null;
  };
  const citedBy = new Map(); // pair key -> package ids, first cite first
  const assigned = new Set();
  const unknown = [];
  for (const p of Array.isArray(packages) ? packages : []) {
    const pid = String(p && p.id != null ? p.id : '');
    const owns = new Set([...(Array.isArray(p && p.implements) ? p.implements : []), ...(Array.isArray(p && p.enables) ? p.enables : [])].map(String));
    for (const x of Array.isArray(p && p.acceptance) ? p.acceptance : []) {
      for (const t of String(x).match(AC_ID) || []) {
        const id = resolve1(t);
        if (!id) { if (!unknown.includes(t)) unknown.push(t); continue; }
        const all = writers.get(id);
        const own = all.filter((s) => owns.has(s));
        for (const s of own.length ? own : all) {
          const key = `${s}\0${id}`;
          const list = citedBy.get(key) || [];
          if (!list.includes(pid)) list.push(pid);
          citedBy.set(key, list);
          if (own.length) assigned.add(key);
        }
      }
    }
  }
  const label = ({ story: s, id }) => (writers.get(id).length > 1 ? `${s}/${id}` : id);
  const unassigned = [...pairs].filter(([k]) => !assigned.has(k)).map(([k, v]) => ({
    ac: label(v),
    story: v.story,
    nonOwners: citedBy.get(k) || [],
  }));
  const multi = [...citedBy].filter(([, ids]) => ids.length > 1).map(([k, ids]) => ({ ac: label(pairs.get(k)), story: pairs.get(k).story, packages: ids }));
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
