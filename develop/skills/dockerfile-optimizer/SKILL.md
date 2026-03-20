---
name: dockerfile-optimizer
description: |
  Dockerfile optimization specialist — analyzes existing Dockerfiles and delivers concrete before/after improvements for layer caching, image size, build speed, and security. Use when the user mentions "Dockerfile", "도커 최적화", "이미지 크기", "빌드 시간", "docker optimize", "컨테이너 최적화", or is asking why builds are slow, why images are large, or how to harden a container. Trigger this skill even if the user just pastes a Dockerfile and says "이거 좀 봐줘" or "can you review this?" without explicitly asking for optimization.
---

# Dockerfile Optimizer

A Dockerfile is both a build script and a specification for a runtime environment. Optimizing it means making builds faster (through caching), images smaller (through layer discipline and base image selection), and containers safer (through least-privilege and attack surface reduction). These goals compound: a smaller image has fewer vulnerabilities and pulls faster.

**Two-pass approach:** First pass — analyze all 8 checks and note all issues before touching anything. Second pass — apply fixes. This prevents fixing one visible issue while missing others that interact with it.

For a detailed antipatterns checklist per check, read `references/antipatterns.md`. For a ready-to-use `.dockerignore` template, read `references/dockerignore-template.md`.

## The Mental Model: Layers Are Cache Keys

Docker builds images as a stack of immutable layers. Each instruction (`RUN`, `COPY`, `ADD`) creates a new layer. The build cache invalidates a layer — and every layer after it — the moment its instruction or its inputs change.

**Layer order is your primary optimization lever.** Put instructions that change rarely at the top; put instructions that change often (your application code) at the bottom. A cache miss deep in the file is cheap; a cache miss near the top rebuilds everything.

```
# Bad — copies source before installing deps; any code change re-runs npm install
COPY . .
RUN npm ci

# Good — deps cached separately; code changes only rebuild the last two layers
COPY package*.json ./
RUN npm ci
COPY . .
```

## The 8-Check Analysis Framework

Work through these in order during the first pass. Note every finding before making any change.

### 1. Base Image Selection

The base image determines the floor of your attack surface and image size.

| Choice | Use When |
|--------|----------|
| `alpine` variant | Small production image; minimal tooling needed at runtime |
| `distroless` (Google) | Maximum security; no shell, no package manager |
| `slim` Debian variant | Need glibc compatibility but not full Debian |
| Full official image | Only in build stages, never in final runtime stage |

Avoid `latest` in production. Pin to a digest or at minimum a minor version: `node:20.11-alpine3.19`. `latest` means the image silently changes under you.

### 2. Multi-Stage Builds

Multi-stage builds are the single highest-impact optimization available. They let you use a fat builder image with compilers and dev tools, then copy only the final artifact into a minimal runtime image.

```dockerfile
# Stage 1: build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: runtime — only the built output, no node_modules, no source
FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
```

For compiled languages (Go, Rust, Java), the runtime image needs no compiler at all:

```dockerfile
FROM golang:1.22 AS builder
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o server .

FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/server /server
ENTRYPOINT ["/server"]
```

### 3. Layer Count and RUN Consolidation

Package manager caches left in layers bloat the image even if deleted in a later layer — the data still exists in the earlier layer's snapshot.

```dockerfile
# Bad — three layers, apt cache left in layer 1
RUN apt-get update
RUN apt-get install -y curl
RUN rm -rf /var/lib/apt/lists/*

# Good — one layer, cache never committed
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
```

Consolidate within phases (all apt installs together), not across all phases — that destroys cache granularity.

### 4. .dockerignore

Without a `.dockerignore`, `COPY . .` sends the entire build context to the Docker daemon — including `node_modules`, `.git`, test fixtures, and local config files. This wastes time and can leak secrets into the image.

See `references/dockerignore-template.md` for a ready-to-use template by language/stack.

### 5. Non-Root User

Containers run as root by default. Create and use a non-root user before `CMD`/`ENTRYPOINT`.

```dockerfile
RUN addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser
USER appuser
```

Many official images ship a pre-created non-privileged user (`node`, `www-data`) — use it: `USER node`.

### 6. COPY vs ADD

Use `COPY` unless you specifically need `ADD`'s features (auto-extracting tarballs). `ADD` with URLs bypasses the build cache unpredictably. Prefer explicit `RUN curl | tar` so the step is visible and cacheable.

### 7. CMD vs ENTRYPOINT

Use exec form (`["executable", "arg"]`), not shell form (`executable arg`). Shell form spawns a shell as PID 1, which does not forward signals correctly — `docker stop` sends SIGTERM to the shell, not your application.

```dockerfile
# Shell form — PID 1 is /bin/sh, signals not forwarded
CMD node server.js

# Exec form — PID 1 is node, SIGTERM reaches your process
ENTRYPOINT ["node"]
CMD ["server.js"]
```

### 8. Secret Handling

Never put secrets in `ENV` or `ARG` — they are visible in `docker history`. Use BuildKit secrets for build-time, and runtime injection (Kubernetes Secrets, AWS Secrets Manager) for runtime.

```dockerfile
# Bad — API key baked into the image
ARG API_KEY
ENV API_KEY=$API_KEY

# Good — secret mounted at build time, never committed to a layer
RUN --mount=type=secret,id=api_key \
    API_KEY=$(cat /run/secrets/api_key) ./fetch-assets.sh
```

## Measuring Impact

After optimizing, measure:
- `docker image ls <image>` — compare sizes before and after
- `docker build --no-cache .` — cold build time
- `docker build .` (after changing only source) — warm build time
- `docker history <image>` — layer breakdown; look for unexpectedly large layers
- `dive <image>` (third-party tool) — interactive layer explorer showing wasted space
