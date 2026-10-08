# claude-skills

A Claude Code plugin marketplace with skills for engineering, product, thinking, knowledge work, writing, agents, and more.

## Install via Claude Code

**Step 1: Register the marketplace**
```
/plugin marketplace add newkayak12/claude-skills
```

**Step 2: Install individual plugins**
```
/plugin install agents@newkayak12-claude-skills
/plugin install cognition@newkayak12-claude-skills
/plugin install completion@newkayak12-claude-skills
/plugin install develop@newkayak12-claude-skills
/plugin install graph@newkayak12-claude-skills
/plugin install harness@newkayak12-claude-skills
/plugin install knowledge@newkayak12-claude-skills
/plugin install mods@newkayak12-claude-skills
/plugin install planning@newkayak12-claude-skills
/plugin install portfolio@newkayak12-claude-skills
/plugin install session@newkayak12-claude-skills
/plugin install skill@newkayak12-claude-skills
/plugin install teams@newkayak12-claude-skills
/plugin install think@newkayak12-claude-skills
/plugin install trophy@newkayak12-claude-skills
/plugin install write@newkayak12-claude-skills
```

Every plugin lists `trophy` as a dependency, so installing any one of them installs trophy too
(achievements and a local failure record; nothing is sent until you say yes). An existing install picks trophy up
once, on the first interactive session after you update any plugin; uninstalling trophy is respected.
Opt out beforehand: `mkdir -p ~/.claude/plugins/.newkayak12-trophy-ride.done`.

## Plugins

| Plugin | Description |
|--------|-------------|
| [agents](./agents/README.md) · [한국어](./agents/KOR.md) | Agent orchestration: parallel agents, subagent-driven development |
| [cognition](./cognition/README.md) · [한국어](./cognition/KOR.md) | Thinking quality: assumptions, biases, fallacies, mental models, trade-offs |
| [completion](./completion/README.md) · [한국어](./completion/KOR.md) | Verification before completion |
| [develop](./develop/README.md) · [한국어](./develop/KOR.md) | Engineering: CLI, SQL, architecture, Spring Boot, Kotlin, TDD, and more |
| [graph](./graph/README.md) | Graph-owned harness orchestration, MCP installation, routing, and adjudication |
| [harness](./harness/README.md) · [한국어](./harness/KOR.md) | Six-stage planning, implementation, verification, quality gate, and reporting |
| [knowledge](./knowledge/README.md) · [한국어](./knowledge/KOR.md) | Knowledge bases, ontologies, graphs, RAG corpora, and querying |
| [mods](./mods/README.md) · [한국어](./mods/KOR.md) | Claude Code mods: skill toasts, safety guards, and `/reap` for orphan agents (Claude Code 2.1.292+) |
| [planning](./planning/README.md) · [한국어](./planning/KOR.md) | Executing plans and roadmap planning |
| [portfolio](./portfolio/README.md) · [한국어](./portfolio/KOR.md) | Portfolio and career: feedback, JD analysis, interview prep |
| [skill](./skill/README.md) · [한국어](./skill/KOR.md) | Skill creation, improvement, and validation |
| [session](./session/README.md) · [한국어](./session/KOR.md) | Beta: `/session` retro pane (files, commits, denied calls), next-start retro band, safe stop for stray `claude -p` children, `/smart-compact` (recap, then compact at a context % you set), `/handoff` · `/recap` · `/lessons`, `/task` timer, cost in the status line |
| [teams](./teams/README.md) · [한국어](./teams/KOR.md) | TaskManager MCP and per-flow teams (develop, document, plan, qa) with an EPIC/STORY board |
| [think](./think/README.md) · [한국어](./think/KOR.md) | Brainstorming, devil's advocate, problem reframing, and more |
| [trophy](./trophy/README.md) · [한국어](./trophy/KOR.md) | Steam-style achievements for skill use and a local record of skill failures; opt-in anonymous counts and error codes |
| [write](./write/README.md) · [한국어](./write/KOR.md) | Documentation, writing plans, and content review |
