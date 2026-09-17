import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression guard for teams/graph/harness independence.
//
// These three plugins used to be coupled: teams (then graph-beta) exposed the same
// graph_* MCP tool names as graph, which forced an install-time mutual-exclusion check.
// That check is gone; independence now rests on convention alone. This suite makes a
// future collision (a rename, a copy-pasted tool, an accidental cross-import) fail loudly
// instead of silently reintroducing the old ambiguity.
//
// Everything here is derived from source (regex-parsed .mcp.json + mcp/*.mjs), never a
// hardcoded list of "the current tool names" - the point is to catch drift, not freeze it.

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REAL_PLUGINS = {
  teams: join(REPO_ROOT, 'teams'),
  graph: join(REPO_ROOT, 'graph'),
  harness: join(REPO_ROOT, 'harness'),
};

// ---------- MCP server/tool-name extraction (works on any plugin dir, real or fixture) ----------

// Every tool entry and the SERVER const look like `name: 'x_open'` / `name: "x_open"`.
// The only other place `name:` followed by a quoted string appears in these files is the
// SERVER declaration itself, so we isolate that span and treat every other match as a tool.
function extractServerAndTools(scriptPath) {
  const source = readFileSync(scriptPath, 'utf8');
  const serverMatch = source.match(/const\s+SERVER\s*=\s*\{[^}]*\}/);
  let serverName = null;
  let excludeStart = -1;
  let excludeEnd = -1;
  if (serverMatch) {
    const nm = serverMatch[0].match(/name\s*:\s*['"]([^'"]+)['"]/);
    serverName = nm ? nm[1] : null;
    excludeStart = serverMatch.index;
    excludeEnd = excludeStart + serverMatch[0].length;
  }
  const nameRe = /\bname\s*:\s*['"]([^'"]+)['"]/g;
  const toolNames = [];
  let m;
  while ((m = nameRe.exec(source))) {
    if (m.index >= excludeStart && m.index < excludeEnd) continue;
    toolNames.push(m[1]);
  }
  return { serverName, toolNames };
}

function mcpServersForPlugin(pluginDir) {
  const mcpJsonPath = join(pluginDir, '.mcp.json');
  if (!existsSync(mcpJsonPath)) return [];
  const cfg = JSON.parse(readFileSync(mcpJsonPath, 'utf8'));
  const servers = cfg.mcpServers || {};
  return Object.entries(servers).map(([declaredName, def]) => {
    const args = (def.args || []).map((a) => String(a).replace('${CLAUDE_PLUGIN_ROOT}', pluginDir));
    const scriptArg = args.find((a) => a.endsWith('.mjs')) || args[args.length - 1];
    const scriptPath = resolve(scriptArg);
    const { serverName, toolNames } = extractServerAndTools(scriptPath);
    return { declaredName, serverName: serverName || declaredName, toolNames, scriptPath };
  });
}

function collectPluginSurface(pluginDir) {
  const servers = mcpServersForPlugin(pluginDir);
  return {
    serverNames: servers.map((s) => s.serverName),
    toolNames: servers.flatMap((s) => s.toolNames),
  };
}

function assertPairwiseDisjoint(byPlugin, label) {
  const names = Object.keys(byPlugin);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const [pa, pb] = [names[i], names[j]];
      const overlap = byPlugin[pa].filter((x) => byPlugin[pb].includes(x));
      assert.deepEqual(overlap, [], `${label} collision between "${pa}" and "${pb}": ${JSON.stringify(overlap)}`);
    }
  }
}

// ---------- cross-plugin import walk ----------

function walkMjsFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) out.push(full);
    }
  }
  return out;
}

function importSpecifiers(source) {
  const specs = new Set();
  const patterns = [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source))) specs.add(m[1]);
  }
  return [...specs];
}

// pluginsByDir: { name: absoluteDir }. Flags any relative import from one plugin's .mjs
// files that resolves inside a *different* plugin's directory.
function findCrossPluginImports(pluginsByDir) {
  const violations = [];
  const entries = Object.entries(pluginsByDir);
  for (const [name, dir] of entries) {
    if (!existsSync(dir)) continue;
    for (const file of walkMjsFiles(dir)) {
      const source = readFileSync(file, 'utf8');
      for (const spec of importSpecifiers(source)) {
        if (!spec.startsWith('.')) continue; // bare specifiers (node:fs, packages) are not file-path imports
        const resolved = resolve(dirname(file), spec);
        for (const [otherName, otherDir] of entries) {
          if (otherName === name) continue;
          const otherPrefix = otherDir.endsWith(sep) ? otherDir : otherDir + sep;
          if (resolved === otherDir || resolved.startsWith(otherPrefix)) {
            violations.push({ file, spec, resolved, from: name, into: otherName });
          }
        }
      }
    }
  }
  return violations;
}

// ---------- the actual guards, against the real repo ----------

test('MCP tool names are pairwise disjoint across teams / graph / harness', () => {
  const byPlugin = {};
  for (const [name, dir] of Object.entries(REAL_PLUGINS)) byPlugin[name] = collectPluginSurface(dir).toolNames;
  // Sanity: this must not degenerate into "everything is empty therefore disjoint".
  assert.ok(byPlugin.teams.length > 0, 'expected teams to declare MCP tools');
  assert.ok(byPlugin.graph.length > 0, 'expected graph to declare MCP tools');
  assertPairwiseDisjoint(byPlugin, 'tool name');
});

test('MCP server names are pairwise disjoint across teams / graph / harness', () => {
  const byPlugin = {};
  for (const [name, dir] of Object.entries(REAL_PLUGINS)) byPlugin[name] = collectPluginSurface(dir).serverNames;
  assert.ok(byPlugin.teams.length > 0, 'expected teams to declare MCP servers');
  assert.ok(byPlugin.graph.length > 0, 'expected graph to declare MCP servers');
  assertPairwiseDisjoint(byPlugin, 'server name');
});

test('no .mjs file under teams/, graph/, or harness/ imports a sibling plugin', () => {
  const violations = findCrossPluginImports(REAL_PLUGINS);
  assert.deepEqual(violations, [], violations.map((v) => `${v.from}:${v.file} -> ${v.spec} (into ${v.into})`).join('; '));
});

// ---------- proof the guards actually fail on a real collision ----------
//
// Built entirely under os.tmpdir(); the real plugin sources are never touched. Each proof
// runs the exact same production functions above against a fixture, first with a real
// collision (must throw / must report a violation), then with it fixed (must pass) -
// so the assertions above are known to be load-bearing, not accidentally vacuous.

function makeMcpFixture(dir, serverName, toolNames) {
  mkdirSync(join(dir, 'mcp'), { recursive: true });
  writeFileSync(
    join(dir, '.mcp.json'),
    JSON.stringify({ mcpServers: { [serverName]: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs'] } } }),
  );
  const toolsSrc = toolNames
    .map((n) => `  { name: '${n}', description: 'x', inputSchema: { type: 'object', properties: {} } },`)
    .join('\n');
  const src = `const SERVER = { name: '${serverName}', version: '1.0.0' };\nconst TOOLS = [\n${toolsSrc}\n];\nexport { SERVER, TOOLS };\n`;
  writeFileSync(join(dir, 'mcp', 'server.mjs'), src);
}

test('proof: the tool-name guard fails on a real collision, and passes once fixed', () => {
  const base = mkdtempSync(join(tmpdir(), 'independence-tool-fixture-'));
  try {
    const a = join(base, 'plugin-a');
    const b = join(base, 'plugin-b');
    makeMcpFixture(a, 'a-engineering', ['a_open', 'a_next']);
    makeMcpFixture(b, 'b-engineering', ['b_open', 'a_open']); // collision: a_open reused

    const withCollision = { a: collectPluginSurface(a).toolNames, b: collectPluginSurface(b).toolNames };
    let failureMessage = null;
    assert.throws(() => assertPairwiseDisjoint(withCollision, 'tool name'), (err) => {
      failureMessage = err.message;
      return true;
    });
    assert.match(failureMessage, /tool name collision between "a" and "b"/);
    assert.match(failureMessage, /a_open/);

    makeMcpFixture(b, 'b-engineering', ['b_open', 'b_next']); // fix: no longer shares a name
    const fixed = { a: collectPluginSurface(a).toolNames, b: collectPluginSurface(b).toolNames };
    assert.doesNotThrow(() => assertPairwiseDisjoint(fixed, 'tool name'));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('proof: the server-name guard fails on a real collision, and passes once fixed', () => {
  const base = mkdtempSync(join(tmpdir(), 'independence-server-fixture-'));
  try {
    const a = join(base, 'plugin-a');
    const b = join(base, 'plugin-b');
    makeMcpFixture(a, 'shared-engineering', ['a_open']);
    makeMcpFixture(b, 'shared-engineering', ['b_open']); // collision: same server name

    const withCollision = { a: collectPluginSurface(a).serverNames, b: collectPluginSurface(b).serverNames };
    let failureMessage = null;
    assert.throws(() => assertPairwiseDisjoint(withCollision, 'server name'), (err) => {
      failureMessage = err.message;
      return true;
    });
    assert.match(failureMessage, /server name collision between "a" and "b"/);
    assert.match(failureMessage, /shared-engineering/);

    makeMcpFixture(b, 'b-engineering', ['b_open']); // fix: distinct server name
    const fixed = { a: collectPluginSurface(a).serverNames, b: collectPluginSurface(b).serverNames };
    assert.doesNotThrow(() => assertPairwiseDisjoint(fixed, 'server name'));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('proof: the cross-import guard catches a real cross-plugin import, and passes once fixed', () => {
  const base = mkdtempSync(join(tmpdir(), 'independence-import-fixture-'));
  try {
    const a = join(base, 'plugin-a');
    const b = join(base, 'plugin-b');
    mkdirSync(join(a, 'mcp'), { recursive: true });
    mkdirSync(join(b, 'mcp'), { recursive: true });
    writeFileSync(join(b, 'mcp', 'util.mjs'), 'export const helper = () => 1;\n');
    writeFileSync(join(a, 'mcp', 'broker.mjs'), "import { helper } from '../../plugin-b/mcp/util.mjs';\nhelper();\n");

    const withCrossImport = findCrossPluginImports({ a, b });
    assert.equal(withCrossImport.length, 1);
    assert.equal(withCrossImport[0].from, 'a');
    assert.equal(withCrossImport[0].into, 'b');
    assert.match(withCrossImport[0].spec, /plugin-b/);

    writeFileSync(join(a, 'mcp', 'broker.mjs'), 'const helper = () => 1;\nhelper();\n'); // fix: no cross import
    assert.deepEqual(findCrossPluginImports({ a, b }), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
