# Does a repo-hook deny appear in `claude -p` `permission_denials`?

Answer: yes. A command refused by the project's `PreToolUse` hook is listed in `permission_denials`
with the same entry shape as a plain permission denial. Nothing in the entry says which refused it,
so `teams/mcp/denials.mjs` `neededDenials(envelope, cwd)` asks the project's hooks again.

This was **run, not seen in another session**: the two `claude -p` calls below were made from the
D11 worktree on 2026-10-28 (UTC), and their envelopes are pasted unedited.

## Run

- Claude Code: `2.1.312 (Claude Code)`
- cwd: the D11 package worktree of this repo (`.claude/settings.json` registers
  `node "$CLAUDE_PROJECT_DIR/.claude/hooks/repo-rules.mjs" bash` as the `Bash` PreToolUse hook)
- Started: 2026-10-28T09:09:46Z
- Command:

```sh
claude -p "Run these two Bash commands one after another, exactly as written, and report what happened. Command 1: perl -i -pe s/a/b/ _repo/docs/probe-nonexistent.txt . Command 2: touch tmp/probe-made.txt . If one is refused, still run the other." \
  --output-format json --permission-mode dontAsk --allowedTools "Bash(perl:*)" --model haiku
```

`Bash(perl:*)` is allowed, so a `perl` call cannot be a permission denial: only the hook can refuse
command 1. `touch` is not allowed and the mode is `dontAsk`: command 2 is a plain permission denial.
The target of command 1 does not exist, so nothing in the repo could change if the hook had allowed it.
`perl -i` is used because it is not on `DISALLOWED_BASH`; a `sed -i` entry is dropped by prefix before
any hook is asked (a first run with `sed -i s/a/b/ _repo/docs/probe-nonexistent.txt` listed both
commands the same way: `permission_denials` had the `sed -i` entry, shape identical, `is_error` false).

## Full envelope (stdout of the run, verbatim)

```json
{"duration_api_ms":9205,"stop_reason":"end_turn","session_id":"7c718d16-1828-44d9-bbd1-be0977519351","total_cost_usd":0.009315419999999998,"usage":{"input_tokens":6,"cache_creation_input_tokens":38252,"cache_read_input_tokens":116842,"output_tokens":992,"output_tokens_details":{"thinking_tokens":383},"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":38252,"ephemeral_5m_input_tokens":0},"inference_geo":"global","iterations":[{"input_tokens":2,"output_tokens":582,"cache_read_input_tokens":51864,"cache_creation_input_tokens":343,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":343},"type":"message"}],"speed":"standard","fallback_credit":null},"modelUsage":{"claude-haiku-5-5":{"inputTokens":6,"outputTokens":992,"cacheReadInputTokens":116842,"cacheCreationInputTokens":38252,"webSearchRequests":0,"costUSD":0.009315419999999998,"contextWindow":1000000,"maxOutputTokens":128000,"thinkingTokens":383,"cacheCreationEphemeral5mInputTokens":0,"cacheCreationEphemeral1hInputTokens":38252,"canonicalModel":"claude-haiku-5-5","provider":"firstParty","costBasis":"list"}},"permission_denials":[{"tool_name":"Bash","tool_use_id":"toolu_01PUKFkKKL3iJUkPCgbU7aX9","tool_input":{"command":"perl -i -pe s/a/b/ _repo/docs/probe-nonexistent.txt","description":"Run perl in-place edit probe on nonexistent file"}},{"tool_name":"Bash","tool_use_id":"toolu_01Ai8864JEnW2cM23wiBm5xP","tool_input":{"command":"touch tmp/probe-made.txt","description":"Create probe file under tmp directory"}}],"terminal_reason":"completed","fast_mode_state":"off","fast_mode_disabled_reason":"sdk_opt_in_required","subagent_stats":{"spawned":0,"requested":{"background":0,"foreground":0,"unset":0},"started_in_background":0,"max_depth":0,"spawned_by_subagents":0,"completed":0,"failed":0,"killed":{"parent":0,"user":0,"system":0},"refused":{"depth_limit":0,"concurrency_limit":0,"budget":0},"by_type":{}},"safety_stops":0,"is_error":false,"num_turns":3,"subtype":"success","api_error_status":null,"result":"Both commands were blocked, so neither probe ran as intended.\n\n1. **`perl -i -pe s/a/b/ _repo/docs/probe-nonexistent.txt`** was refused by a `PreToolUse:Bash` hook. The message: \"Bash perl writes `_repo/docs/probe-nonexistent.txt`, a repo file, in place. Use Read/Edit/Write for repo files; Bash is for git, checks and tests.\" This is the repo's rule against in-place writes to repo files via Bash (`.claude/rules/enforcement.md`, repo-rules.mjs). The hook refused it before perl ran, so the nonexistent file was not touched.\n\n2. **`touch tmp/probe-made.txt`** was denied by permission: \"Claude Code is running in don't ask mode.\" I did not try a workaround, such as creating the file with Write, because that would not be the probe you asked for and would sidestep the denial. No file was created.\n\nSo the probe confirmed that the hook catches an in-place `perl -i` on a repo path, and that Bash is denied in this session's permission mode. If you want the `touch` probe to run, approve Bash for this session or switch out of don't-ask mode and I'll run it again.","ttft_ms":3136,"type":"result","duration_ms":9553,"uuid":"f55a2c8e-3907-4fce-ac4d-1ca6007940a7","ttft_stream_ms":2023,"time_to_request_ms":168,"first_content_frame_ms":2024,"queued_turn_count":0,"result_index":0}
```

What it shows:

- `is_error` is `false`; the run ended `completed`. A hook deny does not fail the call.
- `permission_denials` lists both commands, in the same `{tool_name, tool_use_id, tool_input}` shape.
  The `perl -i` entry is the hook's deny (the `result` text quotes the hook's message); the `touch`
  entry is the `dontAsk` denial ("Claude Code is running in don't ask mode").
- Run against that envelope with the repo as cwd, `neededDenials` gives only `touch tmp/probe-made.txt`
  (with no cwd it gives both).

## Tests

`teams/scripts/test-denials.mjs` (5 of 5 pass):

- the recorded envelope shape: the hook-refused `perl -i` is dropped, the `dontAsk` `touch` is kept;
- documented limit: a command only a plugin `hooks.json` hook would refuse is kept, because
  `hookRefuses` reads `<cwd>/.claude/settings*.json` only (see the header of `teams/mcp/denials.mjs`).

`denials.mjs` logic is unchanged.

## `teams/scripts/test-dispatch-gate.mjs`, env vars unset and set

| Env | Command | Result |
|---|---|---|
| unset | `env -u HARNESS_NODE -u TEAMS_TASK_ID node --test teams/scripts/test-dispatch-gate.mjs` | 21 tests, 21 pass, 0 fail |
| `TEAMS_TASK_ID` set only (the run's own value, and `x`) | same, `HARNESS_NODE` unset | 21 pass, 0 fail |
| `HARNESS_NODE=implement` / `judge` / `gate` + `TEAMS_TASK_ID` | same | 21 pass, 0 fail each (the gate reads `HARNESS_NODE === '1'` only) |
| `HARNESS_NODE=1` + `TEAMS_TASK_ID` set | same | 21 tests, 15 pass, 6 fail |
| `HARNESS_NODE=1`, `TEAMS_TASK_ID` unset | same | 15 pass, 6 fail |

The 6 failures come from `HARNESS_NODE=1` alone; `TEAMS_TASK_ID` has no effect. The gate treats
`HARNESS_NODE=1` as "inside a run" and answers "stop and report" instead of the invoke text the tests
expect. Failing: 3 (a gated write with nothing open is denied), 8 (Codex MCP entry tools), 18, 19, 20,
21 (routing AC-1 to AC-4). Quoted output of test 3:

```
not ok 3 - a gated write with nothing open is denied, and the message says what to call
    The input did not match the regular expression /Skill\(\{skill: "teams:orchestrate"/. Input:
    'teams: src/a.mjs is under dispatch control and no task is open. You are inside a run. Do not invoke the harness skill, graph, teams, Workflow or open a run. Stop and report this block (file + reason) to your caller.\n'
```

Tests 18-21 fail the same way (`This project also dispatches through teams + harness; route by the
kind of work.`, `through teams + graph;`, `through teams + harness + graph;` and `Invoke the teams
entry skill now with the user's request` are each missing from that same "inside a run" message).
Test 8 expects exit 0 for a main session and gets 2. The tests that set `HARNESS_NODE`
themselves (`''` for a main session) pass; the ones that do not inherit it. This is the test
environment leaking, not a gate defect: run the file with `env -u HARNESS_NODE`. The test file is not
changed here.
