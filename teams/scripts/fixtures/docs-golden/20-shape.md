---
key: E-aaaaaaaa
state: DONE
updated: 2025-09-16T05:20:00.000Z
source: task.json@12
---

# Shape

Acceptance:
- both modules build together

| id | title | flow | deps | touches |
|---|---|---|---|---|
| P1 | module a | develop | — | a.txt |
| P2 | module b | develop | P1 | b.txt |
