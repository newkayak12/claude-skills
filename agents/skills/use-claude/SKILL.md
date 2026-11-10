---
name: use-claude
effort: medium
description: >-
  Use when a plan, diagnosis or review in Codex needs an independent second opinion from Claude,
  read cold. Triggers: "claude한테도 물어봐", "claude 의견 받아줘", "다른 모델로 교차검증", "second
  opinion from claude", "ask claude".
compatibility:
  optional:
    - think-tool  # weigh each disagreement before settling it
scenarios:
  - "이 리뷰 결과 claude한테도 물어봐줘"
  - "codex에서 짠 계획, claude로 교차검증해줘"
  - "Get a second opinion from Claude on this refactor"
  - "Ask claude what it thinks caused this failure, without our guess"
---

## Standing Mandates

- NEVER put your own answer, hypothesis or ranking in the brief. A second opinion that reads your conclusion agrees with it; the point is a reader who has not seen it.
- ALWAYS hand over the question and the material (paths to read, the diff, the error), the constraints that are facts, and the shape of answer wanted — nothing else.
- ALWAYS run it read only through the script: Claude gets Read, Grep and Glob, every other tool is denied, and no session is kept. Acting on the opinion is your job, after the comparison.
- NEVER adopt the other opinion because it disagrees, nor dismiss it because it does. Each disagreement is settled by evidence you check (a file, a test, a command), and the report says which.
- NEVER ask again from inside a second opinion: the script refuses a nested call (`SECOND_OPINION_DEPTH`). Claude's child has no shell, so it cannot start the other CLI by hand.

# Use Claude — a second opinion from the other model

Codex (or any session with a shell) asks Claude the same question, cold, and puts the two answers
side by side.

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
   node <this skill's dir>/../../scripts/ask.mjs --to claude --prompt-file <brief.md> --cwd <dir> [--attach a,b] [--model opus|sonnet] [--timeout 600]
   ```
   Claude has only Read, Grep and Glob (`--tools`), no MCP server, no session kept; `--attach`
   puts the files' text into the brief when Claude should not open anything else.
   One JSON line back: `answer`, or `error` (not installed, not signed in, timeout, nested call).
   An error is reported as it is; the work goes on without the second opinion and says so.
4. **Compare.** Your answer and Claude's, point by point: agree · disagree · only one of us raised.
   For each disagreement, check the evidence yourself and settle it, or mark it open.
5. **Report** with the template below; then act only on what survived step 4.

## Output Template

```
## Second opinion — claude (<model>, <seconds>s)

Question: <one line>

| Point | Codex | Claude | Settled by | Verdict |
|---|---|---|---|---|
| … | … | … | <file:line / test / command> | agree · Codex · Claude · open |

Only Claude raised: <items, each checked or marked unchecked>
What changes: <the decision or the fix, or "nothing — both agree on …">
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| The asking agent (Codex here) writes a brief without its own answer, runs Claude read only, compares point by point | Say what the question is when it is not obvious |
| Settles each disagreement with evidence, says which side held | Decide the open ones |
| Reports a failed call plainly and continues without it | Install and sign in to `claude` once |

## Related Skills

- `agents:use-codex` — the same, from Claude Code to Codex
- `agents:dispatching-parallel-agents` — several independent jobs at once, inside one model
- `think:devils-advocate` — an attack on a plan from the same model
