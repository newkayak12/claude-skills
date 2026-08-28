# assist (beta)

Decision assistance that composes the marketplace's knowledge, thinking, cognition,
domain, writing, and planning skills without running every skill on every decision.

## Install & Uninstall

```bash
# Install (declared dependencies are installed with it)
/plugin install assist@newkayak12-claude-skills

# Uninstall
/plugin uninstall assist@newkayak12-claude-skills
```

## Skills

| Skill | Description |
|---|---|
| `decision` | Reach or review a consequential decision with evidence, alternatives, adversarial checks, an explicit recommendation, and a useful next step |

`assist:decision` is an orchestrator. It selects the smallest useful route through its
dependencies according to decision mode, domain, missing evidence, risk, and reversibility.
