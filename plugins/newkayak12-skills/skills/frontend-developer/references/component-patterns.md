# Component Patterns Reference

Annotated code examples for the frontend-developer skill. Each example is the canonical template; adapt names and Tailwind classes to the task at hand.

## Table of Contents

1. [Server Component + Client Component (DashboardPage / UserCard)](#server-component--client-component)
2. [Custom Hooks (useDebounce / useFetch)](#custom-hooks)
3. [Next.js App Router — loading.tsx / error.tsx](#nextjs-app-router--loading--error-boundaries)

---

## Server Component + Client Component

`DashboardPage` is a Server Component — it fetches data directly and passes it down. `UserCard` is a Client Component only because it owns interactive state (`expanded`).

```tsx
// app/dashboard/page.tsx — Server Component (default in App Router)
import { UserCard } from '@/components/UserCard'
import { getUser } from '@/lib/api'

interface PageProps {
  params: { id: string }
}

export default async function DashboardPage({ params }: PageProps) {
  const user = await getUser(params.id)  // fetch happens server-side, no useEffect needed

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <UserCard user={user} />
    </main>
  )
}

// components/UserCard.tsx — Client Component (only when interactivity required)
'use client'

import { useState } from 'react'

interface User {
  id: string
  name: string
  email: string
  avatarUrl?: string
}

interface UserCardProps {
  user: User
  onSelect?: (id: string) => void
}

export function UserCard({ user, onSelect }: UserCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <article
      className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md"
      aria-label={`User card for ${user.name}`}
    >
      <div className="flex items-center gap-3">
        {user.avatarUrl && (
          <img
            src={user.avatarUrl}
            alt={`${user.name} avatar`}
            className="h-10 w-10 rounded-full object-cover"
          />
        )}
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{user.name}</h2>
          <p className="text-xs text-gray-500">{user.email}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="mt-3 text-xs text-blue-600 underline-offset-2 hover:underline"
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>

      {expanded && onSelect && (
        <button
          type="button"
          onClick={() => onSelect(user.id)}
          className="mt-2 w-full rounded-lg bg-blue-600 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          Select user
        </button>
      )}
    </article>
  )
}
```

---

## Custom Hooks

### useDebounce

Delays propagating a value until the caller stops changing it. Cleans up via `clearTimeout` to avoid stale updates.

```tsx
// hooks/useDebounce.ts
import { useEffect, useState } from 'react'

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)  // cleanup prevents stale update
  }, [value, delayMs])

  return debounced
}
```

### useFetch

> **Note:** This is a teaching example for discriminated-union state. Prefer `useQuery` from TanStack Query when it is available in the project.

Generic client-side fetch with discriminated-union state. Use only when a Server Component cannot own the fetch (e.g., user-triggered, browser-only URL).

```tsx
// hooks/useFetch.ts — generic data fetching with loading/error state
import { useEffect, useReducer } from 'react'

type State<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string }

type Action<T> =
  | { type: 'FETCH' }
  | { type: 'SUCCESS'; payload: T }
  | { type: 'ERROR'; payload: string }

function reducer<T>(state: State<T>, action: Action<T>): State<T> {
  switch (action.type) {
    case 'FETCH':   return { status: 'loading' }
    case 'SUCCESS': return { status: 'success', data: action.payload }
    case 'ERROR':   return { status: 'error', error: action.payload }
    default:        return state
  }
}

export function useFetch<T>(url: string) {
  const [state, dispatch] = useReducer(reducer<T>, { status: 'idle' })

  useEffect(() => {
    let cancelled = false
    dispatch({ type: 'FETCH' })

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<T>
      })
      .then((data) => { if (!cancelled) dispatch({ type: 'SUCCESS', payload: data }) })
      .catch((err: Error) => { if (!cancelled) dispatch({ type: 'ERROR', payload: err.message }) })

    return () => { cancelled = true }  // prevent state update on unmounted component
  }, [url])

  return state
}
```

---

## Next.js App Router — Loading / Error Boundaries

Place these files alongside the route segment they cover (`app/users/loading.tsx`, `app/users/error.tsx`).

```tsx
// app/users/loading.tsx  — automatic Suspense boundary
export default function Loading() {
  return (
    <div className="flex items-center justify-center p-12" aria-label="Loading users">
      <span className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  )
}

// app/users/error.tsx  — must be a Client Component
'use client'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
      <p className="text-sm font-medium text-red-700">{error.message}</p>
      <button
        onClick={reset}
        className="mt-4 rounded-md bg-red-600 px-4 py-2 text-xs text-white hover:bg-red-700"
      >
        Try again
      </button>
    </div>
  )
}
```
