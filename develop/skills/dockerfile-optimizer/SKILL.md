---
name: dockerfile-optimizer
description: >-
  Use when someone shares a Dockerfile and needs it improved for build speed, image size, or security. Triggers on:
  "도커 최적화", "이미지 크기", "빌드 시간", "Dockerfile", "docker optimize", "이거 좀 봐줘" (when a Dockerfile is
  pasted). Not for Kubernetes or compose.
scenarios:
  - "optimize this Dockerfile"
  - "why is my Docker image so large?"
  - "make my builds faster"
  - "도커파일 최적화해줘"
  - "이미지 크기 줄이는 방법"
  - "빌드가 너무 느려요"
compatibility:
  recommended: []
  optional:
    - think-tool
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 8가지 체크 항목 간 상호작용을 분석할 때 더 정확한 진단이 가능합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER report a size or time saving you did not measure. Build before and after (`docker image ls`,
  `docker build --no-cache`, a warm rebuild after touching one source file) and quote both numbers; a build you could
  not run is `not measured: <why>`, and any estimate is labelled `estimate`. A layer-count guess says nothing about
  bytes, and caches hide real build time.
- NEVER edit before all 8 checks are listed. Fixes interact (a multi-stage split changes where `USER`, the cache
  mounts and the secrets belong), so fixing the first visible issue misses or breaks the others.
- NEVER change a fix's reach beyond its finding: every changed line traces to a numbered check. A rewrite for taste
  makes the diff unreviewable.
- NEVER swap the base image family silently. `alpine` uses musl libc, so native modules and glibc binaries can break;
  flag the swap as a risk and ask the user to run their tests.
- NEVER treat a secret already in a layer as fixed by deleting it later: layers are immutable and the secret stays
  readable. Say it must be rotated.
- Missing facts (target stack, runtime base, registry limits, whether a build is possible here) are
  `[확인 필요: ○○]`; do not guess the runtime user or the entrypoint.
- Goal: every finding maps to one of the 8 checks with a before/after hunk, the build either ran with measured numbers
  or is marked `not measured`, and the closing tally recounts to the findings table.

# Dockerfile Optimizer

**Not for** Kubernetes manifests, docker-compose orchestration, runtime container policy (AppArmor, seccomp), or
production deployment and health checks (`develop:sre-engineer`).

## Process

1. **Pass 1, findings only.** Run the 8 checks in order and list every finding before changing anything. Details and
   code: `references/eight-checks.md`, `references/antipatterns.md`.

   | # | Check | Look for |
   |---|-------|----------|
   | 1 | Base image | `latest`, full image in runtime stage, unpinned version |
   | 2 | Multi-stage | compilers or dev dependencies in the runtime image |
   | 3 | Layers | split `apt-get`, cache left in a layer |
   | 4 | `.dockerignore` | missing file; `.git`, `node_modules` in context (`references/dockerignore-template.md`) |
   | 5 | User | process runs as root |
   | 6 | COPY vs ADD | `ADD` with a URL or without a tar to extract |
   | 7 | CMD / ENTRYPOINT | shell form (no signal forwarding) |
   | 8 | Secrets | `ENV` / `ARG` secrets, files copied then deleted, no `RUN --mount=type=secret` |

   Layer order is the main lever: rarely-changing instructions first, application code last, so a code change does
   not re-run the dependency install.
2. **Baseline.** Build the original and record size and cold/warm times, or write `not measured: <why>`.
3. **Pass 2, apply.** One hunk per finding, with a comment naming its check number.
4. **Measure.** Rebuild; compare; confirm the container still starts.
5. **Recount.** Count findings per check, those fixed, and those measured; fix the tally if it differs.

## Output Template

```
## Dockerfile review — <image / path>

| # | Check | Finding | Severity | Fixed |
|---|-------|---------|----------|-------|

Diff: before/after hunks, each commented with its check number

| | Before | After |
|---|--------|-------|
| Image size | <docker image ls> | <...> |
| Cold build | <s> | <s> |
| Warm rebuild (source changed) | <s> | <s> |

Security: Critical/High/Medium items with severity; a leaked secret -> rotate
Open: [확인 필요: ○○] ...

<n> findings · <f> fixed · <m> measured · <r> need your decision (base image swap, secret rotation)
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Lists all 8 checks' findings, then writes the annotated diff | Provide the Dockerfile and target stack |
| Writes the `.dockerignore` | Run `docker build` and confirm it succeeds |
| Names base-image alternatives with their risks | Decide the swap; rotate any leaked secret |

## Related Skills

- `develop:sre-engineer` — production container deployment and health checks
- `develop:chaos-engineer` — resilience testing for containerized services
- `develop:security-auditor` — exploitability audit beyond Dockerfile hygiene
