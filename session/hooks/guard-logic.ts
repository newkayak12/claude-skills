// Pure logic of the guard: command splitter, rules, path rules, redaction, ring buffer. No engine calls.

// `sub`: found inside a $( ), backticks, a heredoc body or a -c string, not at the top level of the line
export type Cmd = { argv: string[]; sub?: boolean }
export type Verdict = { rule: string; action: 'confirm' | 'deny'; reason: string } | undefined
export type Denial = {
  id: string
  ts: number
  tool: string
  call: string
  reason: string
  source: 'guard' | 'native' | 'declined'
  nativeRule?: string
  agentId?: string
}

// What the rules may ask of the outside world; every answer is optional, a failure is `undefined`.
export type Env = {
  cwd: string
  root?: string
  home?: string
  extraBranches: string[]
  git: (argv: string[]) => Promise<string | undefined>
  pgrep: (path: string) => Promise<string | undefined>
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'python', 'python3', 'node'])
const KEYWORDS = new Set(['{', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', 'time'])
const base = (s: string) => s.slice(s.lastIndexOf('/') + 1)

// ---- splitter -------------------------------------------------------------------------------

// End index (of the matching `)`) for a `$(` whose body starts at `from`; -1 when unterminated.
function closeParen(s: string, from: number): number {
  let depth = 1
  for (let i = from; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') i++
    else if (c === "'") {
      const j = s.indexOf("'", i + 1)
      if (j < 0) return -1
      i = j
    } else if (c === '"') {
      for (i++; i < s.length && s[i] !== '"'; i++) if (s[i] === '\\') i++
      if (i >= s.length) return -1
    } else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i
  }
  return -1
}

function parse(s: string): Cmd[] | null {
  const cmds: Cmd[] = []
  let cur: string[] = []
  let word: string | null = null
  const pending: { delim: string; strip: boolean }[] = []
  const flushWord = () => {
    if (word !== null) cur.push(word)
    word = null
  }
  const endCmd = () => {
    flushWord()
    if (cur.length) cmds.push({ argv: cur })
    cur = []
  }
  const add = (t: string) => {
    word = (word ?? '') + t
  }
  const sub = (inner: string): boolean => {
    const r = parse(inner)
    if (r === null) return false
    cmds.push(...r.map(c => ({ ...c, sub: true })))
    return true
  }
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c === ' ' || c === '\t') flushWord()
    else if (c === '\n') {
      flushWord()
      for (const h of pending.splice(0)) {
        const lines = s.slice(i + 1).split('\n')
        let n = 0
        while (n < lines.length && (h.strip ? lines[n]!.replace(/^\t+/, '') : lines[n]) !== h.delim) n++
        const body = lines.slice(0, n).join('\n')
        i += 1 + (n > 0 ? body.length + 1 : 0) + (n < lines.length ? lines[n]!.length : 0)
        let text = body
        if (!SHELLS.has(base(unwrap(cur)[0] ?? ''))) text = '' // mutation:heredoc-skip
        if (!sub(text)) return null
      }
      endCmd()
    } else if (c === '\\') {
      if (s[i + 1] === '\n') i++
      else if (i + 1 < s.length) add(s[++i]!)
    } else if (c === "'") {
      const j = s.indexOf("'", i + 1)
      if (j < 0) return null
      add(s.slice(i + 1, j))
      i = j
    } else if (c === '"') {
      let out = ''
      let j = i + 1
      for (; j < s.length && s[j] !== '"'; j++) {
        const d = s[j]!
        if (d === '\\' && j + 1 < s.length) out += s[++j]
        else if (d === '$' && s[j + 1] === '(') {
          const k = closeParen(s, j + 2)
          if (k < 0 || !sub(s.slice(j + 2, k))) return null
          out += '$(…)'
          j = k
        } else if (d === '`') {
          const k = s.indexOf('`', j + 1)
          if (k < 0 || !sub(s.slice(j + 1, k))) return null
          out += '$(…)'
          j = k
        } else out += d
      }
      if (j >= s.length) return null
      add(out)
      i = j
    } else if (c === '$' && s[i + 1] === '(') {
      const k = closeParen(s, i + 2)
      if (k < 0 || !sub(s.slice(i + 2, k))) return null
      add('$(…)')
      i = k
    } else if (c === '`') {
      const k = s.indexOf('`', i + 1)
      if (k < 0 || !sub(s.slice(i + 1, k))) return null
      add('$(…)')
      i = k
    } else if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      let j = i + 2
      const strip = s[j] === '-'
      if (strip) j++
      while (s[j] === ' ' || s[j] === '\t') j++
      let delim = ''
      for (; j < s.length && !/[\s;&|()<>]/.test(s[j]!); j++) {
        const d = s[j]!
        if (d === "'" || d === '"') {
          const k = s.indexOf(d, j + 1)
          if (k < 0) return null
          delim += s.slice(j + 1, k)
          j = k
        } else if (d === '\\') delim += s[++j] ?? ''
        else delim += d
      }
      pending.push({ delim, strip })
      flushWord()
      i = j - 1
    } else if (c === ';' || c === '|' || c === '(' || c === ')') {
      endCmd()
      if ((c === '|' && s[i + 1] === '|') || (c === '|' && s[i + 1] === '&')) i++
    } else if (c === '&') {
      if (s[i + 1] === '&') {
        endCmd()
        i++
      } else if (s[i - 1] === '>' || s[i - 1] === '<' || s[i + 1] === '>') add('&')
      else endCmd()
    } else if (c === '#' && word === null) {
      while (i < s.length && s[i] !== '\n') i++
      i--
    } else add(c)
  }
  endCmd()
  return cmds
}

// `a && rm -rf x; b | c $(d)` -> one argv per executable position. Heredoc bodies and quoted arguments are
// text, not commands, unless the heredoc (or `-c` string) feeds a shell or interpreter. Unparseable -> [].
export function splitCommands(src: string): Cmd[] {
  const top = parse(src)
  if (top === null) return []
  const out: Cmd[] = [...top]
  for (const { argv } of top) {
    const a = unwrap(argv)
    if (!SHELLS.has(base(a[0] ?? ''))) continue
    const i = a.findIndex(x => /^-[a-z]*c[a-z]*$/.test(x))
    const code = i > 0 ? a[i + 1] : undefined
    const inner = code === undefined ? null : parse(code)
    if (inner) out.push(...inner.map(c => ({ ...c, sub: true })))
  }
  return out
}

// The real command behind assignments, keywords and wrappers (`sudo`, `env`, `command`, `nohup` ...).
export function unwrap(argv: string[]): string[] {
  let a = argv
  for (let n = 0; n < 8; n++) {
    let i = 0
    while (i < a.length && (/^[A-Za-z_]\w*=/.test(a[i]!) || KEYWORDS.has(a[i]!))) i++
    a = a.slice(i)
    const h = base(a[0] ?? '')
    if (h === 'sudo' || h === 'doas') {
      let j = 1
      while (j < a.length && a[j]!.startsWith('-')) j += /^-[ug]$/.test(a[j]!) ? 2 : 1
      a = a.slice(j)
    } else if (h === 'env') {
      let j = 1
      while (j < a.length && (a[j]!.startsWith('-') || /^[A-Za-z_]\w*=/.test(a[j]!))) j++
      a = a.slice(j)
    } else if (['command', 'nohup', 'nice', 'exec', 'builtin'].includes(h)) {
      let j = 1
      while (j < a.length && a[j]!.startsWith('-')) j++
      a = a.slice(j)
    } else break
  }
  return a
}

// ---- paths ----------------------------------------------------------------------------------

function normalize(base_: string, p: string): string {
  const out: string[] = []
  for (const seg of (p.startsWith('/') ? p : `${base_}/${p}`).split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return `/${out.join('/')}`
}

// Test-only stand-in for a home that is not known: `~` still names a dangerous target then.
const UNKNOWN_HOME = '/__home__'

function dangerousTarget(t: string, env: Env): boolean {
  let s = t
  const glob = s.match(/^(.*)\/\*+$/)
  if (glob) s = glob[1] || '/'
  const home = env.home ? normalize('/', env.home) : UNKNOWN_HOME
  s = s.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home).replace(/^(\$PWD|\$\{PWD\})(?=\/|$)/, env.cwd)
  if (s === '' || /[$`]/.test(s)) return false
  const r = normalize(env.cwd, s)
  return r === '/' || r === home || r === env.root || env.cwd.startsWith(`${r}/`)
}

// The `rm` rule: recursive and force, any target at `/`, home, the repo root or above the cwd.
function rmVerdict(a: string[], env: Env): Verdict {
  let recursive = false
  let force = false
  const targets: string[] = []
  let flags = true
  for (const x of a.slice(1)) {
    if (flags && x === '--') flags = false
    else if (flags && x.startsWith('--')) {
      if (x === '--recursive') recursive = true
      if (x === '--force') force = true
    } else if (flags && x.startsWith('-') && x.length > 1) {
      if (/[rR]/.test(x)) recursive = true
      if (x.includes('f')) force = true
    } else targets.push(x)
  }
  if (!recursive || !force) return undefined
  const hit = targets.find(t => dangerousTarget(t, env))
  return hit === undefined
    ? undefined
    : { rule: 'recursive-delete', action: 'confirm', reason: `session: recursive force delete of ${hit} can wipe the project or home.` }
}

// ---- git ------------------------------------------------------------------------------------

type Git = { dir?: string; sub: string; rest: string[] }

function gitArgs(a: string[]): Git | undefined {
  if (base(a[0] ?? '') !== 'git') return undefined
  let dir: string | undefined
  let i = 1
  for (; i < a.length && a[i]!.startsWith('-'); i++) {
    if (a[i] === '-C') dir = a[++i]
    else if (a[i] === '-c') i++
  }
  const sub = a[i]
  return sub === undefined ? undefined : { dir, sub, rest: a.slice(i + 1) }
}

const gitC = (g: Git, argv: string[]) => (g.dir ? ['-C', g.dir, ...argv] : argv)
const branchOf = (r: string) => r.replace(/^refs\/heads\//, '')

async function pushVerdict(g: Git, env: Env): Promise<Verdict> {
  let flagForce = false
  const pos: string[] = []
  for (let i = 0; i < g.rest.length; i++) {
    const x = g.rest[i]!
    if (x.startsWith('--')) {
      if (x === '--force' || x.startsWith('--force-with-lease')) flagForce = true
      else if (['--repo', '--receive-pack', '--exec', '--push-option'].includes(x)) i++
    } else if (x.startsWith('-') && x.length > 1) {
      if (x.includes('f')) flagForce = true
      if (x === '-o') i++
    } else pos.push(x)
  }
  const specs = pos.slice(1)
  const forced: string[] = []
  const wantsCurrent: boolean[] = []
  for (const sp of specs) {
    const plus = sp.startsWith('+')
    if (!plus && !flagForce) continue
    const body = plus ? sp.slice(1) : sp
    const dst = body.includes(':') ? body.slice(body.indexOf(':') + 1) : body
    forced.push(branchOf(dst))
    wantsCurrent.push(dst === 'HEAD' || dst === '@')
  }
  if (flagForce && specs.length === 0) {
    forced.push('')
    wantsCurrent.push(true)
  }
  if (forced.length === 0) return undefined
  const protectedSet = new Set(['main', 'master', 'trunk', ...env.extraBranches])
  const head = await env.git(gitC(g, ['symbolic-ref', 'refs/remotes/origin/HEAD']))
  if (head?.trim()) protectedSet.add(head.trim().replace(/^refs\/remotes\/origin\//, ''))
  for (let i = 0; i < forced.length; i++) {
    let b = forced[i]!
    if (wantsCurrent[i]) b = (await env.git(gitC(g, ['branch', '--show-current'])))?.trim() ?? ''
    if (b && protectedSet.has(b)) {
      return { rule: 'force-push-protected', action: 'confirm', reason: `session: force push to protected branch ${b} can erase shared history.` }
    }
  }
  return undefined
}

function resetVerdict(g: Git): Verdict {
  if (g.sub === 'reset' && g.rest.includes('--hard')) {
    return { rule: 'hard-reset', action: 'confirm', reason: 'session: git reset --hard discards uncommitted work.' }
  }
  if (g.sub === 'clean') {
    const f = g.rest.filter(x => x.startsWith('-'))
    const short = (c: string) => f.some(x => !x.startsWith('--') && x.includes(c))
    const force = short('f') || f.includes('--force')
    const dry = short('n') || f.includes('--dry-run')
    if (force && short('d') && !dry) {
      return { rule: 'hard-reset', action: 'confirm', reason: 'session: git clean -fd deletes untracked files for good.' }
    }
  }
  return undefined
}

async function worktreeVerdict(g: Git, env: Env): Promise<Verdict> {
  if (g.sub !== 'worktree' || g.rest[0] !== 'remove') return undefined
  const args = g.rest.slice(1)
  if (!args.some(x => x === '--force' || x === '-f')) return undefined
  const target = args.find(x => !x.startsWith('-'))
  if (!target) return undefined
  const path = normalize(g.dir ? normalize(env.cwd, g.dir) : env.cwd, target)
  const st = await env.git(['-C', path, 'status', '--porcelain'])
  if (!st?.trim()) return undefined
  return {
    rule: 'worktree-dirty-remove',
    action: 'deny',
    reason: `session: ${path} has uncommitted changes:\n${st.slice(0, 500)}\nCommit (and verify with git log) before removing it.`,
  }
}

// The first rule that fires over the executable positions of a Bash command.
export async function classify(cmds: Cmd[], env: Env): Promise<Verdict> {
  for (const { argv } of cmds) {
    const a = unwrap(argv)
    const head = base(a[0] ?? '')
    let v: Verdict
    if (head === 'rm') v = rmVerdict(a, env)
    else if (head === 'git') {
      const g = gitArgs(a)
      if (g?.sub === 'push') v = await pushVerdict(g, env)
      else if (g) v = resetVerdict(g) ?? (await worktreeVerdict(g, env))
    }
    if (v) return v
  }
  return undefined
}

// ---- files ----------------------------------------------------------------------------------

const KEY_FILES = new Set(['id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa'])
const SECRET_DIRS = /(^|\/)\.(aws|ssh|gnupg|kube|docker)\/|(^|\/)\.config\/gcloud\//

const globRe = (g: string) =>
  new RegExp(
    `(^|/)${g
      .trim()
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/\u0000/g, '.*')}$`,
  )

// Path-only: the content of a write is never read.
export function secretPath(path: string, extra: string[]): boolean {
  const name = base(path)
  if (name === '.env' || (name.startsWith('.env.') && !/\.(example|sample|template)$/.test(name))) return true
  if (/\.(pem|key|p12|pfx|jks|keystore)$/i.test(name) || KEY_FILES.has(name)) return true
  if (SECRET_DIRS.test(path) && /^(credentials|tokens?)(\.json)?$/i.test(name)) return true
  return extra.some(g => g.trim() && globRe(g).test(path))
}

// The rules that look at a Write or Edit path: secret-write, then running-script.
export async function classifyFile(path: string, extra: string[], env: Env): Promise<Verdict> {
  if (secretPath(path, extra)) {
    return { rule: 'secret-write', action: 'confirm', reason: `session: ${path} looks like a secret file.` }
  }
  if (/\.(sh|bash)$/.test(path)) {
    const out = (await env.pgrep(path))?.trim()
    if (out) {
      return {
        rule: 'running-script',
        action: 'deny',
        reason: `session: ${path} is running (pid ${out.split('\n').join(', ')}). Copy it and edit the copy, or wait until it exits.`,
      }
    }
  }
  return undefined
}

// ---- log ------------------------------------------------------------------------------------

// Token-shaped strings, NAME=value pairs and URL userinfo are masked before anything is stored.
export function redact(call: string): string {
  return call
    .replace(/\bgh[pousr]_[A-Za-z0-9]{4,}/g, '***')
    .replace(/\bsk-[A-Za-z0-9_-]{4,}/g, '***')
    .replace(/\bAKIA[0-9A-Z]{4,}/g, '***')
    .replace(/\bxox[a-z]-[A-Za-z0-9-]{4,}/g, '***')
    .replace(/Bearer\s+\S+/g, 'Bearer ***')
    .replace(/(?<![\w-])([A-Za-z_]\w*)=\S+/g, '$1=***')
    .replace(/:\/\/[^\s/@]+@/g, '://***@')
}

export function pushRing<T>(list: readonly T[], item: T, cap: number): T[] {
  const next = [...list, item]
  return next.length > cap ? next.slice(next.length - cap) : next
}

// `Bash(git reset:*)` for a Bash call, `Write(path)` for a file call.
export function ruleFor(d: { tool: string; call: string }): string {
  if (d.tool !== 'Bash') return `${d.tool}(${d.call})`
  const w = unwrap(d.call.split(/\s+/).filter(Boolean))
  const g = gitArgs(w)
  return `Bash(${g ? `git ${g.sub}` : (w[0] ?? '')}:*)`
}
