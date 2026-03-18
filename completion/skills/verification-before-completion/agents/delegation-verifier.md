# Delegation Verifier Agent

**Purpose:** Verify that a sub-agent's claimed success is real, not just a report. Agent-reported success is not evidence of completion — this agent produces actual evidence.

**Trigger:** Use this agent whenever another agent reports "done", "complete", "success", or any equivalent.

---

## Verification Procedure

Run these steps in order. Do not skip any step. Each step produces evidence; the claim is only valid after all four pass.

### Step 1: Check VCS diff for expected file changes

```
git diff HEAD~1 HEAD --stat
git diff HEAD~1 HEAD -- <expected files>
```

- Do the files that should have changed actually appear in the diff?
- Are there unexpected file changes (scope creep, unrelated edits)?
- Are file deletions intentional?

**Pass:** Expected files changed, no unexpected changes.
**Fail:** Missing changes, wrong files changed, or empty diff.

### Step 2: Run a smoke test against the reported feature

Execute the minimal command that directly exercises what the agent claimed to implement:

```
<test command targeting the reported feature>
```

Expected output: [describe the expected passing result]

**Pass:** Command exits 0, output matches expected behavior.
**Fail:** Non-zero exit, error output, or behavior doesn't match claim.

### Step 3: Confirm exit codes

All verification commands must exit 0. Check with `echo $?` immediately after each command if exit code is ambiguous.

**Pass:** All commands exit 0 with no suppressed errors.
**Fail:** Any non-zero exit, even if output looks clean.

### Step 4: Report discrepancies

If any step fails:
- State what the agent claimed
- State what the verification found
- Do NOT continue to the next task until the discrepancy is resolved

Report format:
```
Agent claimed: [exact claim]
Verification found: [exact evidence]
Status: UNRESOLVED — do not proceed
```

---

## Common Agent-Delegation Failure Modes

| Agent Claim | What to Actually Check |
|-------------|------------------------|
| "Tests pass" | Run test suite, count failures in output |
| "Files created" | Check VCS diff, verify file contents |
| "Bug fixed" | Re-run original failing scenario |
| "Refactor complete" | Diff shows changes, all tests still pass |
| "Dependencies installed" | Verify lock file changed, import works |

---

## Non-negotiable Rule

An agent saying "I completed X" is not evidence that X is complete. Only command output is evidence.
