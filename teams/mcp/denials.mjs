import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Tool denials of a `claude -p` call, shared by the worker adapter and the daemon's judge.
// The Bash verbs a read-only --verify node must not run. One list for the CLI flag and for the
// denial check: a denied command on it is the guard working, not a tool the node needed.
export const DISALLOWED_BASH = [
  'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git add:*)', 'Bash(git rm:*)',
  'Bash(git reset:*)', 'Bash(git checkout:*)', 'Bash(git merge:*)', 'Bash(git stash:*)',
  'Bash(git apply:*)', 'Bash(rm:*)', 'Bash(mv:*)', 'Bash(cp:*)', 'Bash(chmod:*)',
  'Bash(sed -i:*)',
];
export const DISALLOWED_PREFIXES = DISALLOWED_BASH.map(p => p.match(/^Bash\((.*):\*\)$/)[1]);

// A project PreToolUse hook's deny is listed in permission_denials like a permission denial, with
// nothing to tell them apart (probed live on claude 2.1.312: a repo-rules.mjs deny of `sed -i` and a
// dontAsk denial of `touch` have the same entry shape). So the only way to know a listed command was
// the guard working is to ask the same hooks again. Command hooks of <cwd>/.claude/settings*.json
// only; an unreadable settings file or a hook that fails to run is not a refusal.
function hookRefuses(command, cwd) {
  const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd });
  for (const file of ['settings.json', 'settings.local.json']) {
    let entries;
    try { entries = JSON.parse(readFileSync(join(cwd, '.claude', file), 'utf8'))?.hooks?.PreToolUse; } catch { continue; }
    for (const entry of Array.isArray(entries) ? entries : []) {
      let matches = false;
      try { matches = !entry.matcher || entry.matcher === '*' || new RegExp(`^(?:${entry.matcher})$`).test('Bash'); } catch { /* bad matcher */ }
      for (const h of matches && Array.isArray(entry.hooks) ? entry.hooks : []) {
        if (h?.type !== 'command' || typeof h.command !== 'string') continue;
        try {
          const out = execFileSync('sh', ['-c', h.command], { cwd, input, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } });
          if (JSON.parse(out || '{}')?.hookSpecificOutput?.permissionDecision === 'deny') return true;
        } catch (e) {
          if (e?.status === 2) return true;
        }
      }
    }
  }
  return false;
}

// Bash commands the claude -p json envelope (or a stream-json result event) reports denied that
// the node needed and this adapter never blocked on purpose. With `cwd`, a command the project's own
// PreToolUse hooks refuse is the guard working too, not a need.
export function neededDenials(envelope, cwd) {
  const denials = Array.isArray(envelope?.permission_denials) ? envelope.permission_denials : [];
  return denials
    .filter(d => d?.tool_name === 'Bash' && typeof d.tool_input?.command === 'string')
    .map(d => d.tool_input.command)
    .filter(cmd => !DISALLOWED_PREFIXES.some(p => cmd.trim() === p || cmd.trim().startsWith(`${p} `)))
    .filter(cmd => !(cwd && hookRefuses(cmd, cwd)));
}
