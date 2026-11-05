// test-manifest.mjs - the teams plugin is one MCP server: both manifests, the skills' frontmatter,
// the absence of the three old server names, and the single stdin loop.
//
//   node --test teams/scripts/test-manifest.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEAMS = join(HERE, '..');
const ROOT = join(TEAMS, '..');
const MCP = join(TEAMS, 'mcp');
const OLD_NAMES = ['teams-engineering', 'task-manager', 'teams-wiki'];
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

for (const [label, file] of [['claude', '.claude-plugin/plugin.json'], ['codex', '.codex-plugin/plugin.json']]) {
  test(`${label} manifest has exactly one mcpServers entry, teams, pointing at mcp/server.mjs`, () => {
    const servers = json(join(TEAMS, file)).mcpServers;
    assert.deepEqual(Object.keys(servers), ['teams']);
    assert.equal(servers.teams.command, 'node');
    assert.match(String(servers.teams.args[0]), /\/mcp\/server\.mjs$/);
    if (label === 'claude') assert.deepEqual(servers.teams.args.slice(1), ['--root', '${CLAUDE_PROJECT_DIR}']);
  });
}

test('the 12 skills that call the engine require teams', () => {
  const required = [];
  for (const d of readdirSync(join(TEAMS, 'skills'))) {
    const text = readFileSync(join(TEAMS, 'skills', d, 'SKILL.md'), 'utf8');
    const m = text.match(/^compatibility:\n {2}required:\n((?: {4}- .+\n)+)/m);
    if (m && m[1].split('\n').some((l) => l.trim() === '- teams')) required.push(d);
  }
  assert.equal(required.length, 12, `skills requiring teams: ${required.join(', ')}`);
});

test('the marketplace entry of teams names no old server', () => {
  const entry = json(join(ROOT, '.claude-plugin', 'marketplace.json')).plugins.find((p) => p.name === 'teams');
  assert.ok(entry);
  for (const n of OLD_NAMES) assert.ok(!JSON.stringify(entry).includes(n), `marketplace.json teams entry names ${n}`);
});

// Allowed hits, each a reason: CHANGELOGs keep history; the golden fixture and the two tests that
// assert its old labels are frozen evidence; the design-doc file name and the wiki-off reply
// literal are real strings that stay; this file asserts absence.
const ALLOWED_FILE = [/^teams\/CHANGELOG/, /^teams\/scripts\/fixtures\/tools-before\.json$/, /^teams\/scripts\/test-manifest\.mjs$/];
const ALLOWED_LINE = [
  ['teams/scripts/test-capture-tools.mjs', 57],
  ['teams/scripts/test-taskmanager-tools.mjs', 27],
];
const ALLOWED_TEXT = ['2026-10-07-teams-wiki-memory.md', 'teams-wiki is off'];

test('no tracked or new teams/ text file names an old server outside the allowlist', () => {
  const ls = spawnSync('git', ['ls-files', '-co', '--exclude-standard', 'teams', '.claude-plugin'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(ls.status, 0, ls.stderr);
  const hits = [];
  for (const rel of ls.stdout.split('\n').filter(Boolean)) {
    if (ALLOWED_FILE.some((re) => re.test(rel)) || /\.(png|jpg|jpeg|gif|pdf|ico|woff2?)$/i.test(rel)) continue;
    let text;
    try { text = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, i) => {
      if (!OLD_NAMES.some((n) => line.includes(n))) return;
      if (ALLOWED_TEXT.some((t) => line.includes(t))) return;
      if (ALLOWED_LINE.some(([f, n]) => f === rel && n === i + 1)) return;
      hits.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('exactly one stdin data loop in teams/mcp, in stdio.mjs; no other file reads process.stdin', () => {
  const loops = [];
  const readers = [];
  for (const f of readdirSync(MCP).filter((x) => x.endsWith('.mjs'))) {
    const lines = readFileSync(join(MCP, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (/\.on\('data'/.test(line) && !/\.(stdout|stderr)\.on|res\.on\('data'/.test(line)) loops.push(`${f}:${i + 1}`);
      if (f !== 'stdio.mjs' && /process\.stdin|createInterface|for await .*stdin/.test(line)) readers.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(loops.map((l) => l.split(':')[0]), ['stdio.mjs'], `data loops: ${loops.join(', ')}`);
  assert.deepEqual(readers, []);
});

test('server.mjs is the only teams/mcp entry that serves; the old entries are libraries', () => {
  for (const f of ['taskmanager.mjs', 'broker.mjs', 'wiki.mjs']) {
    const text = readFileSync(join(MCP, f), 'utf8');
    assert.ok(!/isEntryPoint|DEFAULT_PROTOCOL|\bSERVER\b|stdin/.test(text.replace(/^\s*\/\/.*$/gm, '')), `${relative(ROOT, join(MCP, f))} still holds a server`);
  }
});
