// One answer to "is this pid alive", shared by every surface that asks it (taskmanager's
// driverAlive, tickets.mjs). A zombie answers kill(pid, 0) like a live process:
// code-sprint-S2's daemon, killed while the MCP server that spawned it (detached, unref'd) never
// reaped it, sat <defunct> and read alive - so serviceDaemon never re-raised it and the task had
// no loop. On Linux /proc says so; where there is no /proc (macOS) the signal probe stands alone.
// No /proc: `ps -o stat= -p <pid>` says it (first char Z = zombie).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const procStatDefault = (pid) => readFileSync(`/proc/${pid}/stat`, 'utf8');
const psStatDefault = (pid) => {
  const r = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', timeout: 1000 });
  if (r.error || r.status !== 0) throw r.error || new Error('ps failed');
  return r.stdout;
};

// procStat/psStat are injectable for tests; each returns text or throws.
export function isZombie(pid, { procStat = procStatDefault, psStat = psStatDefault } = {}) {
  try {
    const stat = procStat(pid);
    const i = stat.lastIndexOf(')');
    return stat.slice(i + 2, i + 3) === 'Z';
  } catch (e) {
    if (!e || e.code !== 'ENOENT') return false;
  }
  try { return String(psStat(pid)).trim().slice(0, 1) === 'Z'; } catch { return false; }
}

// EPERM: the process exists and is not ours to signal - alive. Anything else: gone.
export function pidAlive(pid, readers) {
  if (!pid) return false;
  try { process.kill(pid, 0); } catch (e) { return !!(e && e.code === 'EPERM'); }
  return !isZombie(pid, readers);
}
