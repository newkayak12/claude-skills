// engage.mjs - the shared "an engine is engaged here" marker.
//
// harness's goal-gate.mjs (a PreToolUse hook copied into projects) refuses gated edits unless
// the session's transcript shows the harness or .claude/.harness-markers/ holds a file whose
// content is a recent Date.now(). A team worker session edits inside a package worktree under
// ~/.harness/tasks/<id>/worktrees/<Pn>, where the committed gate config and hook exist but the
// gitignored markers dir does not - so the harness gate would deny every node write. The
// manager therefore writes a marker of its own into each worktree it opens and refreshes it on
// every poll. No harness change is needed: this is the same file shape harness already reads,
// and dispatch-gate.mjs reads it back for the reverse direction.
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const MARKER_WINDOW_MS = 2 * 60 * 60 * 1000; // harness's default window_hours

export function markerPath(cwd, taskId) {
  return join(cwd, '.claude', '.harness-markers', `team-${String(taskId).slice(0, 8)}`);
}

// Best-effort: a marker the manager could not write is a gate the worker may hit, which the
// worker's own driver log will show. Never a reason to fail the open.
export function touchMarker(cwd, taskId) {
  try {
    const p = markerPath(cwd, taskId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

export function clearMarker(cwd, taskId) {
  try {
    const p = markerPath(cwd, taskId);
    if (existsSync(p)) rmSync(p);
  } catch {
    /* best-effort */
  }
}
