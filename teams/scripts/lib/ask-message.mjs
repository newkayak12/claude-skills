// The message an ask travels in between sessions: a line a person can read, then a JSON trailer a
// node parses. Pure - no file is read here. asksToSend() decides, in node, which asks a driver may
// send (never to an unattached or headless opener, never twice).
const PREFIX = '[teams ask] ';
const SEP = ' — answer with tm_submit ';

// notice: { task_id, key, who, question, since, via? } -> text starting with `[teams ask] `
export function askMessage(n) {
  return `${PREFIX}${n.who} asks you: ${n.question}${SEP}${n.key}\n${JSON.stringify(n)}`;
}

// text -> the notice askMessage() was built from; null for anything else
export function parseAskMessage(text) {
  if (typeof text !== 'string' || !text.startsWith(PREFIX)) return null;
  const nl = text.lastIndexOf('\n'); // JSON.stringify never emits a raw newline
  if (nl < 0) return null;
  try {
    const n = JSON.parse(text.slice(nl + 1));
    return n && typeof n === 'object' && typeof n.key === 'string' ? n : null;
  } catch { return null; }
}

// opener: the person's session id; self: this driver's own; asks: notices; sessions: ~/.claude/sessions
// rows {pid, sessionId, kind}; sent: [{ key, since }] already sent; alive: (pid) => boolean
export function asksToSend({ opener, self, asks, sessions, sent = [], alive }) {
  const id = opener && typeof opener === 'object' ? opener.session_id : opener;
  if (!id || id === self) return [];
  const s = (sessions || []).find((x) => x && x.sessionId === id);
  if (!s || s.kind !== 'interactive' || !alive(s.pid)) return [];
  return (asks || []).filter((a) => !sent.some((r) => r.key === a.key && r.since === a.since));
}
