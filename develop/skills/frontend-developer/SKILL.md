---
name: frontend-developer
description: >-
  Use when building or fixing UI — React/Next.js components, layouts, hooks, forms (App Router, TypeScript, Tailwind
  defaults). Triggers on: "build a React component", "React 컴포넌트", "Next.js 폼". Not for Vue/Svelte/Angular.
scenarios:
  - "Build a React dashboard with data fetching, state management, and responsive layout"
  - "Help me fix this UI bug where the modal doesn't close properly on mobile"
  - "Implement a form with validation and error handling in our Next.js app"
  - "React 대시보드를 만들어줘 — 데이터 패칭과 상태 관리 포함"
  - "Next.js 폼 유효성 검사 구현을 도와줘"
compatibility:
  recommended: []
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 Server Component vs Client Component 경계 결정과 접근성 검토를
    더 체계적으로 수행합니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER call UI work done from reading the code. Run the project's type check, lint and tests and quote the results;
  anything only a browser shows (layout on mobile, focus order, screen-reader output) is written
  `not checked in browser: <what>`. A modal that does not close on mobile compiles and passes a render smoke test.
- NEVER add `'use client'` by default. Every client component ships its code and dependencies to the browser and
  gives up server-side data fetching; add it only for state, event handlers or browser APIs, and say which.
- NEVER use `dangerouslySetInnerHTML` with unsanitized input (XSS), and NEVER use `any` (use `unknown` plus a type
  guard): both switch off the checks that would catch the bug.
- NEVER invent an API response shape, design token or copy string. Read the types, the API client and the Tailwind
  config first; what is absent is `[확인 필요: ○○]`.
- Defaults (Next.js App Router, TypeScript, Tailwind) apply only when the repo does not say otherwise: read
  `package.json` and the config for versions and conventions.
- Goal: the type check and tests pass with the output quoted, and each review item (types, effects, a11y, keys, test
  file) is counted on the files touched.

# Frontend Developer

**Not for** Vue, Svelte or Angular, backend APIs (`develop:spring-boot-engineer` or the relevant server skill),
coverage beyond a smoke test (`develop:test-master`), or a UI bug of unknown cause (`develop:bug-diagnoser`).

## Process

1. **Clarify scope** — component boundaries, data flow direction, server or client rendering; read the repo's existing
   components first.
2. **Define types** — props, state and API shapes before implementation.
3. **Implement** — layout shell first, then data-dependent children. Fetch in Server Components and pass typed props
   down (`references/component-patterns.md`).
4. **Style** — Tailwind, mobile-first breakpoints.
5. **Extract hooks** — non-trivial effects and derived state into named custom hooks.
6. **State and forms** — server/async data: TanStack Query; shared synchronous UI state: Zustand; local state:
   `useState`. Forms: Zod schemas; Server Actions for forms with no client interactivity, React Hook Form for complex
   client forms.
7. **Review** — on the files touched:
   - no `any`; all props typed
   - every effect that starts a timer, subscription or request cleans it up (timers, listeners, `AbortController`)
   - interactive elements have accessible names and roles; `alt` on every `<img>`
   - list items use stable keys, not array index
   - a test file sits beside the component
8. **Recount** — count components, those passing each review item, and unchecked browser items; fix the tally if it
   differs.

## Output Template

```
## <feature>

1. Types file: props and data shapes
2. Component file: single responsibility, named export
3. Hook file (if any): custom hook with a short doc comment
4. Test file: render smoke test (Vitest + React Testing Library, or the repo's runner)
5. Rendering choice: server | client — why

Open: [확인 필요: ○○] ...

Components <n> · typed <t> · effects cleaned <e> · a11y <a> · stable keys <k> · tests <p>/<total>
Checked: tsc <ok|n errors> · lint <ok|n> | not checked in browser: <what>
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Writes types, components, hooks, Tailwind, smoke tests | Provide mockups and API response shapes |
| Recommends the server/client split | Confirm data-fetching and auth context |
| Adds ARIA and accessibility patterns | Test with a screen reader in your target browser |

## Related Skills

- `develop:spring-boot-engineer` — the backend API this UI consumes
- `develop:test-master` — component testing beyond smoke tests
- `develop:bug-diagnoser` — a UI bug whose cause is not yet proven
