// pidAlive (mcp/proc.mjs): a zombie is dead. code-sprint-S2's daemon sat <defunct> after it
// was killed and read alive to kill(pid, 0), so nothing ever re-raised it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pidAlive, isZombie } from '../mcp/proc.mjs';

test('pidAlive: this process is alive, a missing pid is not', () => {
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(0), false);
  assert.equal(pidAlive(2 ** 22 + 12345), false);
});

test('pidAlive: a zombie (exited, never reaped) reads dead', { skip: !existsSync('/proc/self/stat') && 'no /proc' }, async () => {
  // `sleep 0` exits at once; its parent then execs into `sleep 5`, which never waits on it.
  const sh = spawn('sh', ['-c', 'sleep 0 & echo $!; exec sleep 5'], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const pid = Number(await new Promise((res) => sh.stdout.once('data', (d) => res(String(d).trim()))));
    let zombie = false;
    for (let i = 0; i < 50 && !zombie; i++) { await new Promise((r) => setTimeout(r, 20)); zombie = isZombie(pid); }
    assert.equal(zombie, true, 'the orphaned child is <defunct>');
    let signalled = true;
    try { process.kill(pid, 0); } catch { signalled = false; }
    assert.equal(signalled, true, 'kill(pid, 0) still answers - the trap');
    assert.equal(pidAlive(pid), false);
  } finally {
    sh.kill('SIGKILL');
  }
});
