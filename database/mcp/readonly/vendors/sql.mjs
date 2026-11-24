// Shared statement handling for every vendor: a dialect-aware scanner, the read-only statement check,
// and the personal-data column rule. Each vendor module supplies its dialect and rules.
import { piiMatcher } from '../config.mjs';

// Dialects differ in comments, string quoting and what "..." means.
//   mysql:    # and "-- " comments, /*! and /*M! run their content, '…' and "…" strings with \ escapes,
//             `…` identifiers
//   postgres: -- and nested /* */ comments, '…' strings ('' doubles, \ escapes only in E'…'),
//             $tag$…$tag$ strings, "…" identifiers
//   oracle:   -- and /* */ comments, '…' and q'[…]' strings, "…" identifiers
export const DIALECTS = {
  mysql: { hash: true, dashSpace: true, execComment: true, backslash: true, dqString: true, backtick: true },
  postgres: { nested: true, eString: true, dollar: true },
  oracle: { qQuote: true },
};

const CLOSE = { '[': ']', '{': '}', '(': ')', '<': '>' };

// One pass. Returns { clean, masked, plain } or { error }:
//   clean:  comments replaced by a space, literals intact (what gets executed)
//   masked: string contents blanked, and mysql `identifiers` blanked (what the rules inspect)
//   plain:  string contents blanked, identifiers kept (what the personal-data rule reads)
export function scan(sql, d = DIALECTS.mysql) {
  let clean = '';
  let masked = '';
  let plain = '';
  const put = (c, m = c, p = m) => ((clean += c), (masked += m), (plain += p));
  let i = 0;
  const n = sql.length;
  const wordBefore = (k) => k > 0 && /[\w$]/.test(sql[k - 1]);
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '/' && next === '*') {
      const third = sql[i + 2];
      if (d.execComment && (third === '!' || (third === 'M' && sql[i + 3] === '!')))
        return { error: 'executable comment /*! ... */ is not allowed (the server runs its content)' };
      if (third === '+') return { error: 'optimizer hint /*+ ... */ is not allowed (can change session settings); resend the same query without the /*+ ... */ hint' };
      let depth = 1;
      let j = i + 2;
      while (depth > 0) {
        if (j >= n) return { error: 'unterminated /* comment' };
        if (d.nested && sql[j] === '/' && sql[j + 1] === '*') (depth++, (j += 2));
        else if (sql[j] === '*' && sql[j + 1] === '/') (depth--, (j += 2));
        else j++;
      }
      put(' ');
      i = j;
    } else if ((d.hash && c === '#') || (c === '-' && next === '-' && (!d.dashSpace || i + 2 >= n || /\s/.test(sql[i + 2])))) {
      const end = sql.indexOf('\n', i);
      put(' ');
      i = end < 0 ? n : end + 1;
    } else if (d.dollar && c === '$' && !wordBefore(i) && /^\$([A-Za-z_][\w]*)?\$/.test(sql.slice(i))) {
      const tag = sql.slice(i).match(/^\$([A-Za-z_][\w]*)?\$/)[0];
      const end = sql.indexOf(tag, i + tag.length);
      if (end < 0) return { error: `unterminated ${tag} literal` };
      put(sql.slice(i, end + tag.length), "''");
      i = end + tag.length;
    } else if (d.qQuote && (c === 'q' || c === 'Q') && next === "'" && !wordBefore(i) && i + 2 < n) {
      const open = sql[i + 2];
      const close = CLOSE[open] ?? open;
      const end = sql.indexOf(close + "'", i + 3);
      if (end < 0) return { error: "unterminated q'…' literal" };
      put(sql.slice(i, end + 2), "''");
      i = end + 2;
    } else if (c === "'" || (c === '"' && d.dqString) || (c === '`' && d.backtick) || c === '"') {
      const isString = c === "'" || (c === '"' && d.dqString);
      const escapes = isString && (d.backslash || (d.eString && /[eE]/.test(sql[i - 1] ?? '') && !wordBefore(i - 1)));
      let j = i + 1;
      for (;;) {
        if (j >= n) return { error: `unterminated ${c} literal` };
        if (escapes && sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      const lit = sql.slice(i, j + 1);
      if (isString) put(lit, c + c);
      else if (c === '`') put(lit, '``', lit);
      else put(lit); // a "quoted identifier" stays visible to the rules
      i = j + 1;
    } else {
      put(c);
      i++;
    }
  }
  return { clean: clean.trim(), masked: masked.trim(), plain: plain.trim() };
}

// rules: { first: Set, dmlChecked: Set, dml: [[re, name]], forbidden: [[re, name]] on masked text,
//          forbiddenAnywhere: [[re, name]] on the text with string contents included (names a string
//          could smuggle into a function that runs SQL text) }
export function checkStatement(sql, d, rules) {
  if (typeof sql !== 'string') return reject('input', 'sql must be a string');
  const s = scan(sql, d);
  if (s.error) return reject('comment/literal', s.error);
  let { clean, masked } = s;
  if (masked.endsWith(';')) {
    masked = masked.slice(0, -1).trim();
    clean = clean.replace(/;\s*$/, '').trim();
  }
  if (!masked) return reject('empty', 'empty statement');
  if (masked.includes(';')) return reject('single-statement', 'only one statement is allowed (found ; inside)');
  const upper = masked.toUpperCase();
  const first = (upper.match(/^[A-Z]+/) || [''])[0];
  if (!rules.first.has(first)) {
    return reject('whitelist', `first keyword "${first || masked.slice(0, 10)}" is not allowed; allowed: ${[...rules.first].join(', ')}`);
  }
  if (rules.dmlChecked.has(first)) {
    for (const [re, name] of rules.dml) if (re.test(upper)) return reject('dml', `${name} inside ${first} is not allowed`);
  }
  for (const [re, name] of rules.forbidden) if (re.test(upper)) return reject('forbidden', `${name} is not allowed`);
  const anywhere = clean.toUpperCase();
  for (const [re, name] of rules.forbiddenAnywhere ?? []) if (re.test(anywhere)) return reject('forbidden', `${name} is not allowed`);
  return { ok: true, sql: clean };
}

const reject = (rule, message) => ({ ok: false, rule, message });

// The select-list expressions of a statement with exactly one SELECT, no `*` and no @variables, or
// null. Only then does a computed column's own expression tell everything it reads: a subquery, CTE
// or derived table could hand a personal column over under a harmless alias.
export function selectList(sql, d = DIALECTS.mysql) {
  const scanned = scan(String(sql), d);
  if (scanned.error) return null;
  const s = scanned.plain;
  const upper = s.toUpperCase();
  if ((upper.match(/\bSELECT\b/g) || []).length !== 1 || s.includes('@')) return null;
  const start = upper.match(/^\s*SELECT\b/);
  if (!start) return null;
  const exprs = [];
  let depth = 0;
  let from = start[0].length;
  let i = from;
  const END = /^(FROM|WHERE|GROUP|HAVING|ORDER|LIMIT|UNION|WINDOW|INTO|FOR|LOCK|FETCH|OFFSET)\b/;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && c === ',') {
      exprs.push(s.slice(from, i));
      from = i + 1;
    } else if (depth === 0 && !/[\w$`"]/.test(s[i - 1]) && END.test(upper.slice(i))) break;
  }
  exprs.push(s.slice(from, i));
  // `*` or t.* expands to columns the list does not name.
  if (exprs.some((e) => /(^|\.)\*$/.test(e.replace(/\s+/g, '')))) return null;
  return exprs.map((e) => e.trim());
}

// Result columns that carry personal data. fields: [{ name, orgName }] — orgName is the source column
// when the driver reports one ('' for a computed column, and for every column on Oracle). A source
// column is matched by its name, so an alias does not help; a computed column is hidden when its own
// expression or its name mentions one. When the expressions cannot be told apart (subquery, CTE, `*`,
// @variables), any personal column named in the statement hides every computed column — except in
// SHOW and DESCRIBE, whose result is metadata (SHOW CREATE TABLE address names a table, not a column).
// A source name is split into words too: a view column can be named get_decrypt(a.ord_tel).
const METADATA = /^\s*(SHOW|DESCRIBE|DESC)\b/i;
export function piiColumns(fields, sql, isPii = piiMatcher(), d = DIALECTS.mysql) {
  if (!isPii) return [];
  const words = (s) => String(s).split(/[^A-Za-z0-9_$]+/).filter(Boolean);
  const list = selectList(sql, d);
  const exprs = list && list.length === fields.length ? list : null;
  const sqlHasPii = !METADATA.test(sql) && words(sql).some(isPii);
  return fields
    .filter((f, i) => {
      if (f.orgName) return words(f.orgName).some(isPii);
      if (words(f.name).some(isPii)) return true;
      return exprs ? words(exprs[i]).some(isPii) : sqlHasPii;
    })
    .map((f) => f.name);
}

// Drops hidden columns from a result and returns the shared result shape.
export function shape({ fields, rows, truncated, started, sql, isPii, dialect }) {
  const hidden = fields ? piiColumns(fields, sql, isPii, dialect) : [];
  for (const r of rows) for (const c of hidden) delete r[c];
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    columns: fields ? fields.map((f) => f.name).filter((c) => !hidden.includes(c)) : [],
    ...(hidden.length ? { hidden } : {}),
    rows,
    rowCount: rows.length,
    truncated,
    elapsedMs: Math.round(elapsedMs * 10) / 10,
  };
}

export const TABLE_NAME = /^[A-Za-z0-9_$]{1,64}(\.[A-Za-z0-9_$]{1,64})?$/;
