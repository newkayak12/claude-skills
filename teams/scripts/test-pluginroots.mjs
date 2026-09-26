// test-pluginroots.mjs - which plugin directories a child driver or judge session is given.
//
// The bug this covers (2026-09-22): every method table names `plugin:skill`, but the only
// --plugin-dir a spawned session got was the teams plugin itself, so no named skill was ever
// loadable and every node ran on its contract text alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { referencedPlugins, resolvePluginDir, skillPluginDirs, pluginDirArgs, pluginOf, teamsPluginRoot } from '../mcp/pluginroots.mjs';
import { driverArgv, STAGE_SKILLS } from '../mcp/taskmanager.mjs';
import { judgeArgv } from '../mcp/daemon.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));

function plugin(dir) {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), '{"name":"x","version":"0.0.0"}');
  return dir;
}

function devCheckout() {
  const root = mkdtempSync(join(tmpdir(), 'pr-dev-'));
  plugin(join(root, 'teams'));
  plugin(join(root, 'develop'));
  plugin(join(root, 'think'));
  mkdirSync(join(root, 'docs'), { recursive: true }); // not a plugin
  return root;
}

function installed() {
  const root = mkdtempSync(join(tmpdir(), 'pr-inst-'));
  const mkt = join(root, 'cache', 'marketplace');
  plugin(join(mkt, 'teams', '0.17.1'));
  plugin(join(mkt, 'develop', '1.2.0'));
  plugin(join(mkt, 'develop', '1.10.0'));
  plugin(join(mkt, 'develop', '1.9.0'));
  return { root, teamsRoot: join(mkt, 'teams', '0.17.1'), developNewest: join(mkt, 'develop', '1.10.0') };
}

test('pluginOf splits plugin:skill, and ignores anything that is not one', () => {
  assert.equal(pluginOf('develop:clean-code'), 'develop');
  assert.equal(pluginOf('none'), null);
  assert.equal(pluginOf(':leading'), null);
  assert.equal(pluginOf(undefined), null);
});

test('referencedPlugins covers every built-in method table, including the manager stages when handed them', () => {
  const builtin = referencedPlugins();
  for (const name of ['develop', 'think', 'write', 'completion', 'agents']) {
    assert.ok(builtin.includes(name), `${name} is named by a KINDS/mounts table but was not collected: ${builtin}`);
  }
  // pm is unpublished, so naming it could never mount anything; the PRD method is inlined in
  // prompts.mjs's PRD_CONTRACT instead. test-skillrefs.mjs guards the whole class.
  assert.ok(!builtin.includes('pm'), `pm must not be named by any method table: ${builtin}`);
  // cognition used to be manager-only; planning's investigate stage now names
  // cognition:assumption-extractor, so a KINDS table contributes it too.
  assert.ok(builtin.includes('cognition'), `planning's investigate stage names cognition: ${builtin}`);
  const withManager = referencedPlugins([Object.values(STAGE_SKILLS)]);
  assert.ok(withManager.includes('cognition'), `manager stage skills must contribute: ${withManager}`);
});

test('a development checkout resolves a plugin as a sibling of the teams root', () => {
  const root = devCheckout();
  try {
    assert.equal(resolvePluginDir('develop', join(root, 'teams')), join(root, 'develop'));
    assert.equal(resolvePluginDir('docs', join(root, 'teams')), null, 'a directory without plugin.json is not a plugin');
    assert.equal(resolvePluginDir('nope', join(root, 'teams')), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an installed marketplace resolves <plugin>/<newest version>, compared numerically not lexically', () => {
  const { root, teamsRoot, developNewest } = installed();
  try {
    assert.equal(resolvePluginDir('develop', teamsRoot), developNewest, '1.10.0 beats 1.9.0 - a string sort would not');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('skillPluginDirs never repeats the teams root itself and keeps explicit dirs first', () => {
  const root = devCheckout();
  try {
    const dirs = skillPluginDirs({ pluginRoot: join(root, 'teams'), extraDirs: [join(root, 'think'), join(root, 'docs')] });
    assert.equal(dirs[0], join(root, 'think'), 'an explicit dir comes first');
    assert.ok(!dirs.includes(join(root, 'docs')), 'an explicit dir that is not a plugin is dropped');
    assert.ok(!dirs.some((d) => d === join(root, 'teams')), 'the root is already passed by the caller');
    assert.equal(new Set(dirs).size, dirs.length, 'no duplicates');
    assert.ok(dirs.includes(join(root, 'develop')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an explicit null pluginRoot means no extra dirs; with no CLAUDE_PLUGIN_ROOT the root is this plugin\'s own location, not a guess', () => {
  assert.deepEqual(skillPluginDirs({ pluginRoot: null }), []);
  assert.deepEqual(pluginDirArgs({ pluginRoot: null }), []);
  const prev = process.env.CLAUDE_PLUGIN_ROOT;
  const prevDriver = process.env.HARNESS_CHILD_DRIVER;
  delete process.env.CLAUDE_PLUGIN_ROOT;
  delete process.env.HARNESS_CHILD_DRIVER;
  try {
    const own = resolve(HERE, '..');
    assert.equal(teamsPluginRoot(), own);
    // idol-beta-ask1: a driver respawned by a process launched without CLAUDE_PLUGIN_ROOT came up
    // with no teams MCP servers and quit. The teams root is always passed now.
    const argv = driverArgv(null);
    assert.ok(argv.some((a, i) => argv[i - 1] === '--plugin-dir' && a === own), argv.join(' '));
  } finally {
    if (prev !== undefined) process.env.CLAUDE_PLUGIN_ROOT = prev;
    if (prevDriver !== undefined) process.env.HARNESS_CHILD_DRIVER = prevDriver;
  }
});

test('a child driver and a judge are both spawned with the skill plugins, not just the teams root', () => {
  const root = devCheckout();
  const prev = process.env.CLAUDE_PLUGIN_ROOT;
  const prevDriver = process.env.HARNESS_CHILD_DRIVER;
  const prevJudge = process.env.HARNESS_JUDGE_DRIVER;
  delete process.env.HARNESS_CHILD_DRIVER;
  delete process.env.HARNESS_JUDGE_DRIVER;
  process.env.CLAUDE_PLUGIN_ROOT = join(root, 'teams');
  try {
    for (const argv of [driverArgv(null), judgeArgv(null)]) {
      const dirs = argv.filter((a, i) => argv[i - 1] === '--plugin-dir');
      assert.ok(dirs.includes(join(root, 'teams')), 'the teams plugin itself is still passed');
      assert.ok(dirs.includes(join(root, 'develop')), `a named skill's plugin must be mounted: ${dirs}`);
      assert.ok(dirs.includes(join(root, 'think')), `a named skill's plugin must be mounted: ${dirs}`);
    }
    const withExtra = driverArgv({ team: { opts: { plugin_dirs: [join(root, 'think')] } } });
    assert.equal(withExtra.filter((a) => a === join(root, 'think')).length, 1, 'team.json plugin_dirs does not duplicate a found plugin');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_ROOT; else process.env.CLAUDE_PLUGIN_ROOT = prev;
    if (prevDriver !== undefined) process.env.HARNESS_CHILD_DRIVER = prevDriver;
    if (prevJudge !== undefined) process.env.HARNESS_JUDGE_DRIVER = prevJudge;
    rmSync(root, { recursive: true, force: true });
  }
});

test('HARNESS_CHILD_DRIVER still replaces the whole command line, plugin dirs included', () => {
  const prev = process.env.HARNESS_CHILD_DRIVER;
  process.env.HARNESS_CHILD_DRIVER = 'node fake.mjs';
  try {
    assert.deepEqual(driverArgv(null), ['node', 'fake.mjs']);
  } finally {
    if (prev === undefined) delete process.env.HARNESS_CHILD_DRIVER; else process.env.HARNESS_CHILD_DRIVER = prev;
  }
});
