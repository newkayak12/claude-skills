// The one English allow-list of the Korean render (F4-AC-32). Scan and page tests read it from here.
export const ALLOW: string[] = [
  'Teams', 'HOME', 'EPIC', 'STORY', 'QA', 'FLOOR', 'Phase',
  'Plan', 'Build', 'Integrate', 'Gate', 'Report', 'Log',
  'plan', 'setgoal', 'critique', 'implement', 'test', 'gate',
  'implementer', 'critic', 'tester', 'planner', 'judge', 'brainstorm',
  'subagent', 'TeamLeader',
  'accepted', 'accept', 'reject', 'ask', 'try',
  'FLOW', 'Integ', 'Rep', 'drivers', 'load', 'ag', 'queued',
  'sonnet', 'opus',
  'Esc', 'EN', 'KR',
  // extras beyond AC-32:
  'teams', // lower-case product name, as the mocks' header draws it
  'integrate', // lower-case stage id (node and ticket names)
  'qa', // lower-case stage id of the qa flow
]

const onList = (w: string): boolean => ALLOW.includes(w) || /^tm_\w+$/.test(w)

// Latin words (two or more letters) in text that are neither allow-listed nor part of a data string.
export function latinOutside(text: string, data: string[] = []): string[] {
  let rest = text
  for (const d of data) if (d) rest = rest.split(d).join(' ')
  // id tokens are data, by their real shapes only: 1-3 capitals then digits (SG1, P1, S3), or 1-3 capitals, a dash and a hex run
  // holding a digit (QA-F1, E-1a2b, S-3). A word with a digit glued to it (Stories3, retrying2) and anything glued after an id
  // (SG1-stalled, P1_failed) is not data: the word is still scanned
  rest = rest.replace(/(?<![A-Za-z])(?:[A-Z]{1,3}-(?=[0-9a-fA-F]*\d)[0-9a-fA-F]{1,8}|[A-Z]{1,3}\d+)(?![A-Za-z\d])/g, ' ')
  return (rest.match(/[A-Za-z][A-Za-z_]*[A-Za-z]/g) ?? []).filter((w) => !onList(w))
}

// Hangul runs in text outside data strings (the English render must hold none).
export function hangulIn(text: string, data: string[] = []): string[] {
  let rest = text
  for (const d of data) if (d) rest = rest.split(d).join(' ')
  return rest.match(/[ㄱ-ㆎ가-힣]+/g) ?? []
}
