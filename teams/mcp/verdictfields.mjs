// verdictfields.mjs - the one map of which field carries a judging node's verdict.
//
// A judging node's stage_ok means only "the judging itself worked"; the verdict lives in a
// field of its result (accept / sound / verified). Five readers each kept their own literal
// of that mapping, and their key sets differ on purpose: each covers the stages ITS caller can
// meet. This file holds the mapping once - stage -> { field, scope } - and every reader gets a
// plain-object view of the scopes it belongs to, key for key what its literal held.
//
// scope names the readers a stage belongs to:
//   engine      graph.mjs VERDICT_FIELD: the broker's harness stages. Truthiness decides behaviour
//               (broker.mjs, prompts.mjs): a stage present here is a judging stage.
//   humanGate   graph.mjs HUMAN_GATE_VERDICT_FIELD: stages a person may answer with accept/reject.
//   reasoning   inspect-collect.mjs / view-collect.mjs: stages whose verdict a viewer shows.
//   manager     taskmanager.mjs VERDICT: the manager's judging stages.
// The views are plain {} objects, so a lookup of an absent stage reads undefined exactly as before.

export const SCOPES = ['engine', 'humanGate', 'reasoning', 'manager'];

export const VERDICT_MAP = {
  gate:             { field: 'accept',   scope: ['engine', 'humanGate', 'reasoning', 'manager'] },
  critique:         { field: 'sound',    scope: ['engine', 'humanGate', 'reasoning', 'manager'] },
  test:             { field: 'verified', scope: ['engine'] },
  review:           { field: 'verified', scope: ['engine'] },
  execute:          { field: 'verified', scope: ['engine'] },
  accept:           { field: 'accept',   scope: ['humanGate', 'reasoning', 'manager'] },
  integrate:        { field: 'verified', scope: ['humanGate', 'reasoning', 'manager'] },
  'areas-critique': { field: 'sound',    scope: ['humanGate', 'manager'] },
  'plan-integrate': { field: 'accept',   scope: ['humanGate', 'manager'] },
  dispatch:         { field: 'accept',   scope: ['reasoning', 'manager'] },
};

export function verdictView(scope) {
  const out = {};
  for (const [stage, { field, scope: scopes }] of Object.entries(VERDICT_MAP)) {
    if (scopes.includes(scope)) out[stage] = field;
  }
  return out;
}

export const VERDICT_FIELD = verdictView('engine');
export const HUMAN_GATE_VERDICT_FIELD = verdictView('humanGate');
export const REASONING_VERDICT = verdictView('reasoning');
export const TASKMANAGER_VERDICT = verdictView('manager');
