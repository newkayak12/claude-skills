# Shared artifacts and bounded work

Detail behind the handoff mandates in `SKILL.md`. These are caller obligations — the
broker enforces routing and adjudication, not briefing hygiene.

## One path, one snapshot

Resolve one absolute project path and run-artifact directory at run start, regardless
of which AI received the request. Give each executor an explicit working directory
and artifact paths. Implement, Test, and Gate for a task must inspect the same code
snapshot. Separate concurrently edited tasks into private worktrees and run an
assembled-goal gate after integration. Record the commit or diff identity with test
evidence so it cannot be applied to a different revision.

## What an Implement/Test briefing may contain

Deliver only the task's acceptance criteria, required source and dependency paths,
deterministic check commands, and relevant prior gate gaps. Do not forward the full
conversation, unrelated tasks, or full logs.

A path is not itself a token saving: the referenced briefing must also be scoped.
Keep implementation handoffs at most 1500 characters; save detailed evidence to files
and return paths with compact verdicts. If the task cannot fit a small briefing, return
it for further decomposition instead of expanding the executor's scope.

## Attempts and retries

Persist each attempt's artifacts separately. Test independently executes checks; Gate
compares evidence with the original acceptance criteria. Retry only unmet work within
the run's retry budget.

Do not weaken criteria to pass: a defective goal must return to SetGoal and Critique
with a recorded revision. Record token usage when the executor exposes it; do not claim
a hard token cap without runtime enforcement.
