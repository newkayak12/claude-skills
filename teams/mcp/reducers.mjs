// reducers.mjs - the declared reducer registry the fold points already had (foldChild's
// changed_files union, the run's own goal-gate AND-consensus) but never named. Before this
// module the merge rule for a parallel-subgoal fold lived inline, once, in whichever function
// happened to need it, and was not the same rule twice: foldChild deduped changed_files with a
// Set literal, goalConsensus (graph.mjs) took Math.min over match_pct and unioned gaps with a
// second, separately-written Set literal. Neither was wrong, but neither was a thing a third
// caller (the sibling write-scope check below, the manager's per-package fold in
// taskmanager.mjs) could reuse without copying the code, and nothing stopped a fourth fold from
// choosing a fourth convention for the same field. This module is the one place a field's merge
// is named - see docs/plans/2026-09-23-teams-reducer-human-rollback.md §0.1/§1 (D1) and the
// external comparison table there (LangGraph's `Annotated[list, add]` reducer schema; MapReduce's
// associativity/idempotence requirement on a combiner).
//
// Two properties a fold must have to be trustworthy under at-least-once retry (the same
// external comparison, D3): associative/commutative (the RESULT does not depend on the order
// entries arrive in) and idempotent (folding the same entry twice is the same as folding it
// once). Every merge below gets both for free from `applyMerge`'s own machinery - entries are
// deduped by `(node_id, attempt)` and sorted into a canonical order before the merge function
// ever sees them - rather than each merge having to earn them independently. test-reducers.mjs's
// property test is exactly this: shuffle the input, or duplicate an entry, and the fold comes
// back byte-identical.

// ---------- merge primitives ----------
//
// Each merge takes an array of ALREADY DEDUPED, ALREADY SORTED entries - {node_id, attempt,
// value} - and returns one merged value. They never see raw input directly; `applyMerge` is
// the only path in.

function isArr(v) { return Array.isArray(v); }
function toList(v) { return isArr(v) ? v : [v]; }

// Deep-dedup on JSON identity, not on `Set`'s primitive identity: a planning subgoal's
// user_stories[] and a QA subgoal's defects[] are arrays of objects, and a Set of objects
// never collapses two structurally-identical ones. Sorted on the same JSON string so the
// result does not depend on which entry happened to arrive first.
function unionValues(values) {
  const seen = new Map();
  for (const v of values) {
    for (const item of toList(v)) {
      if (item === undefined || item === null || item === '') continue;
      const key = typeof item === 'object' ? JSON.stringify(item) : String(item);
      if (!seen.has(key)) seen.set(key, item);
    }
  }
  return [...seen.keys()].sort().map((k) => seen.get(k));
}

function concatDedup(values) {
  const out = new Set();
  for (const v of values) for (const item of toList(v)) {
    const s = String(item == null ? '' : item).trim();
    if (s) out.add(s);
  }
  return [...out].sort();
}

function andConsensus(entries) {
  return entries.length > 0 && entries.every((e) => e.value === true);
}

function numeric(values, pick) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? pick(...nums) : undefined;
}

// The entry whose attempt sorts last wins - ties broken by node_id so the pick is still a
// pure function of the (deduped) set, not of arrival order. This is the merge a package's own
// RETRY history wants for a field like `accept` or `reason`: attempt 3 superseding attempt 1
// is not consensus among siblings, it is the same package's later word standing in for its
// earlier one.
function lastByAttempt(entries) {
  if (!entries.length) return undefined;
  const ordered = entries.slice().sort((a, b) => {
    const byAttempt = Number(a.attempt || 1) - Number(b.attempt || 1);
    return byAttempt !== 0 ? byAttempt : String(a.node_id).localeCompare(String(b.node_id));
  });
  return ordered[ordered.length - 1].value;
}

export const MERGES = {
  union: (entries) => unionValues(entries.map((e) => e.value)),
  'concat-dedup': (entries) => concatDedup(entries.map((e) => e.value)),
  'and-consensus': (entries) => andConsensus(entries),
  min: (entries) => numeric(entries.map((e) => e.value), Math.min),
  max: (entries) => numeric(entries.map((e) => e.value), Math.max),
  'last-by-attempt': (entries) => lastByAttempt(entries),
};

export const MERGE_KINDS = Object.keys(MERGES);

// Keyed by (node_id, attempt): re-including the exact same entry twice - the same node
// resubmitted, a daemon poll that recomputes a fold it already ran - collapses to one, which
// is what makes every merge above idempotent under at-least-once retry without each of them
// having to guard against it. A LATER map.set for the same key intentionally overwrites an
// earlier one - two submissions of the same (node_id, attempt) are two readings of the same
// fact, and the more recent one (already the one on disk by the time a caller re-folds) is the
// one that should win, not an arbitrary "first wins".
export function dedupeEntries(entries) {
  const map = new Map();
  for (const e of entries || []) {
    if (!e || e.value === undefined) continue;
    map.set(`${e.node_id}::${e.attempt == null ? 1 : e.attempt}`, e);
  }
  return [...map.values()];
}

// Canonical order: by node_id, then by attempt. Applied AFTER dedup, so the fold's output is a
// pure function of the deduped SET of entries, never of the order they were handed in -
// order-independence is what makes "shuffle the input, refold" a valid property test rather
// than a coincidence of one particular arrival order.
function canonicalOrder(entries) {
  return entries.slice().sort((a, b) => {
    const byNode = String(a.node_id).localeCompare(String(b.node_id));
    return byNode !== 0 ? byNode : Number(a.attempt || 1) - Number(b.attempt || 1);
  });
}

export function applyMerge(mergeName, rawEntries) {
  const fn = MERGES[mergeName];
  if (!fn) throw new Error(`reducers: unknown merge "${mergeName}" (have: ${MERGE_KINDS.join(', ')})`);
  return fn(canonicalOrder(dedupeEntries(rawEntries)));
}

// ---------- per-kind field registry ----------
//
// Declared once, per kind, instead of hardcoded inline in whichever function happened to fold
// first. `_default` is what an unrecognized kind (or a package-level record with no kind at
// all - taskmanager.mjs's phase-less develop packages) falls back to; every real kind starts
// from it and only adds the fields its own contract actually returns (prompts.mjs), so a field
// two kinds do not share (qa's `defects`, planning's `user_stories`) does not have to be given
// a meaningless merge rule for every OTHER kind.
const DEFAULT_FIELDS = {
  changed_files: 'union',
  accept: 'and-consensus',
  match_pct: 'min',
  gaps: 'concat-dedup',
  spec_drift: 'concat-dedup',
  reason: 'last-by-attempt',
  handoff: 'last-by-attempt',
  evidence: 'last-by-attempt',
  // Not part of any current contract (prompts.mjs names no per-node cost field today) - declared
  // ahead of one existing so a caller that starts tracking it needs no registry change, per the
  // plan's item 4 ("cost if present"). last-by-attempt, not sum: a retried attempt's cost does
  // not accumulate onto the attempt it superseded any more than its `reason` does.
  cost: 'last-by-attempt',
};

export const REGISTRY = {
  subgoal: { ...DEFAULT_FIELDS },
  document: { ...DEFAULT_FIELDS, observations: 'concat-dedup' },
  planning: { ...DEFAULT_FIELDS, user_stories: 'union', observations: 'concat-dedup' },
  qa: { ...DEFAULT_FIELDS, defects: 'concat-dedup' },
  'planning-audit': { ...DEFAULT_FIELDS, unmet: 'union', defects: 'concat-dedup' },
  _default: { ...DEFAULT_FIELDS },
};

export function reducersFor(kind) {
  return REGISTRY[kind] || REGISTRY._default;
}

// Folds a set of records - {node_id, attempt, fields: {...}} - into one merged object, one
// field at a time, each field through the merge its kind's registry names. A field the
// registry does not declare is left out of the result rather than guessed at: an undeclared
// merge rule is a gap in the registry, not something this function should paper over.
//
// This is the ONE fold function every caller in this plugin now goes through:
//   - graph.mjs's `reduce` node / foldChild's changed_files union (records keyed by each
//     SIBLING subgoal's own (node_id, attempt) - siblings within one round)
//   - taskmanager.mjs's per-package fold (records keyed by each RETRY attempt's own dispatch
//     node - one package's history across attempts, not siblings; see foldPackageHistory's own
//     comment on why `accept` is folded last-by-attempt there instead of the registry's default
//     and-consensus)
export function foldRecords(kind, records) {
  const table = reducersFor(kind);
  const fieldNames = new Set();
  for (const r of records || []) for (const k of Object.keys((r && r.fields) || {})) fieldNames.add(k);
  const out = {};
  for (const field of fieldNames) {
    const mergeName = table[field];
    if (!mergeName) continue;
    const entries = (records || [])
      .filter((r) => r && r.fields && r.fields[field] !== undefined)
      .map((r) => ({ node_id: r.node_id, attempt: r.attempt, value: r.fields[field] }));
    if (!entries.length) continue;
    out[field] = applyMerge(mergeName, entries);
  }
  return out;
}

// ---------- sibling write-scope check ----------
//
// docs/plans/2026-09-23-teams-reducer-human-rollback.md §0.1 and item 2 of this session's
// plan: the CONTRACT.setgoal convention ("give each subgoal the section it owns, by heading,
// in its title and acceptance[]") is prose, and prose breaks silently. This is the
// deterministic, code-level check that runs whether or not the run's own `reduce` LLM pass
// happened to notice the same thing - it is not a replacement for reduce's own undeclared/
// collisions/orphans reporting (which reads what is actually written to DISK, catching a file
// reduce never expected at all), it is a second, cheaper, unconditional check over what the
// SPEC declared versus what each subgoal's own authoring node claims it changed.
//
// `subgoals`: the run's spec.subgoals - each `{id, kind, title, acceptance, files}`.
// `records`: one entry per subgoal actually folded - `{subgoal_id, attempt, changed_files}`,
// read from that subgoal's own author-stage node result (implement/draft/cases/...).
export function writeScopeFindings(subgoals, records) {
  const list = subgoals || [];
  const declaredBy = new Map(); // file -> Set(subgoal_id)
  for (const sg of list) {
    for (const f of sg.files || []) {
      if (!declaredBy.has(f)) declaredBy.set(f, new Set());
      declaredBy.get(f).add(String(sg.id));
    }
  }

  // Only the latest attempt per subgoal counts as "what it actually wrote" - a superseded
  // attempt's changed_files are history, not a live collision.
  const latest = new Map();
  for (const r of records || []) {
    if (!r || r.subgoal_id == null) continue;
    const cur = latest.get(String(r.subgoal_id));
    if (!cur || Number(r.attempt || 1) >= Number(cur.attempt || 1)) latest.set(String(r.subgoal_id), r);
  }

  const writtenBy = new Map(); // file -> Set(subgoal_id)
  for (const r of latest.values()) {
    for (const f of r.changed_files || []) {
      if (!writtenBy.has(f)) writtenBy.set(f, new Set());
      writtenBy.get(f).add(String(r.subgoal_id));
    }
  }

  const collisions = [];
  const undeclaredWriters = [];
  for (const [file, writers] of writtenBy) {
    const owners = declaredBy.get(file) || new Set();
    // Nobody declared it and more than one subgoal wrote it: unambiguous, no owner at all. A
    // file two OR MORE subgoals both declared is the CONTRACT's own legitimate pattern (§ "by
    // heading, in title and acceptance[]") and is not flagged here - the heading-collision check
    // below is what decides whether that shared ownership is actually safe (distinct headings)
    // or not (missing or overlapping ones).
    if (writers.size > 1 && owners.size === 0) {
      collisions.push({
        file,
        written_by: [...writers].sort(),
        declared_by: [],
        reason: 'more than one subgoal wrote this file and none of them declared it in files[]',
      });
    }
    for (const w of writers) {
      if (owners.size && !owners.has(w)) {
        undeclaredWriters.push({ file, subgoal_id: w, declared_owners: [...owners].sort() });
      }
    }
  }

  // Heading collisions: only meaningful among subgoals that share a declared file (the
  // CONTRACT's "by heading" carve-out) - a heading name colliding across two UNRELATED
  // documents is not a collision. Headings are read from the only place the convention puts
  // them today - title and acceptance[] text - since no structured "owns" field exists.
  const byFile = new Map();
  for (const sg of list) {
    for (const f of sg.files || []) {
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(sg);
    }
  }
  const headingCollisions = [];
  for (const [file, sgs] of byFile) {
    if (sgs.length < 2) continue;
    const named = sgs.map((sg) => ({ id: String(sg.id), headings: extractHeadings(sg) })).sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < named.length; i++) {
      for (let j = i + 1; j < named.length; j++) {
        const a = named[i];
        const b = named[j];
        const shared = a.headings.filter((h) => b.headings.includes(h));
        if (shared.length) {
          headingCollisions.push({ file, subgoals: [a.id, b.id], headings: shared, reason: 'both declared ownership of the same heading' });
        } else if (!a.headings.length || !b.headings.length) {
          headingCollisions.push({
            file, subgoals: [a.id, b.id], headings: [],
            reason: `shares this file with a sibling but ${!a.headings.length && !b.headings.length ? 'neither names' : (!a.headings.length ? a.id : b.id) + ' names no'} an owned heading in title/acceptance`,
          });
        }
      }
    }
  }

  return { collisions, undeclared_writers: undeclaredWriters, heading_collisions: headingCollisions };
}

const HEADING_RE = /#{1,6}\s+([^\n"'`]+)/g;
function extractHeadings(sg) {
  const text = [sg.title || '', ...(sg.acceptance || [])].join('\n');
  const out = new Set();
  let m;
  HEADING_RE.lastIndex = 0;
  while ((m = HEADING_RE.exec(text))) {
    const h = m[1].trim().toLowerCase();
    if (h) out.add(h);
  }
  return [...out].sort();
}
