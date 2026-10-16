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

export const nodeState = (s) => (s === 'done' ? 'done' : s === 'failed' || s === 'blocked' ? 'failed'
  : s === 'running' || s === 'waiting_human' ? 'running' : 'pending');

export const mergeStates = (states) => {
  if (!states.length) return null;
  if (states.includes('failed')) return 'failed';
  if (states.every((s) => s === 'done')) return 'done';
  if (states.every((s) => s === 'pending')) return 'pending';
  return 'running';
};
