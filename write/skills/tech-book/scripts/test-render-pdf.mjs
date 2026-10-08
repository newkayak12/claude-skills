// node --test write/skills/tech-book/scripts/test-render-pdf.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mdToHtml, chapterFiles, buildHtml, findBrowser, render } from './render-pdf.mjs';

const CH1 = `# 1장 PostgreSQL 첫걸음

## 1.1 데이터베이스 서버

MySQL에서 쓰던 **InnoDB 버퍼 풀**과 \`shared_buffers\`를 비교합니다.

> **MySQL에서는** 버퍼 풀이 데이터 페이지를 캐시합니다.
> **Postgres에서는** shared_buffers가 같은 일을 합니다.
> **이 비유가 깨지는 지점:** Postgres는 OS 페이지 캐시에도 기댑니다.

표 1-1 용어 대응

| MySQL | PostgreSQL |
|---|---|
| InnoDB 버퍼 풀 | shared_buffers |

- 첫째
  - 하위 항목
- 둘째

코드 1-1 테이블 만들기 (PostgreSQL [확인 필요: 버전])

\`\`\`sql
CREATE TABLE t (id int); -- a < b && c
\`\`\`
`;
const CH2 = `# 2장 트랜잭션\n\n1. 원자성\n2. 격리성\n`;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'tech-book-'));
  mkdirSync(join(dir, 'final'));
  writeFileSync(join(dir, 'brief.md'), '# 비전공자를 위한 PostgreSQL\n\nreader: 비전공\n');
  writeFileSync(join(dir, 'toc.md'), '## 1장 첫걸음\ngoal: x\nrequires: none\n\n## 2장 트랜잭션\ngoal: y\nrequires: 1\n');
  writeFileSync(join(dir, 'final', '02.md'), CH2);
  writeFileSync(join(dir, 'final', '01.md'), CH1);
  return dir;
}

test('table, anchor box, nested list, code block, escaping', () => {
  const h = mdToHtml(CH1);
  assert.match(h, /<h1>1장 PostgreSQL 첫걸음<\/h1>/);
  assert.match(h, /<strong>InnoDB 버퍼 풀<\/strong>/);
  assert.match(h, /<code>shared_buffers<\/code>/);
  assert.match(h, /<blockquote><p><strong>MySQL에서는<\/strong>[^]*이 비유가 깨지는 지점:[^]*<\/blockquote>/);
  assert.equal(h.match(/<blockquote>([^]*?)<\/blockquote>/)[1].match(/<p>/g).length, 3, 'one paragraph per box line');
  assert.match(h, /<p class="caption">표 1-1 용어 대응<\/p>/);
  assert.match(h, /<p class="caption">코드 1-1 /);
  assert.match(h, /<table><thead><tr><th>MySQL<\/th><th>PostgreSQL<\/th><\/tr><\/thead><tbody><tr><td>InnoDB 버퍼 풀<\/td>/);
  assert.match(h, /<ul><li>첫째<ul><li>하위 항목<\/li><\/ul><\/li><li>둘째<\/li><\/ul>/);
  assert.match(h, /<pre><code>CREATE TABLE t \(id int\); -- a &lt; b &amp;&amp; c<\/code><\/pre>/);
  assert.match(mdToHtml('1. a\n2. b'), /<ol><li>a<\/li><li>b<\/li><\/ol>/);
  assert.equal(mdToHtml('<script>x</script>'), '<p>&lt;script&gt;x&lt;/script&gt;</p>');
});

test('chapter order follows toc.md, missing chapters reported', () => {
  const dir = fixture();
  const { files, missing } = chapterFiles(dir);
  assert.deepEqual(files.map((f) => f.slice(-5)), ['01.md', '02.md']);
  assert.deepEqual(missing, []);
  writeFileSync(join(dir, 'toc.md'), '## 1장 a\n## 2장 b\n## 3장 c\n');
  assert.deepEqual(chapterFiles(dir).missing, [3]);
});

test('html embeds the bundled fonts by absolute file URL and sets the page', () => {
  const h = buildHtml('제목', [CH2]);
  for (const f of ['NanumGothic-Regular.ttf', 'NanumGothic-Bold.ttf', 'NanumGothicCoding-Regular.ttf']) {
    const m = h.match(new RegExp(`url\\('(file://[^']*${f})'\\)`));
    assert.ok(m, f);
    assert.ok(existsSync(new URL(m[1])), `${f} exists in assets/fonts`);
  }
  assert.match(h, /size: 182mm 257mm/);
  assert.match(h, /font-size: 10\.5pt/);
});

test('CHROME set to a missing path: exit 1 naming CHROME=, book.html still written', () => {
  const dir = fixture();
  assert.equal(findBrowser({ CHROME: '/nonexistent/chrome', PATH: '' }), null);
  const r = render(dir, { CHROME: '/nonexistent/chrome', PATH: '' });
  assert.equal(r.code, 1);
  assert.match(r.msg, /CHROME=/);
  assert.ok(existsSync(join(dir, 'book.html')));
  assert.ok(!existsSync(join(dir, 'book.pdf')));
});

const browser = findBrowser();
test('renders a PDF with NanumGothic and NanumGothicCoding embedded', { skip: browser ? false : 'no Chrome-family browser on this host' }, () => {
  const dir = fixture();
  const r = render(dir);
  assert.equal(r.code, 0, r.msg);
  const pdf = readFileSync(join(dir, 'book.pdf'));
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  const fonts = [...pdf.toString('latin1').matchAll(/\/BaseFont\s*\/([A-Za-z0-9+_-]+)/g)].map((m) => m[1].replace(/^[A-Z]{6}\+/, ''));
  assert.ok(fonts.includes('NanumGothic'), fonts.join(','));
  assert.ok(fonts.includes('NanumGothicBold'), fonts.join(','));
  assert.ok(fonts.includes('NanumGothicCoding'), fonts.join(','));
});
