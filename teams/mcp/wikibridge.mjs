// wikibridge.mjs - what the task engine knows about teams-wiki (wiki.mjs): its mode, for tm_status
// and the report. The engine never writes or injects the wiki; workers use the wiki tools themselves.
// Design: _repo/docs/plans/2026-10-07-teams-wiki-memory.md.

import { wikiMode } from './wiki.mjs';

// 'fts5' | 'scan'.
export function mode() {
  try { return wikiMode(); } catch { return 'scan'; }
}
