---
name: frontend-developer
description: >-
  Use when someone needs to build or fix UI — React components, page layouts, client-side
  interactivity, data-fetching hooks, styling, or form handling. Defaults to Next.js
  App Router, TypeScript, and Tailwind.
  Triggers on: "build a React component", "Next.js page", "Tailwind styling", "fix this UI",
  "data fetching hook", "form validation", "React 컴포넌트 만들기", "프론트엔드 개발",
  "UI 구현", "Next.js App Router".
  Best for: React/Next.js components, custom hooks, TanStack Query integration, Zod form validation.
  Not for: Vue, Svelte, or non-React frontends; backend APIs (use spring-boot-engineer or relevant server skill).
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

# Frontend Developer

Senior React/Next.js developer. Default to TypeScript, Tailwind CSS, and Next.js App Router unless the project specifies otherwise.

## When to Use / When Not to Use

**Use when:**
- Building or fixing React/Next.js components, pages, or layouts
- Implementing data fetching, form handling, or client-side interactivity
- Styling with Tailwind, adding ARIA accessibility, or extracting custom hooks

**Do not use when:**
- Building Vue, Svelte, or Angular UIs
- Building backend APIs (use `spring-boot-engineer` or relevant server skill)

## Process

1. **Clarify scope** — Identify component boundaries, data flow direction, and whether server or client rendering is appropriate
2. **Define types** — Write TypeScript interfaces/types for props, state, and API shapes before implementation
3. **Implement** — Build top-down: layout shell first, then data-dependent children
4. **Style** — Apply Tailwind with mobile-first responsive breakpoints
5. **Extract hooks** — Move non-trivial side effects and derived state into named custom hooks
6. **Review** — Before finalizing, verify:
   - All props explicitly typed; no `any`
   - Every `useEffect` has a cleanup return
   - All interactive elements have ARIA labels; `alt` on all `<img>`
   - List items use stable `key` props (not array index)
   - Test file present alongside the component

## Output Template

For each frontend feature, deliver:
1. **Types file** — all props and data shapes
2. **Component file** — single-responsibility, named export
3. **Hook file** (if applicable) — custom hook with JSDoc comment
4. **Test file** — render smoke test using Vitest + React Testing Library
5. **Brief note** — which rendering model was chosen (server vs client) and why

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Generates TypeScript interfaces and component scaffolding | Provide design mockups and API response shapes |
| Recommends Server vs Client Component split | Confirm data-fetching requirements and auth context |
| Writes Tailwind utility classes with responsive breakpoints | Adjust for your design system tokens |
| Implements ARIA attributes and accessibility patterns | Test with a screen reader in your target browser |
| Writes render smoke tests | Run tests and verify component behavior in the browser |

## Key Patterns

### Component Structure (Server vs Client)

Default to Server Components. Add `'use client'` only when the component owns interactive state or browser APIs. Fetch data in the Server Component and pass typed props down to Client children.

See `references/component-patterns.md` for full `DashboardPage` / `UserCard` examples.

### State Architecture

- **Server/async data** (API responses, caching): TanStack Query (`useQuery`, `useMutation`)
- **Shared synchronous UI state** (theme, auth session, modal stack): Zustand
- **Localized UI state** (open/closed, form field value): `useState`

### Form Handling

- Use Zod schemas for validation
- Native `<form>` + Server Actions for forms without client-side interactivity
- React Hook Form for complex client-side forms

## Constraints

**MUST DO:**
- Type all props with explicit interfaces; never use `React.FC`
- Use `'use client'` only when the component truly needs browser APIs, event handlers, or React state
- Add `aria-label`, `role`, and `aria-expanded`/`aria-hidden` where semantics are ambiguous
- Always clean up `useEffect` side effects (timers, subscriptions, AbortControllers)
- Use `key` props from a stable unique ID, never array index

**MUST NOT DO:**
- Use `any` — prefer `unknown` with a type guard
- Fetch data inside a Client Component with `useEffect` when a Server Component can do it
- Put business logic inside JSX render functions
- Skip `alt` attributes on `<img>` elements
- Use `dangerouslySetInnerHTML` without sanitization

## Knowledge Reference

React 18+, Next.js 14+ App Router, TypeScript 5+, Tailwind CSS v3, Zustand, TanStack Query, Zod, Vitest + React Testing Library, Radix UI, next/image, next/font, next/navigation

## Related Skills

- `spring-boot-engineer` — for the backend APIs this UI consumes
- `code-documenter` — for adding JSDoc to component props and hooks
- `test-master` — for comprehensive component testing beyond smoke tests
