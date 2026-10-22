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

// Bash commands the claude -p json envelope (or a stream-json result event) reports denied that
// the node needed and this adapter never blocked on purpose.
export function neededDenials(envelope) {
  const denials = Array.isArray(envelope?.permission_denials) ? envelope.permission_denials : [];
  return denials
    .filter(d => d?.tool_name === 'Bash' && typeof d.tool_input?.command === 'string')
    .map(d => d.tool_input.command)
    .filter(cmd => !DISALLOWED_PREFIXES.some(p => cmd.trim() === p || cmd.trim().startsWith(`${p} `)));
}
