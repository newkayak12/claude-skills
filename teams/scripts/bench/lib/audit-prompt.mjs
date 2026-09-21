// The post-hoc adversarial-audit prompt: one independent reviewer, blind to which arm produced
// the tree, whose job is to find defects that survived into the deliverable. Kept in its own
// module so audit.mjs stays about process plumbing and this stays about what is being asked.
export function buildAuditPrompt(requestText) {
  return `You are a hostile reviewer auditing a codebase that was built to satisfy the request below. Your job is to find defects the author shipped - not to admire the work, not to suggest improvements. You do not know who or what built this tree, and that is deliberate: judge only what is here.

ORIGINAL REQUEST:
"""
${requestText}
"""

Rules:
- You MUST verify by execution, not by reading. Run the test suite first. Then probe with inputs the request implies but the tests may not cover: edge cases, precedence/priority rules, the invocation matrix (direct path, realpath, a symlink to it, different cwd), empty input, whitespace-only input, CRLF line endings, unicode, a huge input, a missing file, an unreadable file (chmod 000).
- Check every explicit rule and contract stated in the request against actual behavior, one by one.
- A defect must have a repro that you actually ran and that actually failed. Do not report a defect you did not execute.
- Style opinions, missing features the request never asked for, and "could be improved" are NOT defects - put anything like that in notes instead, not in defects[].
- checks_run should list only commands/inputs you actually executed, each with its result, not a plan of what you intended to run.

Output ONLY this JSON, nothing else (no prose before or after it):
{"defects":[{"id":"D1","severity":"blocking|major|minor","rule":"<the request sentence or implied contract violated>","repro":"<exact command or input>","observed":"<actual behavior>","expected":"<expected behavior>"}],"checks_run":["<cmd -> result>", "..."],"tests":{"pass":<n>,"fail":<n>},"notes":"<at most 300 chars>"}`;
}
