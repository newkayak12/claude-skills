---
name: list
description: >-
  Use when someone wants to see their skill achievements, progress toward locked ones, or which of
  their prompts should have triggered a skill. Triggers: "업적 보여줘", "내 트로피", "achievements",
  "trophy list", "어떤 스킬을 놓쳤지?", "스킬 사용 현황".
scenarios:
  - "내 업적 목록 보여줘"
  - "아직 못 딴 트로피가 뭐야? 얼마나 남았어?"
  - "최근 일주일에 내 프롬프트가 스킬을 못 불러낸 게 뭐야?"
  - "Show my skill achievements and progress"
  - "Which skills did my prompts miss this week?"
compatibility:
  optional: []
  remote_mcp_note: >-
    MCP 도구가 필요 없습니다. 파일 두 개만 읽습니다.
---

# trophy:list

Prints the same three groups as the `/achievements` pane, as a table, from the profile the trophy mod mirrors to disk.

---

## Process

**1. Read the profile.** `~/.claude/trophy/profile.json` — `{ updated, unlocked, progress, triggers7d }`. If the file is missing, say: the trophy mod records only in interactive Claude Code 2.1.292 or later with the `trophy` plugin enabled; nothing has been recorded yet. Stop.

**2. Read the catalog.** `../../data/achievements.ts` relative to this SKILL.md: each entry's `id`, `title`, `hidden`.

**3. Print the achievements.** One row per catalog entry, in catalog order:

- id in `unlocked` → `🏆 title · date`
- else `hidden` → `🔒 ???`
- else `🔒 title  ▓▓░░░ have/need` (`progress[id]`, five cells, filled = round(have/need × 5))

Header: `n / total 해금`.

**4. Print the trigger view.** From `triggers7d`: most hit, most missed (the routing gaps: the prompt had a trigger phrase and the skill did not run), and the count of skills never fired in the last 7 days with the first five names.

**5. Say when it was last updated** (`updated`). Do not edit the profile; it is the mod's file.

---

## Output Template

```
n / total 해금   (updated: <date>)

| 업적 | 상태 |
|------|------|
| 첫 스킬 | 🏆 2026-10-06 |
| 수집가 | 🔒 ▓▓▓░░ 6/10 |
| ??? | 🔒 |

가장 많이 맞은 스킬 (7일): skill · n …
가장 많이 놓친 스킬 (7일): skill · n …
한 번도 안 쓴 스킬: N개 (…, …)
```

---

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Reads the profile and the catalog, prints the table | Open a session with the trophy plugin enabled so the profile exists |
| Keeps hidden achievements as `???` until unlocked | Use skills; unlocks come from use, not from asking |
| Names the missed-trigger skills, without editing anything | Decide whether a missed skill's trigger phrase needs rewording |

## Related Skills

- `think:mentor` — when the missed-skill list raises a question about how you work
