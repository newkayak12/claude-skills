---
name: spec
effort: high
description: >-
  Use when a conversation already settled what to build and it needs to become a spec — synthesis, no interview.
  Triggers on: "방금 얘기한 거 spec으로 정리해줘", "대화 내용으로 스펙 써줘", "turn this conversation into a spec".
scenarios:
  - "We just went through the coupon changes in this thread — turn it into a spec"
  - "Here's the Slack discussion with PM; write the spec from it, don't re-ask what we covered"
  - "방금 PM이랑 나눈 대화야, 이걸로 spec 정리해줘"
  - "회의에서 정한 거 스펙 문서로 묶어줘, 질문은 나중에 몰아서"
compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 대화에서 결정된 것과 아직 열린 것을 가르는 판단을 더 꼼꼼히 할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- NEVER open with questions. The conversation is the interview; asking again what it already settled spends the
  user's patience on nothing. Every point it left open goes into the spec as `[확인 필요: <what, who decides>]`.
- NEVER fill an open point with a sensible default. "Round down" when the conversation said "ask finance" is a
  decision nobody made, and a spec is where it hardens into code.
- ALWAYS read the repo before writing: the glossary, the code and tests the conversation names, ADRs in the area.
  Measured 2026-10-06: without this skill, the same coupon conversation produced a spec in zero tool calls — it never
  opened `GLOSSARY.md` or the existing coupon code, so terms and test seams came from the chat alone.

Goal: every user story and decision traces to something said or to a file read; every open point is marked; the
closing tally recounts to the sections.

# Spec

**Not for:** co-writing a PRD, design doc, or RFC from scratch with reader testing, an ADR, a design review, or an
implementation plan (`write:plans`); breaking a spec into tickets.

## Process

1. **Read.** The conversation in full, then the repo: glossary or domain terms, the modules and tests the
   conversation names, ADRs nearby. Use the repo's terms in the spec.
2. **Sort.** For each point in the conversation: decided, deferred (explicitly out of scope), or open. Open means
   someone said "확인 필요", "ask X", "not sure", or two people disagreed without a resolution.
3. **Seams.** Name where the feature will be tested — prefer an existing seam, the highest one that exercises the
   behaviour, as few as possible. Say which tests already sit there.
4. **Draft** with the template. User stories only for behaviour the conversation supports; never pad the list.
   Implementation decisions name modules and contracts, not file paths or code — paths go stale before the spec does;
   a path belongs only in the `(source: …)` note.
5. **Recount.** Count stories, decisions, and `[확인 필요]` markers in the draft and write the tally line from that
   count.

Output goes to chat, or to a file the user names. Publish to an issue tracker only when asked.

## Output Template

```
# <Feature> — Spec

## Problem
<the user's problem, in their terms>

## Solution
<what changes, from the user's side>

## User stories
1. As a <actor>, I want <capability>, so that <benefit>

## Implementation decisions
- <module / contract / rule> — <decision> (source: <who said it, or file read>)

## Testing decisions
- Seam: <where> — prior art: <existing tests there>
- Cases: <behaviours to pin, incl. boundaries the conversation implies>

## Out of scope
- <deferred item> — <when / why, as said>

## Open questions
- [확인 필요: <question> — <who decides>]

stories n · decisions n · open n
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Reads the conversation and the repo, sorts decided / deferred / open | Paste or point to the conversation |
| Drafts the spec in the repo's terms, marks every open point | Take the `[확인 필요]` list to whoever decides |
| Names the test seam and the existing tests there | Confirm the seam before implementation starts |

## Related Skills

- `write:plans` — a doc co-written from scratch, an ADR, a design review, or the implementation plan after this spec.
- `develop:test-driven-development` — implementing the spec test-first at the named seam.
- `think:brainstorming` — the conversation hasn't settled what to build yet.
