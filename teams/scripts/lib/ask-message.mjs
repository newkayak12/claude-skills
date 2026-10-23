// The message an ask travels in between sessions: a line a person can read, then a JSON trailer a
// node parses. Pure - no file is read here.
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
