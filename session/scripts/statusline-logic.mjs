// Pure renderer of the status line. Mirrors the reference shell script (fixtures/statusline-command.sh)
// byte for byte, quirks included: jq `//` only replaces null/false, printf %.0f rounds half to even,
// and each branch label is stripped by sed-style first-occurrence replaces in sequence.

const C = (code, s) => `\x1b[0;${code}m${s}\x1b[0m`

const present = v => v !== null && v !== undefined && v !== false

// printf "%.0f": an exact .5 goes to the even neighbour, anything else to the nearest integer.
export function roundHalfEven(x) {
  const f = Math.floor(x)
  if (x - f === 0.5) return f % 2 === 0 ? f : f + 1
  return Math.round(x)
}

const pct = v => `${roundHalfEven(Number(v))}%`

const STRIP = {
  feat: ['feat/', 'feature/'],
  fix: ['fix/', 'bugfix/', 'hotfix/'],
  release: ['release/'],
  chore: ['chore/'],
  docs: ['docs/'],
}
const strip = (branch, prefixes) => prefixes.reduce((s, p) => s.replace(p, ''), branch)

export function branchLabel(branch) {
  if (!branch) return ''
  if (branch === 'main' || branch === 'master') return '🌿 main'
  if (branch === 'develop' || branch === 'dev') return '🔧 dev'
  if (/^(feat|feature)\//.test(branch)) return `✨ feat: ${strip(branch, STRIP.feat)}`
  if (/^(fix|bugfix|hotfix)\//.test(branch)) return `🐛 fix: ${strip(branch, STRIP.fix)}`
  if (branch.startsWith('release/')) return `🚀 release: ${strip(branch, STRIP.release)}`
  if (branch.startsWith('chore/')) return `🔨 chore: ${strip(branch, STRIP.chore)}`
  if (branch.startsWith('docs/')) return `📝 docs: ${strip(branch, STRIP.docs)}`
  return `🌀 ${branch}`
}

const text = v => (typeof v === 'string' ? v : JSON.stringify(v))

export function render(input, { now = new Date(), branch = '' } = {}) {
  const i = input && typeof input === 'object' ? input : {}
  const model = present(i.model?.display_name) ? text(i.model.display_name) : 'Unknown'
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const used = i.context_window?.used_percentage
  const ctx = present(used) ? `🧠 Ctx: ${pct(used)}` : '🧠 Ctx: -'
  const five = i.rate_limits?.five_hour?.used_percentage
  const week = i.rate_limits?.seven_day?.used_percentage
  const limits = [present(five) && `⏱️ 5h: ${pct(five)}`, present(week) && `📅 7d: ${pct(week)}`].filter(Boolean).join(' | ')

  let out = `${C(36, `🤖 ${model}`)} | ${C(33, `🕐 ${hhmm}`)}`
  const label = branchLabel(branch)
  if (label) out += ` | ${C(35, label)}`
  out += ` | ${C(34, ctx)}`
  if (limits) out += ` | ${C(32, limits)}`
  return out
}
