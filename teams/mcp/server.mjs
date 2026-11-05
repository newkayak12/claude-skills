#!/usr/bin/env node
// teams - the one local stdio MCP server: team_* (broker), tm_* (task manager) and wiki_* tools.
//
//   server.mjs [--root <dir>]            every tool
//   server.mjs --only wiki [--root <dir>]  wiki_* only; loads no engine module (workers' wiki server)
//
// --root is the wiki root; a non-empty TEAMS_WIKI_ROOT beats it. TEAMS_WIKI_OFF=1 hides wiki_*
// (full mode) or every tool (--only wiki), and a wiki_* call answers an error.

import { isEntryPoint } from './pluginroots.mjs';
import { serve } from './stdio.mjs';

const SERVER = { name: 'teams', version: '1.0.0' };
const DEFAULT_PROTOCOL = '2025-06-18';

if (isEntryPoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  const only = argv.indexOf('--only');
  if (only >= 0 && argv[only + 1] !== 'wiki') {
    console.error('usage: server.mjs [--only wiki] [--root <dir>]');
    process.exit(2);
  }
  const wikiOff = process.env.TEAMS_WIKI_OFF === '1';
  const wiki = await import('./wiki.mjs');
  const root = argv.indexOf('--root');
  if (root >= 0 && argv[root + 1]) wiki.setRoot(argv[root + 1]);
  if (process.env.TEAMS_WIKI_ROOT) wiki.setRoot(process.env.TEAMS_WIKI_ROOT); // non-empty env beats --root

  let tools;
  let call;
  if (only >= 0) {
    // wiki.mjs answers `unknown tool` for any name outside its table.
    tools = wikiOff ? [] : wiki.TOOLS;
    call = (toolName, args) => (wikiOff ? Promise.reject(new Error('teams-wiki is off (TEAMS_WIKI_OFF=1)')) : wiki.callTool(toolName, args));
  } else {
    const all = await import('./server-tools.mjs');
    tools = all.toolsFor({ wikiOff });
    call = all.makeCall({ wikiOff });
  }
  serve({ serverInfo: SERVER, protocolVersion: DEFAULT_PROTOCOL, tools, call });
}
