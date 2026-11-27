// The stage bar's vocabulary, shared by view-collect.mjs (the harness run's stages on the model)
// and view-summary.mjs (the bar a person reads). One copy: a node id and a node state mean the
// same stage and state wherever they are looked at. Pure; no fs.

export const STAGE_KEYS = ['plan', 'build', 'integrate', 'qa', 'gate', 'report'];

export function stageOfNode(id) {
  const base = String(id).split(':')[0];
  if (/^(size|shape|critique|setgoal|plan)$/.test(base)) return 'plan';
  if (/^(implement|test|cases|execute)$/.test(base)) return 'build';
  if (base === 'integrate') return Number(String(id).split(':')[1]) > 1 ? 'qa' : 'integrate';
  if (base === 'gate') return 'gate';
  if (base === 'report') return 'report';
  return null;
}

// A size-S harness run's own steps (FLOOR draws these instead of the six-phase frame). setgoal and
// critique are part of plan. STEP_PHASE is the EPIC phase a step sits in, used only for the row's ref.
export const STEP_KEYS = ['plan', 'implement', 'test', 'gate', 'report'];
export const STEP_PHASE = { plan: 1, implement: 2, test: 2, gate: 5, report: 6 };

export function stepOfNode(id) {
  const parts = String(id).split(':');
  const base = parts[0];
  if (/^(size|shape|plan|setgoal|critique)$/.test(base)) return 'plan';
  if (/^(implement|repair)$/.test(base)) return 'implement';
  if (/^(test|cases|execute|reduce)$/.test(base)) return 'test';
  // only the goal gate is the Gate step; a per-subgoal gate (gate:<sg>:<round>) belongs to Test
  if (base === 'gate') return parts[1] === 'goal' ? 'gate' : 'test';
  if (base === 'report') return 'report';
  return null;
}

export const nodeState = (s) => (s === 'done' ? 'done' : s === 'failed' || s === 'blocked' ? 'failed'
  : s === 'running' || s === 'waiting_human' ? 'running' : 'pending');

export const mergeStates = (states) => {
  if (!states.length) return null;
  if (states.includes('failed')) return 'failed';
  if (states.every((s) => s === 'done')) return 'done';
  if (states.every((s) => s === 'pending')) return 'pending';
  return 'running';
};
