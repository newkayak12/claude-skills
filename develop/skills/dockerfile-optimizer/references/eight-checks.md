# The 8 Checks, with Examples

Per-check antipatterns are in `antipatterns.md`; the `.dockerignore` template is in `dockerignore-template.md`.

## Mental model: layers are cache keys

Each `RUN`, `COPY`, `ADD` creates an immutable layer. The cache invalidates a layer, and every layer after it, when its
instruction or inputs change. Put rarely-changing instructions first and application code last.

```dockerfile
# Bad — copies source before installing deps; any code change re-runs npm install
COPY . .
RUN npm ci

# Good — deps cached separately; code changes only rebuild the last two layers
COPY package*.json ./
RUN npm ci
COPY . .
```

## 1. Base image

| Choice | Use when |
|--------|----------|
| `alpine` variant | Small production image; minimal tooling at runtime. musl libc, not glibc: native modules and prebuilt glibc binaries can break |
| `distroless` (Google) | Maximum security; no shell, no package manager (debugging needs a debug variant or an ephemeral container) |
| `slim` Debian variant | glibc compatibility without full Debian |
| Full official image | Build stages only |

Avoid `latest` in production. Pin a digest or at least a minor version: `node:20.11-alpine3.19`.

## 2. Multi-stage builds

A fat builder image with compilers, then only the artifact copied into a minimal runtime image.

```dockerfile
# Stage 1: build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: runtime — built output only, no source
FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
```

Copying the builder's `node_modules` carries dev dependencies into runtime; prefer `npm ci --omit=dev` in a separate
deps stage when size matters.

## 3. Layer count and RUN consolidation

```dockerfile
# Bad — apt cache committed in layer 1
RUN apt-get update
RUN apt-get install -y curl
RUN rm -rf /var/lib/apt/lists/*

# Good — cache never committed
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
```

## 4. .dockerignore

Without one, `COPY . .` sends the whole build context (`node_modules`, `.git`, fixtures, local config) to the daemon.

## 5. Non-root user

```dockerfile
RUN addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser
USER appuser
```

Official images often ship a user (`node`); use `USER node`.

## 6. COPY vs ADD

`COPY` unless you need `ADD`'s tar auto-extraction. `ADD` with a URL is a download with no integrity check; use
`ADD --checksum=sha256:...` or `curl` plus a verify step.

## 7. CMD vs ENTRYPOINT

Exec form (`["executable", "arg"]`), not shell form: shell form makes `/bin/sh` PID 1, which does not forward signals.

```dockerfile
# Shell form — PID 1 is /bin/sh, SIGTERM not forwarded
CMD node server.js

# Exec form — PID 1 is node
ENTRYPOINT ["node"]
CMD ["server.js"]
```

## 8. Secrets

Never in `ENV` or `ARG`: both are readable from the image (`docker history`, image metadata). Deleting a file in a later
layer does not remove it from the earlier one. Use BuildKit secrets at build time and runtime injection at run time.

```dockerfile
RUN --mount=type=secret,id=api_key \
    API_KEY=$(cat /run/secrets/api_key) ./fetch-assets.sh
```

## Measuring impact

- `docker image ls <image>` — size before and after
- `docker build --no-cache .` — cold build time
- `docker build .` after changing only source — warm build time
- `docker history <image>` — layer breakdown
- `dive <image>` (third-party) — wasted space per layer
