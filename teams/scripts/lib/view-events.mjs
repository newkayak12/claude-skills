// Pure helpers for the teams-live mod: which ledger lines deserve a toast, and the status line.
// No fs - view.mjs reads the ledger and hands the lines in.

const id8 = (taskId) => 'E-' + String(taskId ?? '').replace(/^E-/, '').slice(0, 8);

// One entry per notable ledger event; null = silent.
const TEXT = {
  node_finish: (e, id) => (e.state === 'failed' ? `${id} ${e.node_id} failed` : null),
  waiting_human: (e, id) => `${id} needs you: ${e.node_id}`,
  child_driver_capacity: (e, id) => `${id} paused: provider limit`,
  daemon_done: (e, id) => `${id} finished: ${e.state}`,
  daemon_exhausted: (e, id) => `${id} stopped: daemon restarts used up`,
  upstream_fix_rounds_exhausted: (e, id) => `${id} ${e.package_id}: fix rounds used up`,
};

export function notableEvents(lines, sinceTs) {
  const out = [];
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; } // torn last line
    if (!e || typeof e.ts !== 'number' || e.ts <= sinceTs) continue;
    const text = TEXT[e.event]?.(e, id8(e.task_id));
    if (text) out.push({ ts: e.ts, task_id: e.task_id, kind: e.event, text });
  }
  return out;
}

export function statusLine(rows) {
  if (!rows.length) return '';
  return 'teams: ' + rows.map((r) => `${r.id} ${r.done}/${r.total} ${r.current}`).join(' · ');
}
