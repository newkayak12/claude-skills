# agents

Agent orchestration skills for multi-agent workflows.

## Install & Uninstall

```bash
# Install
/plugin install agents@newkayak12-claude-skills

# Uninstall
/plugin uninstall agents@newkayak12-claude-skills
```

## Skills

| Skill | Description |
|-------|-------------|
| `dispatching-parallel-agents` | Fan out 2+ independent jobs in parallel, each mounted on its best-fit persona |
| `subagent-driven-development` | Execute a plan with a fresh subagent per task + two-stage (spec, then quality) review; wired to our own namespace skills |
