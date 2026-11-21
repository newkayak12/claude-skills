# Codex hook failures and compatibility gaps

Maintainer handoff for Claude · 2026-11-21 · checkout `0054efbb` · locally installed CLI `codex-cli 0.170.0`

## What the user saw

```text
• Hook failed
  └ plugin contents changed; hook approval required

• Hook failed
  └ hook exited with code 127

• Hook failed
  └ plugin contents changed; hook approval required
```

The first and third messages identify a trust decision. The middle message reports a process exit. The transcript gives no plugin name, event, command, or stderr for any of them. The recent local log sample yielded no matching hook diagnostic. The three messages could have different owners, including plugins outside this marketplace.

## Where to investigate

| Finding | Evidence in this checkout | What Claude should check |
|---|---|---|
| Cache freshness and hook approval are separate checks. | [sync-codex.mjs](../scripts/sync-codex.mjs) considers an enabled plugin current when its version directory exists. Its success message establishes neither byte equality with the checkout nor hook approval. | Before refreshing anything, record the active plugin, loaded path, version and hook command from Codex. Compare its manifest, hook configuration and script with the checkout. Review changed content through the client's hook approval UI. Then restart twice with identical bytes and check whether the prompt recurs. [OpenAI hook documentation](https://developers.openai.com/codex/hooks/) |
| Exit 127 needs the hook runner's stderr. | The [teams overlay](../../teams/hooks/codex.json) launches Node with a script under `${PLUGIN_ROOT}`. The [develop startup hook](../../develop/hooks/hooks.json) uses `sh`, a separate `args` array and `${CLAUDE_PLUGIN_ROOT}`. The installed develop 2.2.0 cache contains the Claude manifest and hooks, with no Codex overlay. | Identify the failing event and the configuration Codex actually loaded. Capture the expanded command, working directory, executable lookup and stderr in the failing client. A shell commonly returns 127 for a missing command, including a nested command. Neither example identifies the failing executable. |
| Some lifecycle behavior is specific to Claude Code. | The [shared trophy startup script](../../agents/hooks/ensure-trophy.sh) exits unless Claude marks the session attended. It reads Claude's install registry and invokes the Claude CLI. The Codex hook files for [session](../../session/hooks/codex.json), [think](../../think/hooks/codex.json) and [trophy](../../trophy/hooks/codex.json) each contain an empty hook map. | Document which startup behaviors Codex users should receive. For each required behavior, check it in an installed Codex session. Keep Claude's optional UI modules out of Codex hook configuration. |
| Teams write recording still lacks live Codex evidence. | The [teams README](../../teams/README.md) records parser coverage for `apply_patch` and explicitly leaves real-client recording unverified. The overlay registers both the pre-write gate and post-write recorder. | In a disposable fixture, exercise an allowed edit and a policy-denied edit through Codex. Verify the allowed path appears in the task's write record and the denied file stays unchanged. |

## Evidence to return with the fix

For each of the three messages, record the event, owning plugin and version, loaded hook path, and whether execution started. For the middle message include stderr and the executable that returned 127. Mark any attribution that remains unknown. After the user reviews the installed hooks, repeat the triggering actions in a fresh Codex session, retain the outcomes, and run the affected Claude checks listed in the [maintenance rules](../../.claude/rules/maintaining.md). Preserve the client's approval mechanism throughout.
