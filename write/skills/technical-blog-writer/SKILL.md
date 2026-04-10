---
name: technical-blog-writer
description: >-
  Use when writing a technical blog post about something built, fixed, or
  learned. Triggers on: "기술 블로그 써줘", "개발 블로그", "technical blog", "글 쓰고 싶은데 어떻게
  시작해?", 이 경험 블로그로 쓰고 싶어", "engineering post", "회고 글", "튜토리얼 써줘", "개발 경험 공유".
scenarios:
  - "DB 장애 대응 경험 블로그로 쓰고 싶어"
  - "Kafka 도입 과정을 기술 블로그로 써줘"
  - "I want to write about how we cut latency by 40ms"
  - "React 마이그레이션 경험 공유하고 싶어"
  - "이 기술 결정 이유를 포스트로 정리해줘"
  - "Tutorial for the library I built"
compatibility:
  optional:
    - think-tool        # clarifying the core story and angle before drafting
  remote_mcp_note: >-
    think-tool이 있으면 작성 전에 블로그의 핵심 스토리와 각도를 명확히 정의할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Technical Blog Writer

## Why Technical Blogs Fail

Most technical posts never get read past the third paragraph. The cause is almost always structural, not technical: the post opens with context that the reader did not ask for, buries the interesting part, and ends without a reason to care.

Developer readers are impatient and skeptical. They arrive with a problem or a curiosity. If the first two paragraphs do not signal "this post is relevant to your situation," they leave. Good technical writing earns attention continuously — it does not assume it.

---

## Phase 0 — Extract the Core Story

Before writing anything, identify the one thing the post is really about:

1. What did you build, fix, or discover?
2. What was surprising, hard, or counterintuitive about it?
3. What would a reader do differently after reading this?

If all three answers are clear, there is a post. If the answer to #3 is "nothing specific," the post needs a sharper angle.

Ask the user these questions if the topic is still vague. Do not start drafting until there is a concrete answer to all three.

---

## Phase 1 — Outline

Every technical post follows this arc. The details change, but the arc does not.

### 1. Hook (1–3 paragraphs)
Opens with the situation, the problem, or the surprising discovery — not with "In this post, I will explain..."

Good hooks:
- A concrete moment: "We had 40ms P99 latency and needed 8ms. We had three days."
- A counterintuitive claim: "The bottleneck was not the database — it was the ORM."
- A relatable frustration: "Every Kubernetes tutorial skips the part where it stops working."

Bad hooks:
- Background history of the technology
- "First, let me introduce..."
- Definitions

### 2. Problem in Depth (1–2 sections)
Describe the situation with enough specificity that a reader facing something similar recognizes themselves. Include:
- What the system looked like before
- What broke, failed, or was missing
- Why naive solutions did not work

This section builds credibility. Readers trust writers who demonstrate they actually encountered the problem rather than synthesized it.

### 3. The Solution (core of the post)
Walk through the solution in the order you discovered it, not in the order of a clean explainer. The journey matters because it shows reasoning, not just conclusions.

Include:
- The key insight that unlocked the solution
- Code examples that are minimal and runnable (no placeholder logic)
- Diagrams described clearly if no image is available ("The request flows from the gateway → auth service → downstream handlers, each adding a span to the trace")
- Explicit tradeoffs: what this approach does not handle, and why that was acceptable

### 4. Results / Validation
Concrete outcomes. Numbers where possible. What changed for users, for the team, or for the codebase.

Avoid vague claims:
- Weak: "Performance improved significantly"
- Strong: "P99 dropped from 40ms to 7ms under 3k RPS load"

### 5. What You Would Do Differently
One paragraph on the lesson, written for the reader — not a recap of what you did, but the transferable insight.

### 6. Conclusion + Call to Action
End with one clear next step for the reader:
- A related resource to read next
- A question to prompt comments or discussion
- An invitation to try something ("If you hit the same issue, the diff is here: [link]")

---

## Phase 2 — Draft

Write the full post in the user's voice. Principles:

**Conversational but precise.** Use first person. Write short sentences when explaining concepts. Reserve long sentences for narrative. Avoid the passive voice unless necessary.

**Show personality.** A voice makes a post memorable. Dry technical writing is harder to finish. This does not mean jokes — it means a writer who sounds like a person rather than documentation.

**Avoid jargon walls.** When you introduce a technical term, define it in one clause the first time it appears. After that, use it freely.

**Code examples must be runnable or obviously so.** Pseudocode that cannot be adapted into real code is not a code example — it is a diagram without a diagram.

**Headings should be scannable.** A developer reading for the third time should be able to jump directly to the section they need using headings alone. Use specific headings, not generic ones:
- Weak: "The Solution"
- Strong: "Why Connection Pooling Fixed the Latency Spike"

---

## Phase 3 — Polish

Work through this checklist before the post is finished:

- [ ] The first sentence is interesting enough to earn the second sentence
- [ ] Every section heading tells the reader what they will get from reading it
- [ ] Code blocks have language tags and are consistent in style
- [ ] Numbers are present wherever a claim is quantitative
- [ ] Every technical term is defined on first use
- [ ] The conclusion answers "so what?" from the reader's perspective
- [ ] The post is under 2,000 words (unless the complexity genuinely demands more)

---

## SEO-Friendly Headings

For posts intended for search traffic, the H1 and H2 headings should contain the specific terms a developer would actually search. This is not keyword stuffing — it is using the language your reader uses.

- Weak H1: "A Journey into Performance"
- Strong H1: "How We Cut API Latency from 40ms to 7ms with Connection Pooling"

Put the core keywords near the front of the heading. Search engines and skimmers both read left-to-right.

---

## Length Guide

| Topic type | Target length |
|------------|---------------|
| Quick tip or single concept | 400–700 words |
| Full problem/solution narrative | 1,000–1,800 words |
| Deep dive or tutorial | 2,000–3,500 words |
| Series part (multi-part) | 1,000–1,500 words per part |

Longer is not deeper. Every paragraph should earn its place by adding information the reader does not already have.

---

## Common Mistakes

**Opening with motivation, not hook.** "I've been interested in distributed systems for a while" is not a hook. The reader's interest in you is proportional to what you have just given them — which at the opening is zero. Start with the situation.

**Explaining the solution without the problem.** Readers need to feel the problem before the solution is interesting. Spend real time on what broke and why it was hard before explaining the fix.

**Skipping the tradeoffs.** A post that presents only the happy path reads like documentation, not experience. Tradeoffs are where the real insight lives.

**Code blocks that are too long.** A 150-line code block in a blog post is unreadable. Show the key 10–20 lines with a comment pointing to the full version elsewhere.

**No call to action.** Readers who finish a post and have nowhere to go produce no engagement and no memory. End with something actionable.
