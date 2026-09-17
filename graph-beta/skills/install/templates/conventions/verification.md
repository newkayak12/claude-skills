# verification — what "verified" means in this project

The harness Test stage executes these commands as deterministic evidence; the
QualityGate weighs their output over any narrative. Commands must run non-interactively
from the project root.

## Commands
- Build: `<!-- fill: e.g. ./gradlew build -x test -->`
- Test (full): `<!-- fill: e.g. ./gradlew test -->`
- Test (single): `<!-- fill: e.g. ./gradlew test --tests <ClassName> -->`
- Lint/format check: `<!-- fill -->`

## Pass bar
- A change is verified only when the commands above pass AND the changed behavior was
  exercised end-to-end at least once.
- <!-- fill: extra bars, e.g. "no new warnings", "migration runs on a fresh DB" -->
