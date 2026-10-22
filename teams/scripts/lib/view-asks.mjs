// asksFor() turns the floor's task rows into the questions waiting on ONE interactive session: the
// notices the teams band shows as `⚑ P2 asks you: ...`. Pure - no file is read here; the rows come
// from floorTasks() (their waiting cards via summarize) and `received` from the mod's own record of what a driver already sent it.
// Addressed by session id alone: a headless opener's id never equals the id a ticking interactive
// mod passes, so no entrypoint check is needed.
import { summarize } from './view-summary.mjs';

const CLIP = 120;

const clip = (t) => (t.length > CLIP ? `${t.slice(0, CLIP - 1)}…` : t);

// entries: { m, live } rows; received: [{ key, session }] -> [{ task_id, key, who, question, since, via }], newest first
export function asksFor(entries, sessionId, received = []) {
  if (!sessionId) return [];
  const out = [];
  for (const { m, live } of entries || []) {
    if (!live || !m || !m.opener || m.opener.session_id !== sessionId) continue;
    const cards = summarize(m).you.cards;
    for (const c of cards) {
      const via = received.some((r) => r && r.key === c.key && r.session === sessionId) ? 'send' : 'poll';
      out.push({ task_id: m.task_id, key: c.key, who: c.who, question: clip(c.question || c.title || ''), since: c.since, via });
    }
  }
  return out.sort((a, b) => (b.since || 0) - (a.since || 0));
}

