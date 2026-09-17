---
key: E-aaaaaaaa
state: DONE
source: task.json@16
---

# Shape

Acceptance:
- both modules build together

| id | title | flow | deps | touches |
|---|---|---|---|---|
| P1 | module a | develop | — | a.txt |
| P2 | module b | develop | P1 | b.txt |
