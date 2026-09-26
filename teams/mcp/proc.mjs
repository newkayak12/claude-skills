// One answer to "is this pid alive", shared by every surface that asks it (taskmanager's
// driverAlive, tickets.mjs, the viewer). A zombie answers kill(pid, 0) like a live process:
// code-sprint-S2's daemon, killed while the MCP server that spawned it (detached, unref'd) never
// reaped it, sat <defunct> and read alive - so serviceDaemon never re-raised it and the task had
// no loop. On Linux /proc says so; where there is no /proc (macOS) the signal probe stands alone.
import { readFileSync } from 'node:fs';

export function isZombie(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const i = stat.lastIndexOf(')');
    return stat.slice(i + 2, i + 3) === 'Z';
  } catch { return false; }
}

// EPERM: the process exists and is not ours to signal - alive. Anything else: gone.
export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); } catch (e) { return !!(e && e.code === 'EPERM'); }
  return !isZombie(pid);
}
