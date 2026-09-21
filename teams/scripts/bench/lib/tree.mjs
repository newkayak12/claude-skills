// Where the deliverable actually lives for one bench workspace. Shared by score.mjs and
// audit.mjs so "which tree is judged" is answered exactly once - a fork here would let the
// scorer and the auditor silently disagree about what they are looking at.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const ls = (p) => { try { return readdirSync(p); } catch { return []; } };

// The newest .harness-tasks/<id>/worktrees/integration* directory under a workspace, or null
// when the arm produced no task (the plain arm, or a teams run that never reached integrate).
export function integrationTree(ws) {
  const root = join(ws, '.harness-tasks');
  const found = [];
  for (const id of ls(root)) for (const n of ls(join(root, id, 'worktrees'))) if (n.startsWith('integration')) found.push(join(root, id, 'worktrees', n));
  found.sort();
  return found.at(-1) || null;
}

// The tree that is actually judged for a workspace: the integration worktree when the arm
// produced a task, else the workspace itself.
export function resolveTree(ws) {
  return integrationTree(ws) || ws;
}
