#!/usr/bin/env node
// Maintainer report: ranks diag_* events from PostHog project 649943.
// Usage: POSTHOG_PERSONAL_KEY=... node _repo/scripts/diag-report.mjs [--days 30] [--fixture <file>]
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const URL_ = 'https://us.posthog.com/api/projects/649943/query/'
const USAGE = 'usage: POSTHOG_PERSONAL_KEY=<key> diag-report.mjs [--days 30] [--fixture <file>]'

export const hogql = (days) =>
  `SELECT event, properties.skill, properties.tool, properties.plugin, properties.reason, ` +
  `sum(toInt(properties.count)) AS n, count(DISTINCT properties.day) AS days, ` +
  `count(DISTINCT distinct_id) AS installs FROM events ` +
  `WHERE event LIKE 'diag_%' AND timestamp > now() - INTERVAL ${days} DAY ` +
  `GROUP BY event, properties.skill, properties.tool, properties.plugin, properties.reason ` +
  `ORDER BY installs DESC, n DESC`

// rows: response `results` arrays [event, skill, tool, plugin, reason, n, days, installs]
export function rank(rows) {
  return rows
    .map(([, skill, tool, plugin, reason, n, days, installs]) => ({
      name: skill || tool || '-',
      plugin: plugin || '-',
      reason: reason || '-',
      count: Number(n) || 0,
      days: Number(days) || 0,
      installs: Number(installs) || 0,
    }))
    .sort((a, b) => b.installs - a.installs || b.count - a.count)
}

export function table(ranked) {
  const head = 'skill|tool · plugin · reason · count · days seen · installs'
  return [head, ...ranked.map((r) => [r.name, r.plugin, r.reason, r.count, r.days, r.installs].join(' · '))].join('\n')
}

export async function main(argv, env, fetchFn = fetch, out = console.log, err = console.error) {
  const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined)
  const fixture = arg('--fixture')
  const days = Number(arg('--days') ?? 30)
  if (!Number.isInteger(days) || days < 1) { err(USAGE); return 2 }
  let body
  if (fixture) {
    body = JSON.parse(readFileSync(fixture, 'utf8'))
  } else {
    const key = env.POSTHOG_PERSONAL_KEY
    if (!key) { err(USAGE); return 2 }
    const res = await fetchFn(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: hogql(days) } }),
    })
    if (!res.ok) { err(`posthog query failed: HTTP ${res.status}`); return 1 }
    body = await res.json()
  }
  out(table(rank(body.results ?? [])))
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), process.env)
}
