# Incidents, Postmortems and Resilience Drills

Active-incident handling lives in the incident response skill and fault injection in the chaos skill; this file covers the reliability-program side.

## Roles and severity

| Severity | Trigger | Response |
|---|---|---|
| Sev1 | SLO budget burning at page rate, data loss, or full outage | all-hands bridge, status page updated every 30 min |
| Sev2 | Partial degradation, workaround exists | on-call plus owner, updates hourly |
| Sev3 | Minor, no user impact now | ticket, next business day |

Roles in a larger incident: commander (decides, does not debug), operations lead (hands on keyboard), communications lead (status updates), scribe (timeline). One person may hold several in a small incident; the commander must be named out loud.

First ten minutes: acknowledge, declare severity, open a channel, mitigate before diagnosing (roll back, flag off, fail over), post the first update.

## Blameless postmortem

Write within five working days, review in a meeting, publish to the whole engineering group.

```
Title / date / severity / authors
Summary: two sentences a non-engineer can follow
Impact: users, duration, SLO budget burned, revenue or data effects
Timeline (UTC): detection, page, mitigation, recovery - with how each was noticed
Contributing factors: several, systemic; never a person's name as cause
What went well / what was lucky
Detection gap: how long before a human knew, and why
Action items: owner, due date, ticket link, type (prevent / detect / mitigate)
```

Rules: describe actions in terms of what the system allowed, ask "why did this seem reasonable at the time", and limit action items to a few that will actually ship. Track completion; a postmortem whose items rot is worse than none.

## Resilience drills

Run drills against the recovery targets from the SLO work. Pick one hypothesis ("if the primary Postgres fails, writes resume within 60 s and no committed order is lost"), define abort conditions, announce the window, then:

1. Confirm steady state on the dashboards.
2. Inject one failure (stop the primary, block egress to a dependency, add latency).
3. Compare observed recovery time and data loss with RTO and RPO.
4. Restore, write up the gap, file fixes.

Start in staging, move to production at off-peak with a small blast radius once staging runs clean. A game day adds people: a scripted scenario, a facilitator who injects, responders who do not know the cause, and a debrief. Mature programs run small experiments continuously and treat every failed hypothesis as a bug.
