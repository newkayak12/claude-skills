---
key: E-aaaaaaaa
state: DONE
source: task.json@33
---

# Shape

Acceptance:
- both modules build together

| id | title | flow | deps | touches |
|---|---|---|---|---|
| P1 | module a | develop | — | a.txt |
| P2 | module b | develop | P1 | b.txt |
| D1 | F2-US-1 -> b.txt was never wired to the exported path | develop | — | b.txt |
