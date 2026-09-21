// Pure claim-verification helpers, split out of score.mjs so they can be unit-tested from
// test-score.mjs without importing score.mjs itself (score.mjs runs its whole scoring pass as a
// top-level side effect of being loaded - it is a script, not a library). Nothing here touches
// the filesystem or spawns a process; score.mjs supplies the tree and the shell runner.

// Only these are safe to re-run unattended: read-only inspection plus the project's own test
// runner and CLI. Anything else is left unverifiable rather than guessed at.
// grep is only safe to re-run when it is actually grep syntax - flags then a quoted pattern -
// not English prose that happens to start with the word "grep" ("grep for each of the five
// export names..."), which a shell would parse as bogus filename arguments and fail on.
// A word boundary alone lets "head/mode/index checks" (a compound English description, not a
// command) through, since "/" is non-word; require actual whitespace (or end of string) right
// after the verb instead.
export const CHECK_ALLOW = [/^node --test\b/, /^node\s+bin\/[\w.\-]+\.mjs\b/, /^npm test\b/, /^cat(\s|$)/, /^ls(\s|$)/, /^grep(\s+-\S+)*\s+['"]/, /^wc(\s|$)/, /^head(\s|$)/];

export const splitCheck = (c) => {
  const arrow = c.indexOf(' -> '); const colon = c.indexOf(': ');
  let idx = -1, len = 0;
  if (arrow !== -1) { idx = arrow; len = 4; }
  if (colon !== -1 && (idx === -1 || colon < idx)) { idx = colon; len = 2; }
  return idx === -1 ? [c, null] : [c.slice(0, idx), c.slice(idx + len)];
};

// "5 tests passed, 0 failed" mentions the word "failed" while claiming success - strip the
// zero-count phrasing before deciding whether the shown text implies a non-zero exit.
// An explicit exit code in the shown text ("exit=1", "exit 2", "exit code: 0") is the claim
// itself and is compared exactly; returns null when the text names none.
export function claimedExit(shown) {
  const m = shown.match(/\bexit(?:\s*code)?\s*[:=]?\s*(\d+)\b/i);
  return m ? +m[1] : null;
}

export function impliesFailure(shown) {
  // Drop file-path-shaped tokens first ("./errors.mjs" contains the standalone word "errors"
  // by the \b rule below, but names a module, not a failure).
  const noPaths = shown.replace(/[\w./-]*\.(?:mjs|js|json|md|txt)\b/gi, '');
  // "0 fail", "# fail 0", "fail: 0", "0 errors" - zero-count phrasing in either order.
  const s = noPaths.toLowerCase()
    .replace(/\b0\s*(fail(ed|s|ures?)?|errors?)\b/g, '')
    .replace(/#?\s*\b(fail(ed|s|ures?)?|errors?)\s*[:=]?\s*0\b/g, '');
  if (/\bfail(ed|s|ures?)?\b/.test(s) || /\berror(s)?\b/.test(s)) return true;
  // Filesystem-not-found phrasing implies a non-zero exit just as plainly as the word "fail" -
  // an `ls`/`cat` check reporting the standard shell/errno wording for a removed or never-
  // created file is claiming the rerun will not find it, i.e. a non-zero exit.
  return /no such file or directory/.test(s) || /\bnot found\b/.test(s) || /\benoent\b/.test(s) || /cannot access/.test(s) || /does not exist/.test(s);
}

// "<good.csv>", "[]", "(no args)": the check names its inputs by description, not by path.
// Running that literally runs a different command than the one claimed.
export const hasPlaceholder = (cmd) => /<[^>]+>|\[\]|\([^)]*\)/.test(cmd);

// cat/sed -n/head/tail/grep-without-"-c" show a file's content; the "shown" half of the check
// is then a description of that content ("...fail-fast throw on first bad row"), not a claim
// about the rerun's outcome. Feeding a content description through impliesFailure would read
// words like "Error"/"throw" that name classes or control flow as if they were failure reports.
// grep -c (a count) is excluded from this - its shown value is a number, handled separately.
export function isContentShowCmd(cmdTrim) {
  if (/^cat(\s|$)/.test(cmdTrim) || /^sed\s+-n\b/.test(cmdTrim) || /^head(\s|$)/.test(cmdTrim) || /^tail(\s|$)/.test(cmdTrim)) return true;
  const grepFlags = cmdTrim.match(/^grep((?:\s+-\S+)*)\s+['"]/);
  return !!grepFlags && !grepFlags[1].split(/\s+/).includes('-c');
}

// "node --test a.mjs / b.mjs / c.mjs -> each exited 0 individually" is several commands joined
// in prose under one "shown" value, not one command. Split on " / " only when every piece after
// the first is a bare path-like token (not prose that happens to contain a slash); the first
// piece keeps the verb ("node --test ") that every split-out command needs. Returns null when
// the shape does not hold - the caller reports "several commands joined in prose" for that.
export function splitSlashCmd(cmdTrim) {
  if (!cmdTrim.includes(' / ')) return null;
  const parts = cmdTrim.split(' / ').map((s) => s.trim());
  if (parts.length < 2) return null;
  const m = parts[0].match(/^(.*\s)([\w./-]+\.(?:mjs|js|json|md|txt))$/);
  if (!m) return null;
  const [, verb, first] = m;
  const PATHLIKE = /^[\w./-]+\.(?:mjs|js|json|md|txt)$/;
  if (!parts.slice(1).every((p) => PATHLIKE.test(p))) return null;
  return [first, ...parts.slice(1)].map((p) => (verb + p).trim());
}

// README shell-example materialization: every fenced block in a document, queued by language
// tag, so a command that names an input file the doc never says to "Save this as" but does show
// under its own heading (e.g. "CSV format" followed by a ```csv block) can still be run for
// real instead of against a file that was never created.
export const EXT_LANG = { csv: 'csv', json: 'json', txt: 'txt' };

export function fencedBlocksByLang(md) {
  const map = {};
  for (const m of md.matchAll(/```(\w+)\n([\s\S]*?)```/g)) {
    const lang = m[1].toLowerCase();
    (map[lang] ||= []).push(m[2]);
  }
  return map;
}

// Bare file-like tokens in a resolved `node <script> ...` example line that do not already
// exist on the judged tree - candidates to materialize from fencedBlocksByLang before the
// example is run. `exists(token)` is injected so this stays filesystem-free and unit-testable.
export function neededInputTokens(cmdLine, exists) {
  return cmdLine.split(/\s+/).slice(2) // drop "node" and the script path
    .filter((tok) => !tok.startsWith('-'))
    .map((tok) => {
      const m = tok.match(/\.([a-zA-Z0-9]+)$/);
      const lang = m && EXT_LANG[m[1].toLowerCase()];
      return lang ? { token: tok, lang } : null;
    })
    .filter(Boolean)
    .filter((n) => !exists(n.token));
}

// ---------- spec coverage: split a case's request into discrete requirement clauses, then
// check each against the delivered tree by keyword/identifier overlap. This is a heuristic, not
// a semantic check - score.mjs reports the uncovered list alongside the count precisely so a
// human can see what the heuristic called missing rather than trusting a bare ratio.
const STOPWORDS = new Set(['this', 'that', 'with', 'from', 'each', 'then', 'when', 'what',
  'into', 'must', 'have', 'does', 'will', 'your', 'they', 'their', 'which', 'where', 'also',
  'such', 'only', 'same', 'both', 'than', 'over', 'under', 'plus', 'every', 'some', 'none',
  'file', 'files', 'user', 'users', 'root']);

// Every request in requests/*.txt is either a lettered list ("(a) ...; (b) ...") naming the
// discrete pieces of work, or (the goal-* cases) a one-line prose goal with no letters at all.
// >=2 letter markers means the lettered shape is real, not a stray "(a)" inside a sentence.
export function parseRequirements(reqText) {
  if (!reqText) return [];
  const text = reqText.trim();
  const letterHits = [...text.matchAll(/\([a-z]\)\s*/g)];
  if (letterHits.length >= 2) {
    return text.split(/\([a-z]\)\s*/).slice(1)
      .map((s) => s.replace(/;\s*$/, '').replace(/\.\s*$/, '').trim())
      .filter(Boolean);
  }
  // Prose fallback: sentence-split, keep only substantive sentences - drops connective filler
  // ("You decide the package split...") that names no checkable requirement of its own.
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim())
    .filter((s) => s.length > 30 && !/^you decide\b/i.test(s));
}

export function requirementTokens(req) {
  const backticked = [...req.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const words = [...new Set((req.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || [])
    .filter((w) => !STOPWORDS.has(w)))];
  return { backticked, words };
}

// corpusLower: a lowercased blob of everything worth searching (tree file paths, README,
// source samples) built by score.mjs, which knows the tree; fileList: the tree's own path list,
// checked case-sensitively for backticked path/identifier tokens (an identifier like `csv.mjs`
// naming a real file is stronger evidence than the same word merely appearing in prose).
export function requirementCovered(req, corpusLower, fileList) {
  const { backticked, words } = requirementTokens(req);
  if (backticked.length) {
    const hits = backticked.filter((t) => fileList.some((f) => f.includes(t)) || corpusLower.includes(t.toLowerCase()));
    if (hits.length >= Math.ceil(backticked.length * 0.6)) return true;
  }
  if (!words.length) return false;
  const hits = words.filter((w) => corpusLower.includes(w));
  const need = Math.min(3, words.length);
  return hits.length >= need;
}

// ---------- majority vote over N independent judge calls. `oks` is the array of already-
// -parsed, already-successful judge responses (a failed/unparseable call is dropped before this
// is called, by the caller) - each is a plain object whose `key` field score.mjs wants voted on.
// N is normally odd (score.mjs defaults to 3) so a vote never ties; if oks.length is even
// (some calls failed) a tie falls to `false`, which is the conservative direction for a
// pass/fail rubric - an undecided sub-goal is not credited.
export function majorityVote(oks, key) {
  if (!oks.length) return { value: null, split: '0/0' };
  const trueCount = oks.filter((o) => !!o[key]).length;
  return { value: trueCount * 2 > oks.length, split: `${trueCount}/${oks.length}` };
}
