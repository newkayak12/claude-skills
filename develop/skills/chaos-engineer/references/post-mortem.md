# Post-mortem outline

Use after a game day or a real incident. Blameless: describe system conditions and decisions, not individuals.

## Sections

1. Summary: what happened, how long, how big, in three sentences.
2. Impact: users and functions affected, error budget consumed, data effects.
3. Timeline: timestamped events in UTC, including detection and each decision with the information available at that moment.
4. Causes: the trigger, then contributing conditions (missing timeout, shared pool, alert threshold, stale runbook). Ask "why" repeatedly until reaching something a team can change; stop at process or design, not at a person.
5. What worked: detection, mitigations, practices to keep.
6. What did not: gaps in tooling, knowledge, communication.
7. Surprises: behaviour nobody predicted; these are the highest-value items.
8. Actions: each with owner, due date, ticket link, and a prevent/detect/mitigate tag.
9. Follow-up: date when completion and effectiveness will be reviewed.

## Planned versus unplanned

- Game day: the timeline starts from a known injection, and the hypothesis is compared with the outcome. Impact is bounded by design.
- Real incident: reconstruct the timeline from logs and chat, add customer communication and escalation review, and expect disputed facts to be marked as uncertain.
