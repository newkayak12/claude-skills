# completion

**English** · [한국어](KOR.md)

One skill, for the moment right before you say "done". A completion claim made from the same
context that produced the work is the author grading their own paper: every ambiguous signal tilts
toward passing. This plugin closes that gap two ways — it forces a **verify-level** (an explicit
pass bar) before any check runs, and it hands the check to an **isolated subagent** whose context
never saw your reasoning, so the verdict is independent of your wish to be done.

## Install & Uninstall

```bash
/plugin install completion@newkayak12-claude-skills
/plugin uninstall completion@newkayak12-claude-skills
```

## Skills

### `verification-before-completion`

State the pass bar, delegate the check to a context that isn't yours, and claim only what the
returned evidence proves. Use it before any status statement — "tests pass", "build is green",
"bug is fixed", "ready to commit" — and before a commit, push, or PR. It is not a substitute for
having tests; it is the gate that decides whether their result may be spoken as a claim.

```
Retry backoff is implemented and I think the suite is green — verify it properly
before I open the PR.
```

The iron law: **no completion claim without a verify-level and isolated fresh evidence.** The gate,
with no skippable step:

```
0. LEVEL    Bar defined? harness project → .claude/conventions/verification.md,
            otherwise references/verification-patterns.md, else stand one up now.
1. ISOLATE  Fresh subagent per claim. Brief = {claim, verify-level, command} only.
2. RUN      Subagent runs the FULL command, captures raw output + exit code.
3. VERDICT  pass/fail against the bar, evidence attached — not "trust me".
4. GATHER   Multiple claims → N subagents in parallel, no shared context.
5. CLAIM    Assert only what the evidence supports.
```

Standing up a bar when none exists takes one line — *bug fixed* → the exact scenario that used to
fail now exits 0; *tests pass* → full suite exits 0 with zero failures (a subset run is "partial",
never "passing"); *build green* → exits 0 with no `error:` lines, warnings are not failures. An
ambiguous result after applying the bar counts as a **fail**: the burden of proof is on passing.

What does and does not settle a claim:

| Claim | Isolated evidence that settles it | Does NOT settle it |
|---|---|---|
| Tests pass | Full suite, 0 failures, exit 0 | An earlier run; "should still pass" |
| Bug fixed | The original failing case now passes | Code changed, therefore assumed fixed |
| Regression test real | Red-green proven (fails without the fix) | It passes once, direction unchecked |
| Subagent finished | You checked the VCS diff yourself | The subagent's "success" message |

Isolation quality matters as much as isolation itself: the moment "I'm pretty sure it works, just
confirm" leaks into the brief, the verifier is re-infected with your bias and the isolation is
fake. Supporting files: `agents/delegation-verifier.md` (the verifier brief spec) and
`references/verification-patterns.md` (default bars for ambiguous results).

## Harness relationship

This is the harness *judge ≠ actor* rule brought down to a single session. When the six-stage
engine runs, its Test stage does exactly this automatically — and mounts this skill statically to
do it. Solo, this skill **is** that stage.

---
