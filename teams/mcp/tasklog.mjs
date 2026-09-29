// teams/mcp/tasklog.mjs - tm_log: follow one ticket's own log, as readable lines.
//
// Design §8 (`tm_log({key, tail?})`, `/teams:log E-xxx/P2`) and the v0.13.0 plan's Task 6: a
// read-only tail of the log a key already points at - no new storage. Which log:
//
//   E-xxxxxxxx/Pn  the latest dispatch's child.driver.log - the STORY's TeamLeader driver stream
//                  (`claude -p --output-format stream-json`, drivers/<node>.stream.jsonl), the
//                  same field docs.mjs's renderStory already prints as "Driver log".
//   E-xxxxxxxx     the task's own ledger.jsonl (what tm_events returns as JSON) - the EPIC's
//                  "driver" is the daemon, and the ledger is what it and every driver record.
//
// Only the last `tail` lines are read and returned (default 50) - "payload never goes to main",
// log edition: the file is read backwards from its end in chunks, never loaded whole (a driver
// stream runs to tens of MB). `since` is a byte cursor: pass back the previous reply's `cursor`
// to get only what was appended after it (still capped at `tail`). A trailing line still being
// written (no newline yet) is left for the next call, so a cursor never splits a line.
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';

export const LOG_TAIL_DEFAULT = 50;
export const LOG_TAIL_MAX = 500;
const CHUNK = 64 * 1024;
const TEXT_MAX = 240;

// The last `tail` complete lines of `path` after byte offset `since`, plus the cursor to resume
// from. { lines: [], cursor: since, size: 0, missing: true } when the file does not exist yet
// (a driver that has not started, a task with no ledger yet).
export function readLogTail(path, tail = LOG_TAIL_DEFAULT, since = 0) {
  let fd;
  try { fd = openSync(path, 'r'); } catch { return { lines: [], cursor: since, size: 0, missing: true, truncated: false }; }
  try {
    const size = fstatSync(fd).size;
    // A cursor past the end means the file was replaced/truncated since: start over.
    const from = since > 0 && since <= size ? since : 0;
    let pos = size;
    let buf = Buffer.alloc(0);
    let newlines = 0;
    // Read backwards until the region holds tail+1 newlines (the last line may be incomplete,
    // and one more newline marks where the first wanted line starts) or we hit `from`.
    while (pos > from && newlines <= tail + 1) {
      const len = Math.min(CHUNK, pos - from);
      pos -= len;
      const chunk = Buffer.alloc(len);
      readSync(fd, chunk, 0, len, pos);
      for (let i = 0; i < len; i++) if (chunk[i] === 10) newlines++;
      buf = Buffer.concat([chunk, buf]);
    }
    // Drop the incomplete tail line; the cursor stops just past the last newline. Byte indices,
    // not string ones: a chunk boundary can split a multi-byte character.
    const lastNl = buf.lastIndexOf(10);
    const cursor = lastNl >= 0 ? pos + lastNl + 1 : from;
    const complete = lastNl >= 0 ? buf.subarray(0, lastNl).toString('utf8') : '';
    let parts = complete ? complete.split('\n') : [];
    // Reading stopped mid-line unless it reached `from`: the first part is a fragment.
    if (pos > from && parts.length) parts = parts.slice(1);
    parts = parts.filter((l) => l.trim());
    const truncated = parts.length > tail || pos > from;
    return { lines: parts.slice(-tail), cursor, size, missing: false, truncated };
  } finally {
    closeSync(fd);
  }
}

const oneLine = (s, max = TEXT_MAX) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
};

const hhmmss = (ts) => {
  const d = new Date(Number(ts));
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(11, 19) : '--:--:--';
};

// What a tool call was about, in a few words: the one input field that names it.
function toolUseSummary(b) {
  const inp = (b && b.input) || {};
  const key = ['command', 'file_path', 'path', 'pattern', 'url', 'skill', 'description', 'prompt', 'query'].find((k) => typeof inp[k] === 'string' && inp[k]);
  return `${b.name || 'tool'}${key ? ` ${oneLine(inp[key], 160)}` : ''}`;
}

function toolResultText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join(' ');
  return '';
}

// One `claude -p --output-format stream-json` line as one readable line. Never throws; a line
// that is not JSON (a crash message, a non-claude driver's stdout) comes back as itself.
export function renderStreamLine(line) {
  let e;
  try { e = JSON.parse(line); } catch { return oneLine(line); }
  if (!e || typeof e !== 'object') return oneLine(line);
  const content = (e.message && Array.isArray(e.message.content)) ? e.message.content : [];
  switch (e.type) {
    case 'system': {
      // Subagent (Task/Agent) and background events: a third of a real package driver's stream
      // (portfolio-consolidate-8518d5dd), each saying which subagent did what.
      const sub = `subagent ${String(e.task_id || '?').slice(0, 8)}`;
      switch (e.subtype) {
        case 'init': return `init model=${e.model || '?'} session=${String(e.session_id || '?').slice(0, 8)}${e.cwd ? ` cwd=${e.cwd}` : ''}`;
        case 'task_started': return `${sub} started${e.description ? `: ${oneLine(e.description, 160)}` : ''}`;
        case 'task_progress': return `${sub}${e.description ? `: ${oneLine(e.description, 160)}` : ' progress'}`;
        case 'task_updated': return `${sub} ${(e.patch && e.patch.status) || 'updated'}`;
        case 'task_notification': return `${sub} ${e.status || 'notified'}${e.summary ? `: ${oneLine(e.summary, 160)}` : ''}`;
        case 'thinking_tokens': return `thinking ~${Number(e.estimated_tokens) || 0} tokens`;
        case 'background_tasks_changed': {
          const ts = Array.isArray(e.tasks) ? e.tasks : [];
          return `background tasks (${ts.length})${ts.length ? `: ${oneLine(ts.map((t) => (t && t.description) || (t && t.task_id) || '?').join('; '), 160)}` : ''}`;
        }
        default: return `system ${e.subtype || ''}`.trim();
      }
    }
    case 'tool_progress':
      return `tool_progress ${e.tool_name || '?'}${Number.isFinite(e.elapsed_time_seconds) ? ` ${e.elapsed_time_seconds}s` : ''}`;
    case 'assistant': {
      const parts = content.map((b) => {
        if (b.type === 'text') return `says: ${oneLine(b.text)}`;
        if (b.type === 'tool_use') return `-> ${toolUseSummary(b)}`;
        if (b.type === 'thinking') return 'thinking';
        return b.type;
      }).filter(Boolean);
      return `assistant ${parts.join(' | ') || '(empty)'}`;
    }
    case 'user': {
      const parts = content.map((b) => (b.type === 'tool_result'
        ? `<- ${b.is_error ? 'ERROR ' : ''}${oneLine(toolResultText(b.content), 160) || '(no output)'}`
        : (b.type === 'text' ? `user: ${oneLine(b.text)}` : b.type)));
      return parts.join(' | ') || 'user';
    }
    case 'result': {
      const cost = typeof e.total_cost_usd === 'number' ? ` cost=$${e.total_cost_usd.toFixed(4)}` : '';
      const turns = Number.isInteger(e.num_turns) ? ` turns=${e.num_turns}` : '';
      // A usage-limit death arrives as subtype "success" with is_error true; "result success
      // ERROR" read as both. An error names itself first, and its subtype only when it says more.
      const head = e.is_error ? `ERROR${e.subtype && e.subtype !== 'success' ? ` ${e.subtype}` : ''}` : (e.subtype || '');
      return `result ${head}${turns}${cost}${e.result ? `: ${oneLine(e.result)}` : ''}`.replace(/\s+/g, ' ');
    }
    case 'rate_limit_event': {
      const info = e.rate_limit_info || {};
      // When it resets matters only once it is not plain "allowed".
      const resets = info.status && info.status !== 'allowed' && Number.isFinite(info.resetsAt)
        ? ` resets=${new Date(info.resetsAt * 1000).toISOString().slice(11, 16)}Z` : '';
      return `rate_limit ${info.status || ''}${info.rateLimitType ? ` ${info.rateLimitType}` : ''}${resets}`.trim();
    }
    default:
      return oneLine(`${e.type || 'event'}${e.subtype ? ` ${e.subtype}` : ''}`);
  }
}

// One ledger.jsonl entry ({ts, event, ...}) as "HH:MM:SS event k=v k=v".
const LEDGER_FIRST = ['task_id', 'node_id', 'package_id', 'stage', 'state', 'reason'];
export function renderLedgerLine(line) {
  let e;
  try { e = JSON.parse(line); } catch { return oneLine(line); }
  if (!e || typeof e !== 'object') return oneLine(line);
  const keys = Object.keys(e).filter((k) => k !== 'ts' && k !== 'event' && k !== 'task_id');
  keys.sort((a, b) => {
    const ia = LEDGER_FIRST.indexOf(a); const ib = LEDGER_FIRST.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const kv = keys.map((k) => {
    const v = e[k];
    const s = v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `${k}=${oneLine(s, 80)}`;
  });
  return oneLine(`${hhmmss(e.ts)} ${e.event || '?'} ${kv.join(' ')}`, TEXT_MAX + 80);
}

// Clamp a caller's tail to [1, LOG_TAIL_MAX], default LOG_TAIL_DEFAULT.
export function clampTail(t) {
  const n = Number(t);
  if (!Number.isInteger(n) || n <= 0) return LOG_TAIL_DEFAULT;
  return Math.min(n, LOG_TAIL_MAX);
}

// The whole reply for one log file. `render` turns a raw line into a readable one; raw:true
// skips it (the exact NDJSON, for a caller that wants to parse it).
export function logReply(path, { tail, since, raw, render }) {
  const n = clampTail(tail);
  const r = readLogTail(path, n, Number(since) > 0 ? Number(since) : 0);
  return {
    log: path,
    exists: !r.missing,
    count: r.lines.length,
    truncated: r.truncated,
    cursor: r.cursor,
    lines: raw ? r.lines : r.lines.map(render),
  };
}
