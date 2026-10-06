# Game days

A game day is a scheduled, supervised session where a team deliberately triggers failures and practises response. It tests people and runbooks as much as software.

## Preparation

- One theme per session, such as primary database failover.
- Roles: facilitator (runs the clock, owns abort), operators (the on-call responders, who may not know the exact fault), injector (applies faults), scribe (timestamps events).
- Prior runs of the same fault in staging so the day is not the first execution.
- Fixed window, comms channel, and an explicit "end exercise" word.
- Verify monitoring, alert routing, and runbook access beforehand; fix gaps first, they are findings but not worth session time.

## Running it

1. Brief: scope, safety rules, abort criteria. No surprises on safety.
2. Inject scenario one. Operators respond using real tools and runbooks.
3. The scribe records: injection time, first alert, first human action, diagnosis, mitigation, recovery.
4. Stop at recovery or at the time-box. Facilitator aborts immediately if abort criteria trip.
5. Short debrief after each scenario while memory is fresh; ask what the operators believed was happening at each step.

Scenario ideas that vary difficulty: primary DB loss, network partition between app and DB, connection leak that slowly exhausts a pool, dependency returning slow responses, expired credential, a bad config push.

Use an unannounced scenario only after the team has done announced ones, and still inside the safety rules.

## Measures

- time to detect, time to diagnose, time to mitigate, time to full recovery
- whether alerts fired on symptoms users feel, and who was paged
- runbook steps that were wrong, missing, or unused
- customer impact in staging terms: error ratio and duration

## Output

Follow `post-mortem.md` for the report. Every action item gets an owner and a date; schedule a repeat of the same scenario after fixes land.
