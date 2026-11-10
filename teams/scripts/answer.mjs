#!/usr/bin/env node
// answer.mjs - the engine side of the teams pane's answer mode (the pane runs it through $.process.run and
// writes no task file). It reads the cards waiting on a person and submits an answer through the code tm_submit
// runs (toolSubmit), so an answer from the pane and one from tm_submit are the same write.
//
//   node answer.mjs --card --task <id> [--story <Pn> | --key <card key>] [--tasks-dir <dir>]
//       prints { ok: true, task_id, cards: [{ key, node_id, title, story_key, ask_id, since, questions: [{ question, options }] }] }
//       the waiting ASK cards only (an ask card's own key is what tm_submit needs; `you.cards[].key` is the STORY's);
//       { ok: false, reason } when none matches
//   node answer.mjs --answer --task <id> --key <ask card key> --decisions '<[{question, chose}]>' [--tasks-dir <dir>]
//       prints { ok: true, key, node_id, state } once the engine accepted it, or { ok: false, reason } with the
//       engine's own refusal text; the card stays as it was on a refusal
//
// One JSON line on stdout, exit 0 for either answer (the pane reads `ok`); exit 2 only for a usage error.
// toolSubmit is imported from mcp/taskmanager-claims.mjs: loading it opens no server and starts no daemon.

function arg(argv, name) { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; }

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const storyOfKey = (k) => (k ? String(k).split('/')[1] : undefined);

// One waiting ask card as the pane draws it: its own key, the questions with their options.
function cardView(c) {
  return {
    key: c.key, node_id: c.node_id, title: c.title || '', story_key: c.story_key || null, ask_id: c.ask_id || null, since: c.since || null,
    questions: (c.questions || []).map((q) => ({ question: String((q && (q.question || q.unknown)) || ''), options: Array.isArray(q && q.options) ? q.options.map(String) : [] })).filter((q) => q.question),
  };
}

async function main(argv) {
  const tasksDir = arg(argv, '--tasks-dir');
  if (tasksDir) process.env.HARNESS_TASKS_DIR = tasksDir;
  const task = arg(argv, '--task');
  const key = arg(argv, '--key');
  if (!task || (!argv.includes('--card') && !argv.includes('--answer'))) {
    process.stderr.write('usage: node answer.mjs --card --task <id> [--story <Pn> | --key <card key>] | --answer --task <id> --key <card key> --decisions <json>\n');
    process.exitCode = 2;
    return;
  }

  if (argv.includes('--card')) {
    const { toolInbox } = await import('../mcp/taskmanager-handlers.mjs');
    const story = arg(argv, '--story');
    let cards = [];
    try { cards = toolInbox({ task_id: task }).cards.filter((c) => c.stage === 'ask'); } catch (e) { return out({ ok: false, reason: String((e && e.message) || e) }); }
    const mine = cards.filter((c) => (key ? c.key === key : story ? (storyOfKey(c.key) === story || storyOfKey(c.story_key) === story) : true));
    if (!mine.length) return out({ ok: false, reason: `no ask card waiting${key ? ` as ${key}` : story ? ` for ${story}` : ''} in ${task}` });
    return out({ ok: true, task_id: task, cards: mine.map(cardView) });
  }

  if (!key) { process.stderr.write('usage: --answer needs --key <ask card key>\n'); process.exitCode = 2; return; }
  let decisions;
  const raw = arg(argv, '--decisions');
  if (raw !== undefined) {
    try { decisions = JSON.parse(raw); } catch { return out({ ok: false, reason: '--decisions is not valid JSON' }); }
  }
  const { toolSubmit } = await import('../mcp/taskmanager-claims.mjs');
  try {
    const r = toolSubmit({ task_id: task, key, payload: decisions === undefined ? {} : { decisions } });
    out({ ok: true, key: r.key, node_id: r.node_id, state: r.state });
  } catch (e) {
    out({ ok: false, reason: String((e && e.message) || e) });
  }
}

main(process.argv.slice(2)).catch((e) => { out({ ok: false, reason: String((e && e.message) || e) }); });
