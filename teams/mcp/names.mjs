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
