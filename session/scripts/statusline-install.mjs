// /session:statusline backend: writes (or removes) our statusLine entry in the user's settings.json,
// pointing at a stable copy of statusline.mjs in the plugin data dir. All decisions live in
// statusline-install-logic.mjs; this file only touches the disk.
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, rmdirSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BLOCKED_LINE, USAGE, commandFor, dataDirFrom, decide, normalizeDir, parseArgs, serialize, settingsPath,
} from './statusline-install-logic.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const COPIES = ['statusline.mjs', 'statusline-logic.mjs']

function fail(msg, code = 2) {
  process.stderr.write(`${msg}\n`)
  process.exit(code)
}

// realpath of the path, or of its nearest existing ancestor plus the rest
function realOrAncestor(p) {
  try {
    return realpathSync(p)
  } catch {
    const up = dirname(p)
    return up === p ? p : join(realOrAncestor(up), basename(p))
  }
}

function readSettings(path) {
  if (!existsSync(path)) return {}
  let v
  try {
    v = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    fail(`${path}: not valid JSON (${e.message}); nothing written`)
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${path}: not a JSON object; nothing written`)
  return v
}

function writeSettings(path, obj) {
  const real = realOrAncestor(path)
  mkdirSync(dirname(real), { recursive: true })
  const tmp = `${real}.tmp-${process.pid}`
  try {
    writeFileSync(tmp, serialize(obj))
    renameSync(tmp, real)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}

// remove the files this tool owns; previous.json (the replaced line) stays while it exists
function removeCopies(filesDir) {
  for (const f of COPIES) rmSync(join(filesDir, f), { force: true })
  if (existsSync(filesDir) && readdirSync(filesDir).length === 0) rmdirSync(filesDir)
}

const args = parseArgs(process.argv.slice(2))
if (args.error) fail(`${args.error}\n${USAGE}`)

const home = homedir()
const dd = dataDirFrom({ data: args.data, scriptPath: fileURLToPath(import.meta.url), env: process.env, home })
if (dd.error) fail(dd.error)

const dataDir = realOrAncestor(normalizeDir(dd.dir))
const filesDir = join(dataDir, 'statusline')
const command = commandFor(dataDir)
const alt = [commandFor(normalizeDir(dd.dir))]
const file = args.settings ? normalizeDir(args.settings) : settingsPath(process.env, home)

const settings = readSettings(file)
const r = decide(settings, command, { mode: args.mode, replace: args.replace, alt })
const json = v => (v === null ? 'none' : JSON.stringify(v))
const out = [`settings: ${file}`, `data: ${dataDir} (${dd.source})`, `current: ${json(r.current)}`]
const previous = join(filesDir, 'previous.json')

switch (r.action) {
  case 'show':
    out.push(`will write (on): ${json(r.next.statusLine)}`)
    break
  case 'blocked':
    out.push(BLOCKED_LINE)
    break
  case 'add':
  case 'refresh':
  case 'replace': {
    mkdirSync(filesDir, { recursive: true })
    for (const f of COPIES) copyFileSync(join(here, f), join(filesDir, f))
    if (r.action === 'replace') writeFileSync(previous, `${JSON.stringify(r.current)}\n`)
    if (r.action !== 'refresh') writeSettings(file, r.next)
    out.push(`wrote: ${json(r.next.statusLine)}`)
    if (r.action === 'refresh') out.push('settings unchanged; scripts recopied')
    if (r.action === 'replace') out.push(`previous statusLine: ${json(r.current)} (saved to ${previous})`)
    break
  }
  case 'remove':
    writeSettings(file, r.next)
    removeCopies(filesDir)
    out.push(`removed: ${json(r.current)}`)
    if (existsSync(previous)) out.push(`previous statusLine kept at ${previous}; it is not restored`)
    break
  case 'absent':
    removeCopies(filesDir)
    out.push('no statusLine set; nothing to remove')
    break
  case 'foreign-kept':
    out.push('not ours, left alone')
    break
}
if (r.action === 'remove' || r.action === 'absent') {
  out.push(`removed files: ${COPIES.map(f => join(filesDir, f)).join(', ')}`)
  if (r.action === 'absent' && existsSync(previous)) out.push(`previous.json kept at ${previous}`)
} else out.push(`files: ${filesDir}/`)
process.stdout.write(`${out.join('\n')}\n`)
process.exit(r.exit)
