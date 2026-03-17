---
name: thought-organizer
description: Use when someone wants to organize scattered thoughts, structure an idea, create an outline before writing, untangle a complex concept, or says things like "생각 정리 도와줘", "이 아이디어 정리해줘", "복잡한데 어떻게 구성할까", "머릿속이 복잡해". Invoke for mind mapping, outlining, concept structuring.
---

# Thought Organizer

Takes messy, scattered input — rough notes, half-formed ideas, stream-of-consciousness text — and produces clear, structured output with hierarchy, connections, and a distilled core message.

## Core Workflow

1. **Absorb** — Read all input without filtering. Identify every distinct idea, no matter how fragmented.
2. **Extract atoms** — Pull out the smallest meaningful units (claims, questions, observations, feelings).
   - *Checkpoint:* Have you captured everything, including implicit assumptions? If not, ask one focused clarifying question before continuing.
3. **Cluster** — Group atoms by theme or relationship. Name each cluster with a short label.
4. **Rank** — Identify the single core claim or goal. Mark supporting ideas vs. tangential ones.
5. **Structure** — Choose the right output shape (see Techniques below) and build the hierarchy.
6. **Surface gaps** — Note what is missing, contradictory, or unresolved. Flag explicitly.
7. **Deliver** — Present the structured output, then offer next steps (expand a section, convert to draft, add sources).

## MCP Usage

- **sequential-thinking:** Invoke for steps 3–5 when input contains more than ~5 distinct ideas or the user explicitly requests a structured breakdown. Each step's output should be passed explicitly as input to the next.
- **think-tool:** Invoke at step 6 (Surface gaps). Use it to enumerate contradictions, missing evidence, and unresolved tensions before delivering output.

## Technique Selection

Choose the output shape before structuring. Use this table:

| Situation | Technique |
|---|---|
| Goal is a document, essay, or presentation | Outline |
| User says "map" or input has no clear hierarchy | Mind Map |
| 5+ ideas with named cross-links or a knowledge-base goal | Zettelkasten |
| User needs only the core message, not full structure | Core Claim Extraction |

## Techniques

### Outline (default for writing prep)

Use numbered hierarchy. Start with the core claim as the title.

```
Core Claim / Title
  1. First main point
     1.1 Supporting detail
     1.2 Example
  2. Second main point
     2.1 ...
  3. Counterargument or tension
  Conclusion / So what?
```

### Text Mind Map (for visual thinkers)

Use indented branching. Center node first, branches radiate out.

```
[CENTER: Core topic]
├── Branch A
│   ├── Sub-idea A1
│   └── Sub-idea A2
├── Branch B
│   └── Sub-idea B1
└── Branch C (tension / open question)
```

### Zettelkasten-style Concept Linking

For complex ideas with many cross-connections. Each atom gets an ID and explicit links.

```
[001] Core claim: ...
[002] Supporting evidence → links to [001]
[003] Counterexample → challenges [001], see also [004]
[004] Resolution or reframe → synthesizes [001] + [003]
[?]   Open question: ...
```

Use this when ideas recur across different contexts or the user wants to build a knowledge base rather than a single document.

### Core Claim Extraction

When the user just needs the essence:

```
핵심 주장: [one sentence]
근거:
  - ...
  - ...
반론 가능성: ...
다음 질문: ...
```

## Concrete Examples

### Example 1 — Messy Input to Outline

**Input:**
> "앱 만들고 싶은데, 사람들이 독서 기록을 남기는 거. 소셜 기능도 있으면 좋겠고, 근데 너무 복잡해질 것 같고, 일단 혼자 쓸 수 있어야 하고, 나중에 친구한테 추천도 하고 싶고, 책 표지 이미지도 넣고 싶어."

**Output:**
```
독서 기록 앱

1. 핵심 가치: 개인 독서 이력 관리
   1.1 책 검색 및 등록 (표지 이미지 포함)
   1.2 독서 상태 추적 (읽는 중 / 완료 / 읽고 싶음)
   1.3 메모 및 감상 기록

2. 소셜 기능 (2단계)
   2.1 친구에게 책 추천 공유
   2.2 독서 피드 (선택적 공개)

3. 미결 사항
   - 소셜 기능은 MVP 이후로 분리할 것 (복잡도 관리)
   - 책 데이터 소스 결정 필요 (Open Library, 알라딘 API 등)
```

See `references/examples.md` for more examples: essay framing and philosophical concept linking.

## Output Format Rules

- Always start with the **structured output** — do not summarize the input back to the user first.
- Label clearly: outline, mind map, concept map, or core claim extraction.
- Flag gaps or contradictions with a dedicated section (미결 / Open Questions).
- Keep language consistent with the user's input language (한국어 입력 → 한국어 출력).
- Offer one concrete next step at the end (e.g., "이 아웃라인으로 초안 써드릴까요?").

## Constraints

### MUST DO
- Preserve the user's original intent — do not impose a narrative
- Separate facts/claims from feelings/attitudes when both are present
- Make hierarchy explicit (numbering, indentation, IDs)
- Surface contradictions rather than smoothing them over
- Ask at most one clarifying question if input is too sparse to structure

### MUST NOT DO
- Do not paraphrase the raw input back without structuring it
- Do not add ideas the user did not express
- Do not pick a structure type without considering what serves the content best
- Do not skip the "gaps" step — unresolved tensions are valuable
