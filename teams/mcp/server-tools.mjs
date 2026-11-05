// server-tools.mjs - the one tool table and routed call of the teams MCP server (server.mjs).
// No stdin and no entry-point guard: importing this binds nothing, so daemon.mjs reads ALL_TOOLS too.
//
//   team_*  broker-tools.mjs   concurrent; ctx (cancel, progress) reaches the handler
//   tm_*    taskmanager-tools  one serial queue, request order, except tm_wait
//   wiki_*  wiki.mjs           the same queue (one SQLite handle, one lock)
//
// tm_wait is a long poll: it runs outside the serial queue, with ctx.signal, so a cancel stops it
// and it never holds back another call. Every other tm_* and wiki_* ignores ctx. Progress is
// still sent by stdio.mjs for any call that carries a progressToken.

import { BROKER_TOOLS, callBrokerTool } from './broker-tools.mjs';
import { TOOLS as TM_TOOLS, callTool as callTmTool } from './taskmanager-tools.mjs';
import { TOOLS as WIKI_TOOLS, callTool as callWikiTool } from './wiki.mjs';

export const WIKI_OFF_MESSAGE = 'teams-wiki is off (TEAMS_WIKI_OFF=1)';

export const ALL_TOOLS = [...BROKER_TOOLS, ...TM_TOOLS, ...WIKI_TOOLS];

// wikiOff hides wiki_* from the list (a judge must not read or write pages); a call still answers.
export function toolsFor({ wikiOff = false } = {}) {
  return wikiOff ? [...BROKER_TOOLS, ...TM_TOOLS] : ALL_TOOLS;
}

export function makeCall({ wikiOff = false } = {}) {
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };
  return (name, args, ctx) => {
    if (typeof name === 'string') {
      if (name.startsWith('team_')) return callBrokerTool(name, args, ctx);
      if (name === 'tm_wait') return callTmTool(name, args, ctx);
      if (name.startsWith('tm_')) return serial(() => callTmTool(name, args));
      if (name.startsWith('wiki_')) {
        if (wikiOff) return Promise.reject(new Error(WIKI_OFF_MESSAGE));
        return serial(() => callWikiTool(name, args));
      }
    }
    return Promise.reject(new Error(`unknown tool: ${name}`));
  };
}
