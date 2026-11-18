// names.mjs - readable names for a task: the EPIC slug taken from its request, the package label
// taken from a package title, and the collision suffix. Pure: no file, git or clock access, so the
// same input always gives the same name (taskmanager.mjs decides what is already taken and passes
// it in). The E-xxxxxxxx key stays the id; a slug is only a label next to it.
//
// Words: lowercase ascii [a-z0-9]+ runs, minus a small stopword set and pure numbers. A
// whitespace-separated token that looks like a path or a file (contains '/', or ends in .<ext>
// once leading and trailing punctuation and symbols are stripped) gives no words. Hangul is romanized
// (Revised Romanization, one syllable at a time, no liaison or assimilation) only when the text has
// fewer than two ascii words, so a Korean sentence with one English term still reads as Korean.
// A trailing possessive 's / ’s is dropped from a token before its punctuation is trimmed; after
// it let that what there here he she who it is a contraction and only the apostrophe goes (it's -> its).
//
// Card mode (see cardSlug): a request that matches "card N" / "cards N, M and K" uses only its first
// sentence (. ! or ? followed by whitespace or the end). A plan path in it gives the plan topic's
// words verbatim and nothing else; otherwise the words above minus instruction fillers (read, fully,
// no version bump...). The prefix card-N, cards-a-b (3+ consecutive) or cards-a-b-c leads when a plan
// topic was found or fewer than 2 words remain. Cap 32: prefix whole, words while they fit.
//
// Name (epicName, givenName, taskName): the readable title of an EPIC, in the request's own language,
// at most 60 chars per item. A name is made only of whole tokens of its source, never edited inside a
// word: no particle, ending or article is stripped, no stem is cut. Source: the title, else each
// requests item, else the request; first line only. Backlog/card/카드 N(번)/part prefixes,
// parentheses, E- keys and backticks go; a path-only token (a '/' and only path characters, or a
// leading / ./ ~, a trailing / or a file at the end) is removed whole, never shortened. The first
// clause with words (up to : ; . ? ! or a dash; a one-word label yields to a later clause of 2+) is
// the name when it fits. Too long: the part before its first ', ' (comma and a space; 티캣,을 is one
// token) when it has 3+ words, else the head before the first subordinate word (that, so, when,
// because, which, if, after, instead...), else the longest head that fits; each ends in '…' after
// trailing function words (a, the, of, to, in, by, and, with...) are backed off whole. Only a first
// token longer than 59 chars is cut inside itself, and the '…' marks it. Several items are joined by
// ' · ' while they fit, with ' +K' for the rest. Nothing readable: 'untitled work'. A name the caller
// wrote (givenName) is its first line cut the same way; taskName prefers a stored one.
// Lines are tried in order until one names; after a card prefix, scaffolding (items 5-7, leftover,
// carryover D1, on top of P1, package labels, a leading in/of/and) goes like the card number, and a
// line left with under 3 words yields to a later one. An E-key takes the function word before it.
// A label clause ("...것:") yields to the clause after it.
import { createHash } from 'node:crypto';

const SLUG_MAX = 32;
const PACKAGE_SLUG_MAX = 24;
const STOPWORDS = new Set(
  'a an the and or of to in for on with by is be this that card cards backlog user'.split(' '));

const INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const VOWELS = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we',
  'wi', 'yu', 'eu', 'ui', 'i'];
const FINALS = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p',
  't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

function romanize(text) {
  let out = '';
  for (const ch of text) {
    const n = ch.charCodeAt(0) - 0xac00;
    if (n < 0 || n > 11171) continue;
    out += INITIALS[Math.floor(n / 588)] + VOWELS[Math.floor((n % 588) / 28)] + FINALS[n % 28];
  }
  return out;
}

// One trailing particle off a Hangul word, the longest match first; a word that is only a particle
// (or would be empty after the strip) is kept.
const PARTICLES = ['에서', '으로', '을', '를', '이', '가', '은', '는', '에', '의', '로', '와', '과', '도', '만'];
function stripParticle(word) {
  for (const p of PARTICLES) {
    if (word.length > p.length && word.endsWith(p)) return word.slice(0, -p.length);
  }
  return word;
}

const isPathLike = (tok) => tok.includes('/') || /\.[a-z][a-z0-9]{0,4}$/i.test(tok);

const CONTRACTIONS = new Set('it let that what there here he she who'.split(' '));
const dropS = (m, at, str) => (CONTRACTIONS.has(str.slice(0, at).replace(/^[\p{P}\p{S}]+/u, '')) ? 's' : '');

// Words of `text` in order, each { ascii: boolean, w }, path tokens, stopwords and numbers dropped.
function wordsOf(text) {
  const out = [];
  for (const raw of String(text ?? '').normalize('NFC').toLowerCase().split(/\s+/)) {
    const tok = raw.replace(/['’]s(?=[\p{P}\p{S}]*$)/u, dropS).replace(/^[\p{P}\p{S}]+/u, '').replace(/[\p{P}\p{S}]+$/u, '');
    if (!tok || isPathLike(tok)) continue;
    for (const m of tok.match(/[a-z0-9]+|[가-힣]+/g) ?? []) {
      if (/^[a-z0-9]/.test(m)) {
        if (!STOPWORDS.has(m) && !/^[0-9]+$/.test(m)) out.push({ ascii: true, w: m });
      } else {
        const r = romanize(stripParticle(m));
        if (r) out.push({ ascii: false, w: r });
      }
    }
  }
  return out;
}

// Two or more ascii words win over Hangul; fewer keeps every word.
function pickWords(words) {
  const ascii = words.filter((x) => x.ascii);
  return ascii.length >= 2 ? ascii : words;
}

// `slug` plus `words`, each joined by '-', stopping at the first word that would pass max (a first
// word longer than an empty slug's max is hard-cut).
function appendWords(slug, words, max) {
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w.slice(0, max);
    if (next.length > max) break;
    slug = next;
  }
  return slug;
}

// Words joined by '-', cut at a word boundary to <= max (a first word longer than max is hard-cut).
function slugOf(text, max) {
  return appendWords('', pickWords(wordsOf(text)).map((x) => x.w), max);
}

// Card mode: a request that names backlog cards ("card 48", "cards 62, 63 and 64") is slugged from
// its first sentence only (. ! or ? followed by whitespace or the end, so a .md in a path does not
// end it). A plan path there (plans/[subdirs/]YYYY-MM-DD-<topic>.md) gives the topic's words
// verbatim in place of every other word; otherwise the words are wordsOf's minus CARD_FILLER. The
// card prefix (card-48, cards-62-64 for 3+ consecutive numbers, else cards-5-9) leads when a plan
// topic was found or fewer than 2 words remain; with 2+ plain words the words stand alone. Capped
// at SLUG_MAX: the prefix whole, words only while they fit, never ending in '-'.
const CARD_REF = /\bcards?\s+#?(\d+(?:\s*(?:,|and|&)\s*\d+)*)/i;
const CARD_FILLER = new Set(
  'read fully each no version bump only parts it plugin three'.split(' '));
const PLAN_TOPIC = /plans\/(?:[^\s/`()]+\/)*\d{4}-\d{2}-\d{2}-([a-z0-9]+(?:-[a-z0-9]+)*)\.md/i;

function cardPrefix(nums) {
  if (nums.length === 1) return `card-${nums[0]}`;
  const range = nums.length >= 3 && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  return `cards-${range ? `${nums[0]}-${nums[nums.length - 1]}` : nums.join('-')}`;
}

function cardSlug(request, ref) {
  const nums = [...new Set(ref[1].match(/\d+/g).map(Number))];
  const text = String(request).normalize('NFC');
  const end = /[.!?](?=\s|$)/.exec(text);
  const sentence = end ? text.slice(0, end.index + 1) : text;
  const topic = PLAN_TOPIC.exec(sentence);
  const words = topic
    ? topic[1].toLowerCase().split('-')
    : pickWords(wordsOf(sentence)).map((x) => x.w).filter((w) => !CARD_FILLER.has(w));
  let prefix = '';
  if (topic || words.length < 2) {
    prefix = cardPrefix(nums);
    if (prefix.length > SLUG_MAX) {
      const head = prefix.slice(0, SLUG_MAX + 1);
      prefix = head.slice(0, head.lastIndexOf('-'));
    }
  }
  return appendWords(prefix, words, SLUG_MAX).replace(/-+$/, '');
}

export function epicSlug(request) {
  const ref = CARD_REF.exec(String(request ?? ''));
  return (ref ? cardSlug(request, ref) : slugOf(request, SLUG_MAX))
    || `task-${createHash('sha1').update(String(request ?? '')).digest('hex').slice(0, 6)}`;
}

// `<pkgId>` or `<pkgId>-<title slug>`: the id stays verbatim as the prefix.
export function packageName(pkgId, title) {
  const slug = slugOf(title, PACKAGE_SLUG_MAX);
  return slug ? `${pkgId}-${slug}` : String(pkgId);
}

// `base`, else `base-2`, `base-3`, ... the first not in `taken`; base is trimmed so the result
// stays <= 32 with no trailing '-'.
export function uniqueSlug(base, taken) {
  const used = new Set(taken ?? []);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const cand = base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '') + suffix;
    if (!used.has(cand)) return cand;
  }
}

const NAME_MAX = 60;
const ARTICLES = new Set('a an the its their'.split(' '));
const BOUNDARY = new Set(
  'plus to for by from so when because that which instead never while after before if and or but in on at of via until unless'.split(' '));
const FUNCTION_WORDS = new Set([...BOUNDARY, ...ARTICLES,
  ...'as is be with into onto inside under out over about through across within between than below above against per how why what who where whose whatever'.split(' ')]);
// A cut ends before the first of these (a subordinate clause), never inside it; a cut never ends on a TRAIL word.
const SUBORDINATE = new Set('that so when whatever because while which if after before until unless instead'.split(' '));
const TRAIL = new Set('a an the of to in on at by for with and or from as is are its their'.split(' '));
const FIT = NAME_MAX - 1; // room for the …
const NUM_LIST = String.raw`#?\d+[a-z]?\b(?:\s*(?:,|and|&)\s*#?\d+[a-z]?\b)*`;
const KO_NUM_LIST = String.raw`#?\d+(?:\s?번)?(?:\s*(?:,|과|와|및|and|&)\s*#?\d+(?:\s?번)?)*`;
const JOINERS = /^(?:[\s:,;—–]|-+(?=\s))+/; // a hyphen joins only when a space follows: --once keeps its dashes
const PREFIXES = [
  /^\[backlog priority \d+\]/i,
  new RegExp(String.raw`^(?:backlog\s+)?cards?\s+${NUM_LIST}`, 'i'),
  new RegExp(String.raw`^(?:백로그\s*)?카드\s*${KO_NUM_LIST}`),
  new RegExp(String.raw`^parts?\s+${NUM_LIST}`, 'i'),
  /^\([^)]*\)/,
  /^#?\d+[:)]\s+/, // a card label on its own line ("147: ...")
  JOINERS,
];
const CLAUSE_END = /:(?=\s|$)|\s[—–]\s|;|\.(?=\s|$)|[?!](?=\s|$)/;
const hasLetter = (t) => /\p{L}/u.test(t);

// Scaffolding after a card prefix, stripped like the card number: `items 5-7`, `leftover`, `carryover`,
// `follow-up` (the last three only before a punctuation, a package label or the end), `on top of P1`,
// the package labels that follow (QA-F1, D1) and the joining word left in front. Case-sensitive on purpose:
// a label is capitals plus digits.
const LABEL = String.raw`[A-Z]{1,3}-?[A-Z]?\d+\b`;
const ITEMS = new RegExp(String.raw`^[Ii]tems?\s+\d+(?:[-–]\d+)?(?:\s*(?:,|and|&)\s*\d+(?:[-–]\d+)?)*\b`);
const LEFTOVER = new RegExp(String.raw`^(?:[Ll]eftovers?|[Cc]arry-?overs?|[Ff]ollow-?ups?)(?=\s*(?:[,:;.]|$)|\s+${LABEL})`);
const LEAD_LABEL = new RegExp(String.raw`^${LABEL}`);
const LEAD_JOIN = /^(?:(?:[\s.,:;—–]|-+(?=\s))+|(?:and|or|in|on|of|to|for|from|at)\b\s*)/i;
// A label clause ("사용자가 요청한 것:", "the following:") says nothing; the clause after it does.
const LABEL_CLAUSE = /^[^:]*(?:것|내용|사항|다음|following|below)\s*:\s+/;

const CUT_PATH = ''; // a path-only token was removed here
const CUT_ELL = ''; // a token holding … was removed here
const MARKS = [CUT_PATH, CUT_ELL];
function cleanText(line) {
  let t = line.replace(/[]/g, '').trim();
  let lead = false;
  for (let again = true; again;) {
    again = false;
    for (const re of PREFIXES) {
      const next = t.replace(re, '');
      if (next !== t) { t = next; again = true; if (PREFIXES.indexOf(re) < 4) lead = true; }
    }
  }
  while (/\([^()]*\)/.test(t)) t = t.replace(/\([^()]*\)/g, ' ');
  const toks = [];
  for (const tok of t.split(/\s+/)) {
    const b = baseName(tok);
    // an E-key removed after a function word takes that word with it ("of E-1a2b3c4d")
    if (!b && /^E-[0-9a-f]{8}$/.test(tok.replace(WRAP_L, '').replace(WRAP_R, ''))
      && toks.length && FUNCTION_WORDS.has(toks.at(-1).toLowerCase())) toks.pop();
    if (b) toks.push(b);
    else if (tok.trim() && toks.length && !MARKS.includes(toks.at(-1)) && !/^E-[0-9a-f]{8}$/.test(tok.replace(WRAP_L, '').replace(WRAP_R, ''))) {
      toks.push(tok.includes('…') ? CUT_ELL : CUT_PATH); // where a token was removed whole: lineName cuts there when the rest would strand
    }
  }
  t = toks.join(' ').replace(/`/g, '').replace(/\s+/g, ' ').replace(/\s+([,.;:!?])(?=\s|$)/g, '$1')
    .replace(/\s*,?\s*\bon top of \S+/gi, ' ').replace(JOINERS, '').trim();
  let scaffold = false;
  for (let again = true; again;) {
    again = false;
    for (const re of [ITEMS, LEFTOVER]) {
      const next = t.replace(re, '');
      if (next !== t) { t = next; again = scaffold = lead = true; }
    }
    if (lead) {
      for (const re of scaffold ? [LEAD_LABEL, LEAD_JOIN] : [LEAD_JOIN]) {
        const next = t.replace(re, '');
        if (next !== t) { t = next; again = true; }
      }
    }
  }
  const rest = t.replace(LABEL_CLAUSE, '');
  if (hasLetter(rest)) t = rest;
  return { text: t.trim(), scaffold };
}

// A path-only token (a '/' and nothing but path characters, or a leading / ./ ~, a trailing / or a
// file at the end) is removed whole, never shortened; so is an E-xxxxxxxx key. Any other token stays.
const WRAP_L = /^[“‘"'(<[*`]+/;
const WRAP_R = /[)>\]*"'”’`,;:!?.…—]+$/;
function baseName(tok) {
  if (tok.includes('…')) return ''; // a source '…' is never kept or turned into a space: its token goes whole
  const core = tok.replace(WRAP_L, '').replace(WRAP_R, '');
  if (/^E-[0-9a-f]{8}$/.test(core)) return '';
  if (core.includes('/')) {
    const segs = core.split('/');
    const last = segs.filter(Boolean).at(-1) ?? '';
    if (/^[\w.~@/-]+$/.test(core) || segs.length > 2 || !segs[0] || core.endsWith('/') || /^[.~]/.test(core) || isPathLike(last)) return '';
  }
  return isPathLike(core) ? core + tok.slice(tok.replace(WRAP_R, '').length) : tok;
}

const bare = (w) => w.toLowerCase().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
const wordsIn = (t) => t.split(/\s+/).filter(Boolean);

// The first `words` as one whole-token head, trailing function words and a trailing , ; : backed off.
function headOf(words) {
  const kept = [...words];
  while (kept.length >= 2 && TRAIL.has(bare(kept.at(-1)))) kept.pop();
  return kept.join(' ').replace(/[,;:]+$/, '');
}

// `words` whole when they fit NAME_MAX; else the first of: the part before the first ', ' (3+ words),
// the head before the first SUBORDINATE word (index 3+), the longest head that fits (the only step
// with `longestOnly`); each ends in '…'. Only a first token longer than FIT is cut inside itself, at FIT, and marked by the '…'.
function cutName(words, longestOnly = false) {
  const whole = words.join(' ');
  if (whole.length <= NAME_MAX) return whole;
  const mark = (head) => (head.length <= FIT ? `${head}…` : '');
  const comma = wordsIn(whole.split(/,\s/)[0]);
  if (!longestOnly && comma.length >= 3 && comma.length < words.length) {
    const named = mark(headOf(comma));
    if (named) return named;
  }
  for (let k = 3; !longestOnly && k < words.length; k++) {
    if (!SUBORDINATE.has(bare(words[k]))) continue;
    const named = mark(headOf(words.slice(0, k)));
    if (named) return named;
  }
  for (let k = words.length - 1; k >= 1; k--) {
    const named = mark(headOf(words.slice(0, k)));
    if (named) return named;
  }
  return `${words[0].slice(0, FIT)}…`;
}

// One clause's name. A removed token (see cleanText) that is followed by the clause end or a function
// word (a path), or that held a '…', cuts the clause there: the head before it, trailing function words
// backed off whole, + '…'. A head of under 2 content words is `thin`. Any other removal leaves the words as they were.
function clauseName(clause) {
  const words = wordsIn(clause);
  while (MARKS.includes(words[0])) words.shift();
  const isCut = (i) => MARKS.includes(words[i]) && (words[i] === CUT_ELL || i === words.length - 1
    || MARKS.includes(words[i + 1]) || FUNCTION_WORDS.has(bare(words[i + 1])));
  const at = words.findIndex((_, i) => isCut(i));
  const plain = words.filter((w) => !MARKS.includes(w));
  if (at < 0) return { name: cutName(plain), count: plain.length, thin: false };
  const head = words.slice(0, at).filter((w) => !MARKS.includes(w));
  // a head of function words only has nothing to qualify: it drops like a removal first in the clause
  if (!head.some((w) => hasLetter(w) && !FUNCTION_WORDS.has(bare(w)))) return clauseName(words.slice(at + 1).join(' '));
  while (head.length > 1 && FUNCTION_WORDS.has(bare(head.at(-1)))) head.pop();
  const text = head.join(' ').replace(/[,;:]+$/, '');
  const content = head.filter((w) => hasLetter(w) && !FUNCTION_WORDS.has(bare(w))).length;
  return { name: text.length <= FIT ? `${text}…` : cutName(head), count: head.length, thin: content < 2 };
}

// The name of one line: its first clause with words; a one-word label ("PRD:", "Fix:") yields to a
// later clause of 2+, and so does a clause cut thin by a removal.
function lineName(text) {
  const clauses = text.split(CLAUSE_END).map((c) => c.trim())
    .filter((c) => hasLetter(c) && wordsIn(c).some((w) => hasLetter(w) && !TRAIL.has(bare(w))))
    .map(clauseName);
  const clause = clauses.find((c) => c.count >= 2 && !c.thin) ?? clauses.find((c) => c.count >= 2) ?? clauses[0];
  return clause ? clause.name : '';
}

// A name the caller wrote: its first non-blank line, cut only to the longest whole-token head.
export function givenName(text) {
  const line = String(text ?? '').split('\n').find((l) => l.trim()) ?? '';
  return hasLetter(line) ? cutName(wordsIn(line), true) : '';
}

// Lines in order until one gives a name; a line that is scaffolding plus under 3 words ("items 3 and
// repeated rejections") gives way to a later line of 3+ and stays the fallback.
function itemName(source) {
  let thin = '';
  for (const line of String(source ?? '').split('\n')) {
    if (!line.trim()) continue;
    const { text, scaffold } = cleanText(line);
    const name = /^\S+:$/.test(text) ? '' : lineName(text); // "Acceptance:" names nothing
    if (!name) continue;
    if (scaffold && name.split(/\s+/).length < 3) { thin ||= name; continue; }
    return name;
  }
  return thin;
}

export function epicName(request, { requests, title } = {}) {
  const items = Array.isArray(requests)
    ? requests.map((r) => (typeof r === 'string' ? r : r?.request ?? r?.text ?? r?.title ?? '')) : [];
  const sources = typeof title === 'string' && title.trim() ? [title] : items.length ? items : [request];
  const names = sources.map(itemName).filter((n) => hasLetter(n) && !/^[a-z]$/i.test(n)); // a lone letter says nothing
  if (!names.length) return 'untitled work';
  let out = names[0];
  let used = 1;
  for (; used < names.length; used++) {
    const left = names.length - used - 1;
    const next = `${out} · ${names[used]}`;
    if ((next + (left ? ` +${left}` : '')).length > NAME_MAX) break;
    out = next;
  }
  const more = used < names.length ? ` +${names.length - used}` : '';
  return (out + more).length <= NAME_MAX ? out + more : out; // a full-width first name leaves no room for +K
}

export function taskName(task) {
  if (typeof task?.name === 'string' && task.name.trim()) return task.name;
  return epicName(task?.request ?? '', { requests: task?.requests, title: task?.title });
}
