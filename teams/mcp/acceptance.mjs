// teams/mcp/acceptance.mjs - "does this backlog already carry its acceptance criteria?"
//
// docs/plans/2026-09-28-teams-light-plan.md §2.1. A structural check, never a model's opinion:
// the answer picks between the full PLAN chain (investigate -> draft -> revise -> gate) and the
// light one (investigate -> template-fill -> gate) when roles.planning is 'auto', and the same
// function is meant to decide how short the brainstorm step may be (§6.5-4) - defined once, here,
// so the two never drift. Pure: no I/O, no clock, no state; same input, same answer.
//
// Two paths, in order of trust:
//   (a) structured - tm_open's own fields: requests[].acceptance (every item non-empty) or
//       shared_acceptance (non-empty, covers every item). The recommended path.
//   (b) parser - for a backlog that still arrives as free text: a numbered list 1..n (n >= 2)
//       plus an `Acceptance( for every item)?:` heading line followed by a bullet list, either
//       once below the whole list (shared) or once under every item (per-item).
// Anything else - a heading with no bullets, a numbered list that restarts or skips, a shared
// block above the list, only some items covered - is ambiguous and answers false. Failing toward
// false fails toward the heavier chain, which only costs time (§4).

// A heading line on its own: optional markdown `#`/`**`, "Acceptance" (optionally "criteria"),
// optionally "for every/each/all item(s)" or "(every item)", optional colon, nothing after it.
// Group 1 set = the shared form.
const HEADING = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*acceptance(?:\s+criteria)?(\s+(?:for|on|to)\s+(?:every|each|all)(?:\s+(?:backlog|the))?\s+items?|\s*\((?:for\s+)?(?:every|each|all)\s+items?\))?\s*(?:\*\*|__)?\s*:?\s*(?:\*\*|__)?\s*$/i;
// A bullet under that heading: -, *, +, •, a number, or a rule label R1/R1./R1:/R1).
const BULLET = /^\s*(?:[-*+•]|\d+[.)]|R\d+[.:)]?)\s+\S/;
// A top-level backlog item: `1. ...` / `1) ...` at column 0-1, or the composed
// `[backlog priority N] ...` form taskmanager.mjs's composeBacklogRequest writes (N is 0-based).
const ITEM = /^ ?(\d+)[.)]\s+(\S.*)$/;
const COMPOSED_ITEM = /^\[backlog priority (\d+)\]\s+(\S.*)$/;

const clean = (list) => (Array.isArray(list) ? list.map((s) => (s == null ? '' : String(s).trim())).filter(Boolean) : []);
const stripBullet = (line) => line.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '').trim();

// Every acceptance heading in `lines` with the bullets directly under it (blank lines between
// bullets allowed; an indented non-bullet line continues the bullet above it). Returns the
// blocks and the set of line indexes they consumed, so a numbered bullet under a heading is
// never mistaken for a backlog item.
function acceptanceBlocks(lines) {
  const blocks = [];
  const consumed = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING.exec(lines[i]);
    if (!m) continue;
    consumed.add(i);
    const indent = /^\s*/.exec(lines[i])[0].length;
    const bullets = [];
    let numberedBlock = false;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim()) continue;
      if (HEADING.test(line)) break;
      // Outdented past the heading: the block is over (an item's own "   Acceptance:" ends at
      // the next top-level "2. ...", which is the backlog's, not a bullet of this block).
      const lead = /^\s*/.exec(line)[0].length;
      if (lead < indent) break;
      // A block of `-` bullets is not continued by a numbered line at the heading's own
      // indent: that is the next backlog item ("Acceptance:\n- x\n2. next item").
      const numbered = /^\s*\d+[.)]\s/.test(line);
      if (numbered && lead === indent && bullets.length && !numberedBlock) break;
      if (BULLET.test(line)) {
        if (!bullets.length) numberedBlock = numbered;
        bullets.push(stripBullet(line)); consumed.add(j); continue;
      }
      if (bullets.length && /^\s{2,}\S/.test(line)) { bullets[bullets.length - 1] += ` ${line.trim()}`; consumed.add(j); continue; }
      break;
    }
    blocks.push({ at: i, indent, shared: !!m[1], bullets, blankBefore: i > 0 && !lines[i - 1].trim() });
  }
  return { blocks, consumed };
}

// Parse one free-text backlog. Returns {ok, reason, items: [{n, text, acceptance: []}], shared: []}.
// ok=true only for one of the two unambiguous layouts (§2.1b); every other shape says why not.
export function parseBacklogAcceptance(text) {
  const out = (ok, reason, items = [], shared = []) => ({ ok, reason, items, shared });
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  const { blocks, consumed } = acceptanceBlocks(lines);
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue;
    let m = ITEM.exec(lines[i]);
    if (m) { items.push({ at: i, n: Number(m[1]), text: m[2].trim(), acceptance: [] }); continue; }
    m = COMPOSED_ITEM.exec(lines[i]);
    if (m) items.push({ at: i, n: Number(m[1]) + 1, text: m[2].trim(), acceptance: [] });
  }
  if (items.length < 2) return out(false, `no numbered backlog (found ${items.length} numbered item${items.length === 1 ? '' : 's'}, need 2+)`);
  if (items.some((it, i) => it.n !== i + 1)) return out(false, `numbered backlog is not one 1..${items.length} sequence (${items.map((it) => it.n).join(',')})`);
  if (!blocks.length) return out(false, 'no "Acceptance:" heading with a bullet list');
  const empty = blocks.find((b) => !b.bullets.length);
  if (empty) return out(false, `"Acceptance" heading at line ${empty.at + 1} has no bullet list under it`);

  const first = items[0].at;
  const last = items[items.length - 1].at;
  if (blocks.some((b) => b.at < first)) return out(false, 'an "Acceptance" block sits above the backlog - cannot tell what it covers');
  // A plain "Acceptance:" reads as the whole list's block only when it is the ONLY heading
  // there is, at column 0 below the list and set off by a blank line. Indented, glued to the
  // last item, or one of several plain headings, it reads as the item above it.
  const plain = blocks.filter((b) => !b.shared);
  const loneListBlock = !blocks.some((b) => b.shared) && plain.length === 1
    && plain[0].at > last && plain[0].indent === 0 && plain[0].blankBefore;
  const isShared = (b) => b.shared || loneListBlock;
  const shared = blocks.filter(isShared);
  const perItem = blocks.filter((b) => !isShared(b));
  if (shared.length > 1) return out(false, `${shared.length} shared "Acceptance" blocks - cannot tell which one holds`);
  if (shared.length && shared[0].at < last) return out(false, 'the shared "Acceptance" block sits inside the backlog, not below it');
  for (const b of perItem) {
    const owner = items.filter((it) => it.at < b.at).pop();
    owner.acceptance.push(...b.bullets);
  }
  const strip = (it) => ({ n: it.n, text: it.text, acceptance: it.acceptance });
  if (shared.length) return out(true, 'numbered backlog + shared "Acceptance" block', items.map(strip), shared[0].bullets.slice());
  const missing = items.filter((it) => !it.acceptance.length).map((it) => it.n);
  if (missing.length) return out(false, `per-item "Acceptance" blocks missing for item${missing.length === 1 ? '' : 's'} ${missing.join(', ')}`, items.map(strip));
  return out(true, 'numbered backlog + an "Acceptance" block under every item', items.map(strip));
}

// The acceptance block inside ONE backlog item's own text (a requests[] string). Bullets of
// every heading found, or [] when there is none or a heading has nothing under it.
function itemTextAcceptance(text) {
  const { blocks } = acceptanceBlocks(String(text == null ? '' : text).split(/\r?\n/));
  if (!blocks.length || blocks.some((b) => !b.bullets.length)) return [];
  return blocks.flatMap((b) => b.bullets);
}

function itemOf(r) {
  if (r && typeof r === 'object') {
    const text = String(r.request != null ? r.request : (r.text != null ? r.text : (r.title != null ? r.title : '')));
    return { text, structured: clean(r.acceptance) };
  }
  return { text: String(r == null ? '' : r), structured: [] };
}

// The full answer, with the evidence: {declared, via: 'structured'|'parser'|null, reason,
// items: [{text, acceptance: []}], shared: []}. `input` is tm_open's own argument shape
// ({request?, requests?, shared_acceptance?}); a bare string is read as `request`.
export function detectDeclaredAcceptance(input) {
  const a = typeof input === 'string' ? { request: input } : (input && typeof input === 'object' ? input : {});
  const shared = clean(a.shared_acceptance);
  const requests = Array.isArray(a.requests) && a.requests.length ? a.requests.map(itemOf) : null;
  const no = (reason, items = [], sh = []) => ({ declared: false, via: null, reason, items, shared: sh });

  if (requests) {
    const items = requests.map((r) => ({ text: r.text, acceptance: r.structured.length ? r.structured : itemTextAcceptance(r.text), structured: r.structured.length > 0 }));
    const view = items.map(({ text, acceptance }) => ({ text, acceptance }));
    if (shared.length) return { declared: true, via: 'structured', reason: 'shared_acceptance covers every backlog item', items: view, shared };
    const missing = items.map((it, i) => (it.acceptance.length ? null : i)).filter((i) => i !== null);
    if (missing.length) return no(`backlog item${missing.length === 1 ? '' : 's'} ${missing.join(', ')} (0-based) carr${missing.length === 1 ? 'ies' : 'y'} no acceptance`, view);
    const allStructured = items.every((it) => it.structured);
    return { declared: true, via: allStructured ? 'structured' : 'parser', reason: allStructured ? 'every requests[] item has acceptance[]' : 'every requests[] item carries acceptance (structured or an "Acceptance:" block in its text)', items: view, shared: [] };
  }

  const request = a.request == null ? '' : String(a.request);
  if (shared.length) return { declared: true, via: 'structured', reason: 'shared_acceptance covers the request', items: [{ text: request, acceptance: [] }], shared };
  if (!request.trim()) return no('no request');
  const p = parseBacklogAcceptance(request);
  if (!p.ok) return no(p.reason, p.items.map(({ text, acceptance }) => ({ text, acceptance })), p.shared);
  return { declared: true, via: 'parser', reason: p.reason, items: p.items.map(({ text, acceptance }) => ({ text, acceptance })), shared: p.shared };
}

// The boolean the plan names (§2.1): true only when the backlog's acceptance criteria are
// already declared, structurally. Exported by this name for every caller - the planning-mode
// resolution below and the brainstorm step (§6.5-4) alike.
export function hasDeclaredAcceptance(input) {
  return detectDeclaredAcceptance(input).declared;
}

// roles.planning -> the chain that actually runs (§2.5). 'auto' picks 'light' or 'full' and
// NEVER 'off': removing the safety net is always a person's explicit decision.
// Returns {mode: 'full'|'light'|'off', source: 'explicit'|'auto', reason, detection?}.
export function resolvePlanningMode(planning, input) {
  // roles.planning: false is refused (docs/plans/2026-09-28-teams-cards-everywhere.md C5): it
  // resolves exactly like the default 'auto', and says so. There is no 'off' mode any more -
  // teamconfig.mjs's applyLayer already dropped the value with a note before it could get here;
  // this is the same rule for a caller that hands the raw value in directly.
  if (planning === false) {
    const auto = resolvePlanningMode('auto', input);
    return { ...auto, source: 'refused', reason: `roles.planning: false is refused (planning always runs) - ${auto.reason}` };
  }
  if (planning === true) return { mode: 'full', source: 'explicit', reason: 'roles.planning: true' };
  if (planning === 'light') return { mode: 'light', source: 'explicit', reason: "roles.planning: 'light'" };
  const detection = detectDeclaredAcceptance(input);
  return {
    mode: detection.declared ? 'light' : 'full',
    source: 'auto',
    reason: `roles.planning: 'auto' - ${detection.declared ? 'acceptance already declared' : 'acceptance not declared'} (${detection.reason})`,
    detection,
  };
}

// The deterministic half of template-fill (§2.2): the backlog's own criteria laid out in
// requests[] order with R-numbers, so the one model call copies and cites instead of composing,
// and the gate has a fixed matrix to check coverage against (§2.3). A shared rule that already
// starts with its own R-label keeps it; the rest are numbered after the labels in order.
export function renderAcceptanceTemplate(det) {
  if (!det || !Array.isArray(det.items)) return '';
  const L = [];
  const rules = (det.shared || []).map((s) => {
    const m = /^(R\d+)[.:)]?\s+(.*)$/.exec(s);
    return m ? { id: m[1], text: m[2] } : { id: null, text: s };
  });
  const used = new Set(rules.map((r) => r.id).filter(Boolean));
  let next = 1;
  for (const r of rules) {
    if (r.id) continue;
    while (used.has(`R${next}`)) next++;
    r.id = `R${next}`;
    used.add(r.id);
  }
  if (rules.length) {
    L.push('Shared rules - apply to EVERY item below:');
    for (const r of rules) L.push(`- ${r.id}: ${r.text}`);
    L.push('');
  }
  det.items.forEach((it, i) => {
    // `n` keeps an item's backlog number when a planning card is handed only its own area's
    // items (taskmanager.mjs's childContext): Item 3 stays Item 3, A3.1 stays A3.1.
    const k = Number.isInteger(it.n) ? it.n : i + 1;
    L.push(`Item ${k}: ${String(it.text || '').split('\n')[0].trim()}`);
    (it.acceptance || []).forEach((c, j) => L.push(`- A${k}.${j + 1}: ${c}`));
    if (rules.length) L.push(`- applies: ${rules.map((r) => r.id).join(', ')}`);
    L.push('');
  });
  return L.join('\n').trim();
}
