#!/usr/bin/env node
// render-pdf — tech-book stage 7: tmp/books/<slug>/final/NN.md → book.html → book.pdf, typeset in the
// NanumGothic fonts bundled with this skill (assets/fonts, SIL OFL 1.1). Prints with a Chrome-family browser;
// no npm dependency. The markdown converter covers only what references/house-style.md emits.
//
// Usage:  node render-pdf.mjs <book-dir>
// Exit 0 → book.pdf written · 1 → no browser / print failed (book.html kept) · 2 → usage or no chapters
//      · 3 → book.pdf written but partial: a toc chapter has no final/ file, a referenced image is missing,
//        or an image is not on its own line (it prints as a link).
// CHROME=<path> uses that browser only (no search).

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename, delimiter } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = join(SKILL, 'assets', 'fonts');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// inlineImages collects the src of every `![a](p)` outside a code span: one that reaches inline() prints as a link.
export function inline(s, inlineImages = []) {
  return s
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (/^`[^`]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
      for (const m of part.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) inlineImages.push(m[1]);
      return esc(part)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
    })
    .join('');
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function list(items, inlineImages) {
  // items: [{indent, ordered, text}] — one nesting level, as house-style allows
  const tag = items[0].ordered ? 'ol' : 'ul';
  const base = items[0].indent;
  let out = `<${tag}>`;
  for (let i = 0; i < items.length; i++) {
    out += `<li>${inline(items[i].text, inlineImages)}`;
    const sub = [];
    while (i + 1 < items.length && items[i + 1].indent > base) sub.push(items[++i]);
    if (sub.length) out += list(sub, inlineImages);
    out += '</li>';
  }
  return out + `</${tag}>`;
}

const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;

// baseDir: where image paths resolve (final/). missingImages collects referenced images that do not exist;
// inlineImages collects images not on their own line (IMAGE did not match, so they print as links).
export function mdToHtml(md, baseDir = '.', missingImages = [], inlineImages = []) {
  const inl = (t) => inline(t, inlineImages);
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (IMAGE.test(line)) {
      const [, alt, src] = line.match(IMAGE);
      const file = resolve(baseDir, src);
      if (!existsSync(file)) missingImages.push(src);
      // the `그림 N-M` caption paragraph below goes inside the figure, so a page break cannot split them
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const cap = [];
      if (/^그림 \d+-\d+/.test(lines[j] || ''))
        for (; j < lines.length && lines[j].trim() !== '' && !/^(```|#{1,6}\s|>|\s*\|)/.test(lines[j]) && !LIST.test(lines[j]) && !IMAGE.test(lines[j]); j++)
          cap.push(lines[j].trim());
      const figcaption = cap.length ? `<figcaption class="caption">${inl(cap.join(' '))}</figcaption>` : '';
      out.push(`<figure><img src="${pathToFileURL(file).href}" alt="${esc(alt)}">${figcaption}</figure>`);
      i = cap.length ? j : i + 1;
    } else if (/^```/.test(line)) {
      const body = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
    } else if (/^#{1,6}\s/.test(line)) {
      const [, hashes, text] = line.match(/^(#{1,6})\s+(.*)$/);
      out.push(`<h${hashes.length}>${inl(text.trim())}</h${hashes.length}>`);
      i++;
    } else if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) rows.push(cells(lines[i]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inl(c)}</th>`).join('')}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${r.map((c) => `<td>${inl(c)}</td>`).join('')}</tr>`).join('') +
          '</tbody></table>',
      );
    } else if (/^>/.test(line)) {
      const body = [];
      for (; i < lines.length && /^>/.test(lines[i]); i++) body.push(lines[i].replace(/^>\s?/, ''));
      // house-style boxes are one item per line (MySQL에서는 / Postgres에서는 / 깨지는 지점) — keep the lines apart
      out.push(`<blockquote>${mdToHtml(body.join('\n\n'), baseDir, missingImages, inlineImages)}</blockquote>`);
    } else if (LIST.test(line)) {
      const items = [];
      for (; i < lines.length && LIST.test(lines[i]); i++) {
        const [, ws, marker, text] = lines[i].match(LIST);
        items.push({ indent: ws.length, ordered: /\d/.test(marker), text });
      }
      out.push(list(items, inlineImages));
    } else if (line.trim() === '') {
      i++;
    } else {
      const para = [];
      for (; i < lines.length && lines[i].trim() !== '' && !/^(```|#{1,6}\s|>|\s*\|)/.test(lines[i]) && !LIST.test(lines[i]) && !IMAGE.test(lines[i]); i++)
        para.push(lines[i].trim());
      const text = para.join(' ');
      out.push(/^(그림|표|코드) \d+-\d+/.test(text) ? `<p class="caption">${inl(text)}</p>` : `<p>${inl(text)}</p>`);
    }
  }
  return out.join('\n');
}

// Chapter order comes from toc.md (`## N장`); without a toc, final/*.md sorted by name.
export function chapterFiles(bookDir) {
  const finalDir = join(bookDir, 'final');
  const have = existsSync(finalDir) ? readdirSync(finalDir).filter((f) => /\.md$/.test(f)).sort() : [];
  const tocPath = join(bookDir, 'toc.md');
  if (!existsSync(tocPath)) return { files: have.map((f) => join(finalDir, f)), missing: [] };
  const nums = [...readFileSync(tocPath, 'utf8').matchAll(/^##\s*(\d+)장/gm)].map((m) => Number(m[1]));
  const files = [];
  const missing = [];
  for (const n of nums) {
    const f = have.find((name) => Number(name.match(/^(\d+)/)?.[1]) === n);
    if (f) files.push(join(finalDir, f));
    else missing.push(n);
  }
  return { files, missing };
}

export function buildHtml(title, chaptersMd, baseDir = '.', missingImages = [], inlineImages = []) {
  const font = (file) => pathToFileURL(join(FONTS, file)).href;
  const css = `
@font-face { font-family: 'NanumGothic'; font-weight: 400; src: url('${font('NanumGothic-Regular.ttf')}'); }
@font-face { font-family: 'NanumGothic'; font-weight: 700; src: url('${font('NanumGothic-Bold.ttf')}'); }
@font-face { font-family: 'NanumGothicCoding'; src: url('${font('NanumGothicCoding-Regular.ttf')}'); }
@page { size: 182mm 257mm; margin: 22mm 18mm 24mm; @bottom-center { content: counter(page); font: 9pt 'NanumGothic'; } }
html { font-family: 'NanumGothic', sans-serif; font-size: 10.5pt; line-height: 1.7; color: #1a1a1a; word-break: keep-all; }
h1 { font-size: 22pt; line-height: 1.3; margin: 0 0 14mm; }
h2 { font-size: 15pt; margin: 9mm 0 3mm; break-after: avoid; }
h3 { font-size: 12pt; margin: 6mm 0 2mm; break-after: avoid; }
p { margin: 0 0 3mm; }
.caption { font-size: 9pt; font-weight: 700; color: #444; margin: 4mm 0 1.5mm; break-after: avoid; }
.chapter { break-before: page; }
.cover { height: 200mm; display: flex; align-items: center; } .cover h1 { font-size: 28pt; }
code, pre { font-family: 'NanumGothicCoding', monospace; font-size: 9.5pt; }
code { background: #f2f2f2; padding: 0 1mm; border-radius: 1mm; }
pre { background: #f6f6f6; border: 0.3mm solid #ddd; padding: 3mm 4mm; line-height: 1.5; white-space: pre-wrap; break-inside: avoid; }
pre code { background: none; padding: 0; }
blockquote { margin: 4mm 0; padding: 3mm 4mm; border-left: 1mm solid #3d6fb4; background: #f3f6fb; break-inside: avoid; }
blockquote p { margin: 0 0 1.5mm; } blockquote p:last-child { margin: 0; }
table { border-collapse: collapse; width: 100%; margin: 3mm 0 5mm; font-size: 9.5pt; break-inside: avoid; }
th, td { border: 0.3mm solid #ccc; padding: 1.5mm 2.5mm; text-align: left; vertical-align: top; }
th { background: #eef0f3; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; } li { margin: 0.5mm 0; }
figure { margin: 4mm 0 0; text-align: center; break-inside: avoid; } img { max-width: 100%; }
figcaption.caption { text-align: left; }
a { color: inherit; text-decoration: none; }`;
  const body = chaptersMd.map((md) => `<section class="chapter">\n${mdToHtml(md, baseDir, missingImages, inlineImages)}\n</section>`).join('\n');
  return `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head>\n<body>\n<section class="cover"><h1>${esc(title)}</h1></section>\n${body}\n</body></html>\n`;
}

function findIn(dir, names, depth) {
  if (depth < 0 || !existsSync(dir)) return null;
  for (const e of readdirSync(dir).sort().reverse()) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isFile() && names.includes(e)) return p;
    if (st.isDirectory()) { const hit = findIn(p, names, depth - 1); if (hit) return hit; }
  }
  return null;
}

// CHROME set → that path only. Otherwise: macOS app bundles, PATH, then Playwright's browser cache.
export function findBrowser(env = process.env) {
  if (env.CHROME) return existsSync(env.CHROME) ? env.CHROME : null;
  const home = homedir();
  const apps = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Chromium.app/Contents/MacOS/Chromium', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  for (const root of ['/Applications', join(home, 'Applications')])
    for (const a of apps) if (existsSync(join(root, a))) return join(root, a);
  for (const dir of (env.PATH || '').split(delimiter))
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'])
      if (dir && existsSync(join(dir, n))) return join(dir, n);
  for (const cache of [join(home, '.cache', 'ms-playwright'), join(home, 'Library', 'Caches', 'ms-playwright')]) {
    const hit = findIn(cache, ['headless_shell', 'chrome-headless-shell', 'chrome', 'Chromium'], 4);
    if (hit) return hit;
  }
  return null;
}

export function render(bookDir, env = process.env) {
  const dir = resolve(bookDir);
  const { files, missing } = chapterFiles(dir);
  if (files.length === 0) return { code: 2, msg: `no chapters in ${join(dir, 'final')}` };
  const brief = join(dir, 'brief.md');
  const title = (existsSync(brief) && readFileSync(brief, 'utf8').match(/^#\s+(.+)$/m)?.[1].trim()) || basename(dir);
  const html = join(dir, 'book.html');
  const missingImages = [];
  const inlineImages = [];
  writeFileSync(html, buildHtml(title, files.map((f) => readFileSync(f, 'utf8')), join(dir, 'final'), missingImages, inlineImages));
  const warn =
    (missing.length ? `\nmissing final/ for chapters: ${missing.join(', ')}` : '') +
    (missingImages.length ? `\nmissing images: ${missingImages.join(', ')}` : '') +
    (inlineImages.length ? `\nimages not on their own line (print as links): ${inlineImages.join(', ')}` : '');
  const browser = findBrowser(env);
  if (!browser)
    return { code: 1, msg: `no Chrome-family browser found — set CHROME=<path to Chrome/Chromium/Edge>. book.html written: ${html}${warn}` };
  const pdf = join(dir, 'book.pdf');
  rmSync(pdf, { force: true }); // a stale book.pdf must not read as success
  const r = spawnSync(browser, ['--headless', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
    '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, pathToFileURL(html).href], { encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0 || !existsSync(pdf))
    return { code: 1, msg: `print failed (${browser}): ${(r.stderr || r.error?.message || '').trim().slice(-400)}${warn}` };
  return { code: warn ? 3 : 0, msg: `book.pdf: ${pdf} (${files.length} chapters, ${browser})${warn ? ' — PARTIAL' : ''}${warn}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) {
    process.stderr.write('usage: node render-pdf.mjs <book-dir>\n');
    process.exit(2);
  }
  const { code, msg } = render(process.argv[2]);
  (code === 0 || code === 3 ? process.stdout : process.stderr).write(msg + '\n');
  process.exit(code);
}
