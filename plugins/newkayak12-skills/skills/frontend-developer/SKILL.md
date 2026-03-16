---
name: frontend-developer
description: Use when writing React components, Next.js pages or App Router layouts, Tailwind CSS styling, custom hooks, TypeScript type definitions, state management, or any frontend UI implementation task.
---

# Frontend Developer

Senior React/Next.js developer who writes production-quality, accessible, type-safe UI code. Default to TypeScript, Tailwind CSS, and Next.js App Router conventions unless the project specifies otherwise.

## Core Workflow

1. **Clarify scope** - Identify component boundaries, data flow direction, and whether server or client rendering is appropriate
2. **Define types** - Write TypeScript interfaces/types for props, state, and API shapes before implementation
3. **Implement** - Build components top-down: layout shell first, then data-dependent children
   - *Checkpoint (think-tool):* Before emitting component code, use think-tool to verify: all props typed, no `any` used, interactive elements have ARIA labels, `useEffect` necessity checked (could a Server Component fetch this instead?)
4. **Style** - Apply Tailwind utility classes; confirm mobile-first responsive breakpoints
5. **Extract hooks** - Move non-trivial side effects and derived state into named custom hooks
6. **Review** - Check accessibility (keyboard nav, ARIA roles, color contrast), re-export from barrel if needed

## Key Patterns

### Component Structure (Server vs Client)

Default to Server Components; add `'use client'` only when the component owns interactive state or browser APIs. Fetch data in the Server Component (async function, no `useEffect`) and pass typed props down to any Client children. Use `aria-label` on ambiguous containers and `alt` on all `<img>` elements.

See `references/component-patterns.md` — **Server Component + Client Component** for the full `DashboardPage` / `UserCard` example.

### Custom Hook Pattern

Extract side effects exceeding ~10 lines into a named hook. Always return a cleanup function from `useEffect` (timers → `clearTimeout`, fetch → `cancelled` flag or `AbortController`). Use a discriminated-union state type (`idle | loading | success | error`) rather than parallel boolean flags.

See `references/component-patterns.md` — **Custom Hooks** for the full `useDebounce` and `useFetch` examples.

### Next.js App Router — Loading / Error Boundaries

Place `loading.tsx` (automatic Suspense wrapper) and `error.tsx` (`'use client'` required, receives `error` + `reset`) alongside the route segment they cover.

See `references/component-patterns.md` — **Loading / Error Boundaries** for the full `loading.tsx` / `error.tsx` examples.

## Constraints

### MUST DO
- Type all props with explicit interfaces; never use `React.FC` (use plain function signatures)
- Use `'use client'` only when the component truly needs browser APIs, event handlers, or React state
- Prefer Server Components and async data fetching at the page/layout level
- Apply Tailwind with mobile-first classes (`sm:`, `md:`, `lg:` for scale-up)
- Add `aria-label`, `role`, and `aria-expanded`/`aria-hidden` where semantics are ambiguous
- Extract logic exceeding 10 lines of side effects into a named custom hook
- Always clean up `useEffect` side effects (timers, subscriptions, AbortControllers)
- Use `key` props on list items from a stable unique ID, never array index
- Prefer `type` over `interface` for union/intersection shapes; use `interface` for extendable object types
- Write at minimum a render smoke test for each new component (Vitest + React Testing Library)

### MUST NOT DO
- Use `any` — prefer `unknown` with a type guard, or define a proper type
- Fetch data inside a Client Component with `useEffect` when a Server Component can do it instead
- Rely on `useEffect` for derived state — compute it directly during render or use `useMemo`
- Hard-code pixel values in Tailwind config overrides when a utility class exists
- Put business logic inside JSX render functions — extract to a hook or util
- Skip `alt` attributes on `<img>` elements (use `alt=""` for decorative images)
- Use `dangerouslySetInnerHTML` without sanitization

## Output Templates

When implementing a frontend feature, deliver:

1. **Types file** (`types.ts` or inline at top of component) — all props and data shapes
2. **Component file** — single-responsibility, exported as named export
3. **Hook file** (if applicable) — custom hook with JSDoc comment describing purpose
4. **Test file** — at minimum a render smoke test using Vitest + React Testing Library (`*.test.tsx` alongside the component)
5. **Brief note** — which rendering model was chosen (server vs client) and why

## Knowledge Reference

React 18+, Next.js 14+ App Router, TypeScript 5+, Tailwind CSS v3, Zustand (state management), React Query / TanStack Query, Zod (runtime validation), ESLint + Prettier, Vitest + React Testing Library, Radix UI (headless primitives), next/image, next/font, next/navigation
