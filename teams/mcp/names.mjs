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
import { createHash } from 'node:crypto';

const SLUG_MAX = 32;
const PACKAGE_SLUG_MAX = 24;
const STOPWORDS = new Set(
  'a an the and or of to in for on with by is be this that card backlog user'.split(' '));

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

// Words of `text` in order, each { ascii: boolean, w }, path tokens, stopwords and numbers dropped.
function wordsOf(text) {
  const out = [];
  for (const raw of String(text ?? '').normalize('NFC').toLowerCase().split(/\s+/)) {
    const tok = raw.replace(/^[\p{P}\p{S}]+/u, '').replace(/[\p{P}\p{S}]+$/u, '');
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

// Words joined by '-', cut at a word boundary to <= max (a first word longer than max is hard-cut).
function slugOf(text, max) {
  const words = wordsOf(text);
  const use = words.filter((x) => x.ascii).length >= 2 ? words.filter((x) => x.ascii) : words;
  let slug = '';
  for (const { w } of use) {
    const next = slug ? `${slug}-${w}` : w.slice(0, max);
    if (next.length > max) break;
    slug = next;
  }
  return slug;
}

export function epicSlug(request) {
  return slugOf(request, SLUG_MAX)
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
