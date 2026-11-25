// storyevidence.mjs - the engine answers a STORY's evidence question itself (server process count,
// ledger lines, cost by stage): the reads and the settle. The classifier and the answer text are
// storyask.mjs's (pure). Anything it does not classify, or cannot read, is left unclaimed for the
// daemon's answer node, exactly as before.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadRunAt } from './graph.mjs';
import { mutateTask } from './store.mjs';
import { claimableStoryAsks, claimStoryAsk, settleStoryAsk, taskDir, taskPath } from './taskmanager.mjs';
import { costByStage, taskFigure } from './drivercost.mjs';
import { evidenceAnswer, evidenceKinds } from './storyask.mjs';

const LINE_CAP = 20;

// Injectable so a test can feed or break each source.
const READERS = {
  processes: () => execFileSync('ps', ['-axo', 'pid,command'], { encoding: 'utf8', timeout: 5000, maxBuffer: 32 * 1024 * 1024 }),
  ledger: (taskId) => readFileSync(join(taskDir(taskId), 'ledger.jsonl'), 'utf8'),
  cost: (taskId, task) => taskFigure(taskDir(taskId), task),
};

// A node process whose script is a teams server: not a `claude -p` whose arguments only name one.
const TEAMS_SERVER = /^\s*\d+\s+(?:\S*\/)?node(?:\s+-\S+)*\s+(?:\S*\/)?teams\/(?:\d[\w.-]*\/)?mcp\/server\.mjs(?:\s|$)/;

// The lines the question names, by ts (13 digits) and/or event. Throws when it names neither, or
// names one that no selected line carries: a partial answer would read as a complete one.
function namedLines(text, question) {
  const q = question.toLowerCase();
  const ts = q.match(/\b\d{13}\b/g) || [];
  const events = [...new Set(q.match(/\b(?:[a-z]+(?:_[a-z]+)+|asked|answered)\b/g) || [])]
    .filter((w) => w !== 'by_stage' && w !== 'cost_by_stage');
  if (!ts.length && !events.length) throw new Error('the question names no ledger line');
  const picked = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; } // a torn line
    if ((!ts.length || ts.includes(String(e.ts))) && (!events.length || events.includes(e.event))) picked.push({ line, e });
  }
  if (!picked.length || ts.some((t) => !picked.some((p) => String(p.e.ts) === t)) || events.some((n) => !picked.some((p) => p.e.event === n))) {
    throw new Error('a named ledger line was not found');
  }
  return { lines: picked.slice(-LINE_CAP).map((p) => p.line), omitted: Math.max(0, picked.length - LINE_CAP) };
}

function readFacts(taskId, task, question, kinds, readers) {
  const facts = { at: new Date().toISOString() };
  if (kinds.includes('process_count')) {
    // The count only: the listing is machine-wide, so its command lines never leave this function.
    facts.process_count = readers.processes().split('\n').filter((l) => TEAMS_SERVER.test(l)).length;
  }
  if (kinds.includes('ledger_lines')) facts.ledger = namedLines(readers.ledger(taskId), question);
  if (kinds.includes('cost_by_stage')) {
    const fig = readers.cost(taskId, task);
    facts.cost = { by_stage: costByStage(fig.live), spend: fig.spend, estimated: fig.estimated };
  }
  return facts;
}

// Every claimable ask that is purely about evidence: read (outside the lock), then claim and settle
// in one transaction as a teamleader answer. `live` is the daemon's claim check. True when any
// ask was answered.
export function selfAnswerStoryAsks(taskId, live, readers = {}) {
  const use = { ...READERS, ...readers };
  const task = loadRunAt(taskPath(taskId)) || {};
  let did = false;
  for (const askId of claimableStoryAsks(task, live)) {
    const { question } = task.story_asks.find((a) => a.ask_id === askId);
    const kinds = evidenceKinds(question);
    if (!kinds) continue;
    let answer;
    try { answer = evidenceAnswer(kinds, readFacts(taskId, task, question, kinds, use)); } catch { continue; }
    const claim = { pid: process.pid, token: randomUUID(), at: Date.now() };
    const settled = mutateTask(taskId, (t) => !!claimStoryAsk(t, askId, claim, live)
      && !settleStoryAsk(t, askId, claim.token, { verdict: 'answer', answer }).superseded);
    if (settled) did = true;
  }
  return did;
}
