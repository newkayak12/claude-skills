# verification — what "verified" means in this project

The harness Test stage executes these commands as deterministic evidence; the
QualityGate weighs their output over any narrative. Commands run non-interactively
from the project root.

## Commands
- Validate all plugins/skills: `python3 scripts/validate_plugins.py`
- Harness install (deterministic file ops, dry inspection): `node harness/skills/install/install.mjs '{"projectDir":"/tmp/probe"}'`
- Harness engine is a Workflow script (`harness/engine/pipeline.js`) — it runs via the
  Workflow tool, not `node`; verify changes by reading + a dry Workflow run, not by executing it standalone.

## Pass bar
- A change is verified only when `validate_plugins.py` passes with no new WARN/ERROR
  attributable to the change, AND the changed behavior was exercised at least once
  (e.g. install.mjs run against a temp projectDir; hook run against a crafted stdin JSON).
- Version bumped in `.claude-plugin/marketplace.json` (source of truth) and the plugin's
  own `plugin.json` + README updated — an unbumped meaningful change is not "done".
