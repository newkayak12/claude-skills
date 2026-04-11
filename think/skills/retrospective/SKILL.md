---
name: retrospective
effort: high
description: >-
  Use when someone wants to reflect on a completed period to extract lessons and
  commit to improvements. Triggers on: "회고해줘", "스프린트 회고", "retrospective",
  "KPT", "잘된 것 못된 것 정리", 이번 프로젝트 돌아보기", "팀 회고", "무엇을 개선할 수 있을까", "5 whys", "근본
  원인 분석".
scenarios:
  - "이번 스프린트 회고 해야 해"
  - "프로젝트 끝났는데 뭘 배웠는지 정리해줘"
  - "We keep having the same problems — let's do a 5 Whys"
  - "이번 장애 근본 원인 파악해야 해"
  - "팀 회고 어떻게 진행해야 할지 도와줘"
  - "지난 분기 혼자 회고하고 싶어"
compatibility:
  recommended:
    - think-tool        # verifies Problem→Try completeness before final output
  optional:
    - sequential-thinking  # for 5 Whys causal chain — each step explicitly builds on the previous
  remote_mcp_note: >-
    think-tool이 있으면 최종 출력 전에 모든 Problem이 Try와 연결되었는지 검증합니다.
    sequential-thinking이 있으면 5 Whys 인과 체인을 단계별로 추적할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
related:
  - thought-organizer
  - decision-maker
  - first-principles
---
## Standing Mandates

- ALWAYS ensure every Problem item maps to at least one Try action before closing.
- ALWAYS distinguish systemic issues from one-time events — they require different responses.
- NEVER let the retro end without specific owners and due dates on every action item.
- NEVER run 5 Whys past the point where a systemic root cause is identified — deeper is not always better.


# Retrospective

Structured retrospective facilitator that turns reflection into actionable improvement.

## MCP Usage

- **When format = 5 Whys** → invoke `sequential-thinking` for the causal chain. Each "why" must explicitly build on the previous answer, making the chain auditable and allowing backtracking if a step turns out to be wrong.
- **Before generating the final output template** → invoke `think-tool` to verify every Problem has at least one mapped Try. This enforces the Problem→Try completeness check before output is produced.

---

## Core Workflow

> **Important:** Do NOT generate the full KPT output until Phase 2. In Phase 1, ask structured questions section by section and wait for user responses before moving on.
>
> **Data dump shortcut:** If the user has already provided retrospective data (e.g., pasted notes or a bullet list), skip Phase 1 and proceed directly to Phase 2, mapping the provided content to the chosen format.

### Phase 1: Facilitation (interactive)

Steps 1–3 require user input. Claude asks questions and waits for answers at each step before proceeding.

1. **Identify scope** — Clarify the retrospective type: sprint, project, weekly, monthly, or personal
   - Ask: time period, team or solo, any specific focus area (quality, velocity, communication)
   - *Wait for user response before continuing.*
2. **Select format** — Choose the best framework for context (see formats below)
   - Sprint/team → KPT
   - Root-cause investigation → 5 Whys
   - Long project or complex timeline → Timeline retrospective
   - *Confirm the chosen format with the user if there is ambiguity.*
3. **Collect data** — Gather events, outcomes, and feelings for the period
   - For KPT: ask about Keep items first, then Problem, then Try — one section at a time
   - *Wait for the user to finish each section before asking about the next.*

### Phase 2: Synthesis & Action (generative)

Steps 4–6 are independent work. Claude synthesizes gathered data and produces output without interrupting the user.

4. **Synthesize insights** — Group patterns, identify systemic issues, highlight wins
   - *Checkpoint:* Every Problem/issue must connect to at least one Try/action item before proceeding
5. **Define action items** — Produce SMART actions (Specific, Measurable, Assignable, Time-bound)
6. **Close the loop** — Summarize and link to next retrospective

---

## Retrospective Formats

### KPT (Keep / Problem / Try)

Best for: regular sprints, team retrospectives, quick reviews.

| Section | Question | Goal |
|---------|----------|------|
| **Keep** | What worked well and should continue? | Preserve strengths |
| **Problem** | What caused friction, delays, or quality issues? | Surface pain points |
| **Try** | What concrete experiments can address Problems? | Drive improvement |

Rules:
- Each Try must map to a Problem (write the mapping explicitly)
- Keep items can also generate Tries (amplify what works)
- Limit to 3–5 items per section to stay actionable

### 5 Whys

Best for: recurring problems, unexpected failures, root-cause analysis.

Process:
1. State the problem in one sentence
2. Ask "왜?" (Why?) and write the immediate cause
3. Repeat 5 times (stop earlier if root cause is clear)
4. Identify the root cause (usually the last "why")
5. Define a countermeasure targeting the root cause

Guard rails:
- Invoke `sequential-thinking` for the causal chain (see MCP Usage above)
- Stop early only if the root cause is already clear and evidence-based; do not stop just because a cause feels plausible
- Follow evidence, not assumptions — each step must be verifiable
- If a "why" branches into multiple causes, analyze each branch separately
- The countermeasure must address the root cause, not a symptom

### Timeline Retrospective

Best for: long projects (>4 weeks), complex releases, post-mortems.

Steps:
1. Draw a horizontal timeline with key milestones
2. Plot events as positive (above line) or negative (below line)
3. Annotate emotions/energy level at each event
4. Identify patterns: where did energy drop? what preceded failures?
5. Extract 2–3 systemic insights from the patterns
6. Derive action items from the insights

---

## Action Item Format

Every action item must follow this structure:

```
[ACTION] <verb + specific outcome>
- Owner: <person or role>
- Due: <date or next sprint>
- Success metric: <how we know it's done>
- Maps to: <Problem/issue it addresses>
```

---

## Output Template and Examples

See `references/output-templates.md` for the standard output template and a concrete sprint retrospective example.

For solo retrospective adjustments, see `references/solo-retro.md`.

---

## Constraints

### MUST DO
- Always produce at least one concrete action item with owner and due date
- Map every Try/action to a specific Problem or opportunity
- End every retrospective with a "다음 회고" section to close the loop
- Keep the tone constructive — focus on systems, not blame
- For 5 Whys, verify each "why" is evidence-based before proceeding
- Use think-tool before generating the final output to verify Problem→Try completeness

### MUST NOT DO
- Stop at reflection without action items
- Accept vague actions ("더 잘하기", "커뮤니케이션 개선") — push for specificity
- Skip the insight synthesis step — patterns matter more than individual events
- Produce more than 5 action items per retrospective (focus beats volume)
- Re-ask for data the user has already provided in their opening message

---

## Group Facilitation

When the retrospective is a live team session (not a solo reflection), the facilitator role changes. The job is not to produce the retrospective — it is to create the conditions in which the team produces it.

### Before the Session

Prepare a run-of-show with explicit timeboxes. Without a visible clock, groups spend 40 minutes on one item and rush or skip the rest.

Example 60-minute sprint retrospective run-of-show:
```
00:00 – 05:00  Check-in (how is everyone arriving?)
05:00 – 15:00  Data gathering (each person adds items silently to sticky notes)
15:00 – 25:00  Grouping and reading aloud (no discussion yet)
25:00 – 40:00  Discussion (facilitator picks top clusters)
40:00 – 50:00  Action item generation
50:00 – 58:00  Prioritization (dot voting)
58:00 – 60:00  Close and ownership assignment
```

Announce the timebox for each segment at the start. Enforce the clock — it is the facilitator's most important tool.

### Establishing Psychological Safety

A retrospective where people only say safe things produces only safe actions. Create conditions for honesty:

- **Start with a check-in question** that is low-stakes but personal ("On a scale of 1–5, how did this sprint feel? Why?"). This normalizes speaking before the harder questions arrive.
- **Use anonymous input channels** when the team is new, has hierarchy present, or has recent conflict. Tools: anonymous sticky notes, a shared document, Mentimeter, or EasyRetro with names hidden.
- **Separate data gathering from discussion.** Collecting items silently (everyone writes independently before sharing) prevents anchoring — the first person to speak does not set the frame for everyone else.
- **Name the purpose explicitly**: "This session is for improving how we work together, not for assigning blame. Everything stays in the room."

### Handling Dominant Voices

In most team retrospectives, 2–3 people speak first and most. The others follow or stay silent. This produces a retrospective that reflects those 2–3 people's experience, not the team's.

Techniques to counter this:

- **Round-robin for initial input**: "Let's go around once. Everyone shares one item from their Keep list — no discussion yet."
- **Directed questions to quieter members**: "Minjun, I haven't heard from you on this one — what was your experience?"
- **Parking lot for tangents**: When one person goes long on a specific incident, write it down and say "I want to make sure we capture that — let's put it in the parking lot and come back at the end."
- **Visible time allocation**: If one person has spoken for 3 of the last 5 minutes, the timebox pressure becomes a natural social cue to invite others.

### Synthesis Techniques

**Dot Voting (Dotmocracy)**
After all items are visible, give each team member 3–5 dot stickers (physical or virtual). Each person places dots on the items they believe deserve action most. Count dots. Discuss the top 3 — do not try to discuss everything.

Dot voting is not democratic consensus — it is a prioritization filter. The top items get discussion time. The others may still get captured as parking lot items.

**Affinity Mapping**
When the board has many similar-sounding items, group them before discussion. Read each item aloud, ask "Does anyone see this as related to another item here?" Move related items into clusters. Name each cluster with one phrase that captures the shared theme.

Affinity mapping shifts the conversation from "this one thing happened once" to "here is a systemic pattern." Systemic patterns produce systemic action items. One-off incidents rarely do.

### Closing the Group Session

End with:
1. **Named owners for every action item** — "team" as owner means no one owns it
2. **Read the action list aloud** — this creates shared memory and makes the commitment public
3. **Date of the next retrospective** — close the loop explicitly

After the session, send a written summary within 24 hours: action items, owners, due dates. Memory fades fast. The summary is the contract.

## Related Skills

- `thought-organizer` — 회고에서 나온 산발적 인사이트를 구조화하고 문서화할 때
- `decision-maker` — 회고에서 도출된 개선 방향 중 무엇을 먼저 실행할지 결정해야 할 때
- `first-principles` — 같은 문제가 반복될 때, 근본 가정부터 다시 분해해 근본 원인을 찾고 싶을 때
