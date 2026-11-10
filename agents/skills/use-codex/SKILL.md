---
name: use-codex
effort: medium
description: >-
  Use when a plan, diagnosis or review needs a cold second opinion from Codex, or Codex should do
  a task itself. Triggers: "codex한테도 물어봐", "codex 의견 받아줘", "codex한테 시켜",
  "다른 모델로 교차검증", "ask codex", "let codex do it".
compatibility:
  optional:
    - think-tool  # weigh each disagreement before settling it
scenarios:
  - "이 설계 codex한테도 물어봐줘, 우리랑 다른 의견 나오는지"
  - "버그 원인 진단, codex로 교차검증해줘"
  - "Get a second opinion from Codex on this migration plan"
  - "Ask codex to review this diff without telling it what we think"
  - "이 실패하는 테스트, codex한테 고치라고 시켜봐"
---

## Standing Mandates

- NEVER put your own answer, hypothesis or ranking in the brief. A second opinion that reads your conclusion agrees with it; the point is a reader who has not seen it.
- ALWAYS hand over the question and the material (paths to read, the diff, the error), the constraints that are facts, and the shape of answer wanted — nothing else.
- ALWAYS run it read only through the script unless the user asked for Codex to do the work. `--act` bypasses Codex's approvals and sandbox: it edits and runs commands in `--cwd` with no prompt. Use it only on the user's ask, in a tree whose other changes are committed or named, never for a second opinion.
- ALWAYS check an `--act` run yourself before calling it done: the `changed` list and its diff, `head_moved`, and the task's own check run fresh. Codex's "done" is a claim, not evidence.
- NEVER adopt the other opinion because it disagrees, nor dismiss it because it does. Each disagreement is settled by evidence you check (a file, a test, a command), and the report says which.
- NEVER ask again from inside a second opinion: the script refuses a nested call (`SECOND_OPINION_DEPTH`). The marker is an environment variable, so it stops this script, not a child that launches the other CLI by hand; Codex's read-only sandbox has no network, which is what keeps such a child from reaching a model. An `--act` child has a shell and the network, so its brief says not to call another agent.

# Use Codex — a second opinion from the other model

Claude Code asks Codex the same question, cold, and puts the two answers side by side.

## Process

1. **Frame the question.** One question the user cares about, in their words where possible.
   Write it before looking at your own answer again.
2. **Write the brief** to a scratch file (never into the repo):
   - the question;
   - what to read: paths, a diff (`git diff …`), the error text, the doc;
   - facts that constrain the answer (versions, what cannot change);
   - the answer shape: verdict first, reasons with the file:line they rest on, what would change it.
   Leave out: your answer, your suspect, "we think", leading phrasing ("isn't it true that …").
3. **Run it** from the directory the material lives in:
   ```sh
   node <this skill's dir>/../../scripts/ask.mjs --to codex --prompt-file <brief.md> --cwd <dir> [--act] [--attach a,b] [--model <m>] [--timeout 600]
   ```
   One JSON line back: `answer`, or `error` (not installed, not signed in, timeout, nested call).
   `sandbox_down: true` means Codex's sandbox could not start on this machine (bwrap under
   restricted user namespaces — Ubuntu's default) and it read nothing: run again with
   `--attach` naming the files, whose text then rides in the brief with line numbers. Attach
   only what the question needs. Any other error is reported as it is; the review goes on
   without the second opinion and says so.
4. **Compare.** Your answer and Codex's, point by point: agree · disagree · only one of us raised.
   For each disagreement, check the evidence yourself and settle it, or mark it open.
5. **Report** with the template below; then act only on what survived step 4.

### When Codex does the task (`--act`)

1. **Brief** = the task, the files it may change, the check that proves it (`node --test …`), and
   "do not commit, do not push, do not call another agent". Here your own plan may go in: it is an
   order, not a second opinion.
2. **Run** with `--act` (no `--attach`: it has every tool). Codex runs without its sandbox, so a
   machine where bwrap cannot start still works.
3. **Check** `changed` (git status lines that appeared or changed; `null` outside git) and
   `head_moved`. Read the diff of each file, rerun the check, and revert what is outside the brief.
4. **Report** what Codex changed, what you kept or reverted, and the check's count.

## Output Template

```
## Second opinion — codex (<model>, <seconds>s)

Question: <one line>

| Point | Claude | Codex | Settled by | Verdict |
|---|---|---|---|---|
| … | … | … | <file:line / test / command> | agree · Claude · Codex · open |

Only Codex raised: <items, each checked or marked unchecked>
What changes: <the decision or the fix, or "nothing — both agree on …">
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Writes a brief without its own answer, runs Codex read only, compares point by point | Say what the question is when it is not obvious |
| Settles each disagreement with evidence, says which side held | Decide the open ones |
| With `--act`, checks Codex's changes and the task's test itself, reverts what is outside the brief | Ask for it ("codex한테 시켜"); keep unrelated work committed |
| Reports a failed call plainly and continues without it | Install and sign in to `codex` once |

## Related Skills

- `agents:use-claude` — the same, from Codex (or another session) to Claude
- `agents:dispatching-parallel-agents` — several independent jobs at once, inside one model
- `think:devils-advocate` — an attack on a plan from the same model; it calls this automatically for a cold objection set
- `think:brainstorming` — its debate mode uses the other model as a debater, automatically
