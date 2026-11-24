// What a worker is doing, from the tail of its stream, as one key and plain-word vars (the teams pane
// maps the key to a localized phrase; STRINGS holds one entry per ACTIVITY_KEYS value). Pure: view-floor-fs.mjs
// reads the tail and hands the parsed records in. A var never carries a raw token (a tool name, a stage
// key, `tool_progress`, `mcp__...`): a value that would is replaced by a generic word.

export const ACTIVITY_KEYS = ['actJudging', 'actTesting', 'actEditing', 'actReading', 'actSubagent', 'actEngine', 'actRunning', 'actThinking', 'actStage'];

const RAW = new Set(['Bash', 'Edit', 'Write', 'Read', 'Grep', 'Glob', 'Agent', 'Task', 'NotebookEdit', 'plan', 'build', 'integrate', 'qa', 'gate', 'report']);
const isRaw = (s) => /tool_progress|mcp__/.test(s) || RAW.has(s);
const safe = (v, fallback) => { const s = String(v == null ? '' : v).trim(); return s && !isRaw(s) ? s : fallback; };
const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';

// A node's stage as a plain word for a worker with nothing to say yet.
const STAGE_WORD = {
  plan: 'planning', setgoal: 'setting the goal', critique: 'critiquing the plan', implement: 'implementing', test: 'testing',
  draft: 'drafting', review: 'reviewing', integrate: 'merging', gate: 'judging', accept: 'judging', ask: 'waiting for an answer',
};

// What each engine tool does, in a plain verb.
const ENGINE_VERB = {
  team_run: 'running the next step', team_next: 'fetching the next step', team_submit: 'submitting the result', team_status: 'checking progress',
  tm_status: 'checking progress', tm_read: 'reading the brief', tm_post: 'posting a note', tm_ask: 'asking a question', tm_open: 'opening a task',
};

const TEST_CMD = /\b(node\s+--test|claude\s+plugin\s+test|npm\s+(?:run\s+)?test|pnpm\s+test|yarn\s+test|pytest|python3?\s+-m\s+pytest|python3?\s+test_\S+|cargo\s+test|go\s+test)\b/;

// "teams suite" from the directory a command cd's into, else the first path it names, else "the test suite".
function suiteOf(cmd) {
  const cd = cmd.match(/\bcd\s+(\S+)/);
  let name = cd ? base(cd[1]) : '';
  if (!name || name === '.') {
    const path = (cmd.match(/(?:^|\s)((?:\.\/)?[\w.-]+\/[\w./-]+)/) || [])[1];
    name = path ? path.replace(/^\.\//, '').split('/')[0] : '';
  }
  return safe(name, '') && name !== '.' ? `${name} suite` : 'the test suite';
}

// One tool call (or the tool a tool_progress reports on) as { doing_key, doing_vars }.
function ofTool(name, input) {
  const inp = input || {};
  const n = String(name || '');
  if (n === 'Bash') {
    const cmd = typeof inp.command === 'string' ? inp.command : '';
    return TEST_CMD.test(cmd) ? { doing_key: 'actTesting', doing_vars: { suite: suiteOf(cmd) } } : { doing_key: 'actRunning', doing_vars: {} };
  }
  if (n === 'Edit' || n === 'Write' || n === 'NotebookEdit') return { doing_key: 'actEditing', doing_vars: { file: safe(base(inp.file_path || inp.notebook_path), 'a file') } };
  if (n === 'Read' || n === 'Grep' || n === 'Glob') return { doing_key: 'actReading', doing_vars: { what: safe(base(inp.file_path) || inp.pattern || base(inp.path), 'the code') } };
  if (n === 'Agent' || n === 'Task') return { doing_key: 'actSubagent', doing_vars: { kind: safe(inp.subagent_type, 'helper') } };
  if (n.startsWith('mcp__')) {
    const tool = n.split('__').pop();
    if (/^(team|tm)_/.test(tool)) return { doing_key: 'actEngine', doing_vars: { verb: ENGINE_VERB[tool] || 'talking to the engine' } };
  }
  return { doing_key: 'actRunning', doing_vars: {} };
}

// records: the parsed lines of a stream's tail, oldest first. stage: the node's stage (gate and accept
// are judging whatever the last tool was). opts.id: the card the worker holds, for the judging phrase.
export function activityOf(records, stage, { id = '' } = {}) {
  const st = String(stage || '');
  if (st === 'gate' || st === 'accept') {
    const who = safe(id, '');
    const what = who ? `${who}'s ${st === 'gate' ? 'gate' : 'acceptance'}` : `the ${st === 'gate' ? 'gate' : 'acceptance'}`;
    return { doing_key: 'actJudging', doing_vars: { what } };
  }
  const list = Array.isArray(records) ? records : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'tool_progress') {
      const call = list.slice(0, i).reverse().map((r) => (r && r.message && Array.isArray(r.message.content) ? r.message.content : []).find((b) => b && b.type === 'tool_use' && b.id === e.tool_use_id)).find(Boolean);
      return ofTool(call ? call.name : e.tool_name, call ? call.input : null);
    }
    if (e.type !== 'assistant') continue;
    const blocks = e.message && Array.isArray(e.message.content) ? e.message.content : [];
    const last = blocks[blocks.length - 1];
    if (!last) continue;
    if (last.type === 'tool_use') return ofTool(last.name, last.input);
    if (last.type === 'text' || last.type === 'thinking') return { doing_key: 'actThinking', doing_vars: {} };
  }
  return { doing_key: 'actStage', doing_vars: { stage: STAGE_WORD[st] || 'working' } };
}
