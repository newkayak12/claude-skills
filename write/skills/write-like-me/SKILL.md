---
name: write-like-me
description: >-
  Use when text must sound like the user wrote it, not a generic human, given their own samples.
  Triggers on: "내 말투로", "내가 쓴 것처럼", "내 문체로", "write it in my voice", "sound like me".
scenarios:
  - "이거 내가 평소 슬랙에 쓰는 말투로 바꿔줘"
  - "내 블로그 글 몇 개 줄 테니까 이 초안을 내 문체로 다시 써줘"
  - "팀장님께 보낼 메일인데 내가 쓴 것처럼 보이게 해줘"
  - "Rewrite this in my voice — here are three of my old posts"
  - "Make this cover letter sound like me, not like ChatGPT"
compatibility:
  optional:
    - think-tool        # deciding which profile traits are signal vs. one-off noise
  remote_mcp_note: >-
    think-tool이 있으면 샘플에서 뽑은 특징 중 어떤 것이 반복되는 습관이고 어떤 것이 한 번 나온
    우연인지 가를 때 씁니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER build a profile from fewer than two samples or under ~300 characters total. One sample is an anecdote; ask for another.
- NEVER use text the user drafted *with* an AI as a sample. Ask: "직접 쓴 글인가요?" when unsure. A profile learned from model output reproduces the model.
- ALWAYS match genre. Slack samples → Slack voice. A blog profile applied to an apology email is wrong even if accurate.
- ALWAYS extract the profile as observable counts and quotes, never adjectives. "Casual and friendly" is not a profile; "종결 70% `~요`, 20% `~다`, 문장 평균 18자, 문단당 1~2문장" is.
- NEVER import the user's typos, 비문, or 맞춤법 오류 as style. Keep 구어체 and 줄임말 they use on purpose; fix mistakes they would fix if they noticed.
- NEVER add content. Voice changes how it's said, never what's claimed — every fact, number, and name comes from the input text.
- ALWAYS detect before writing: `write:writer-verification` finds, this skill writes. Take its findings (span + tag + severity), never its suggested fix — its fix is a generic human's wording, not the user's.
- A finding that matches a profile trait is voice, not a tell — drop it and list it under *Kept as voice*.
- Goal: someone who knows the user reads the output and doesn't notice anything.

# Write Like Me

## Process

**1. Collect.**

| Need | Minimum |
|---|---|
| Target text | The draft or content to rewrite (or bullet points to write from) |
| Samples | 2–5 texts the user wrote alone, same genre as target, ≥ 300 chars total |
| Genre · reader | `slack` · `email` · `blog` · `pr` · `cover-letter` · `other` + who reads it |

Missing samples → ask once, with the genre named: "평소 이 채널에 직접 쓴 메시지 2~3개 붙여주세요."

**2. Detect.** Run `write:writer-verification` in review mode on the target text. Keep only the findings
list — span, tag, severity. Discard its fix column.

**3. Profile.** Read `references/voice-profile.md` and fill every row from the samples. Each trait needs
a count or a quote from at least two samples; a trait in one sample only goes under *uncertain*.

**4. Show the profile, in five lines max.** The user corrects it before any rewrite — they know their
voice better than the samples do ("요즘은 이모지 안 써요").

**5. Filter findings.** Drop any finding the profile explains (the user writes `~에 대해`, uses bold,
closes with a summary). What's left is the worklist.

**6. Write.** Close every 🔴🟡 on the worklist in the user's voice, then bring the rest of the text onto the
profile, in this order:
1. Structure — paragraph length, list vs. prose, opener and closer habits
2. Endings & register — 종결어미 distribution, 존댓말 level
3. Vocabulary — the user's recurring words in; words absent from every sample and on the machine-tell list out
4. Rhythm — sentence-length spread matches the samples (short/long mix, not uniform medium)

**7. Diff check.** Compare output against profile row by row. Any row off by more than the tolerance in
`references/voice-profile.md` → rewrite those sentences. Max two rounds.

**8. Deliver.**

## Output Template

```
[rewritten text — nothing above it]

---
Profile (N samples, genre): 종결 ~요 70% · 문장 평균 18자 · 문단 1–2문장 · 자주 쓰는 말: "근데", "일단" · 안 쓰는 것: 볼드, 이모지
Changed: [3–5 biggest shifts, e.g. "~할 수 있습니다" ×6 → "~돼요" · 헤더 3개 제거 · 결론 문단 삭제]
Detected: [worklist closed, e.g. 🔴 why 없음 · 🟡 헤더 3개 · 🟡 "~할 수 있습니다" ×6]
Kept as voice: [findings dropped because the samples do the same]
Uncertain: [traits seen in one sample only — confirm or drop]
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Asks for samples; refuses to guess your voice from nothing | Paste text you wrote alone, same genre as the target |
| Runs `writer-verification` to find what to fix, then fixes it in your words | Answer the one *why* question if detection says the reason is missing |
| Builds a counted profile and shows it before rewriting | Correct the profile — outdated habits, things you'd never say |
| Rewrites content-preserving; flags any trait it's unsure of | Read it once aloud; say which sentence "isn't me" |

## Related Skills

- `write:writer-verification` — the detector in step 2; use it alone (review or draft mode) when there are no samples
- `write:plans` (feedback purpose) — when the problem is what the feedback says, not how it sounds
- `write:plans` (blog purpose) — draft the post there, then match voice here
