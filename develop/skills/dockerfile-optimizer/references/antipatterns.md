# Dockerfile Antipatterns Checklist

Common antipatterns mapped to their fixes, organized by the 8-check framework.

---

## Check 1: Base Image Selection

| Antipattern | Fix |
|-------------|-----|
| `FROM ubuntu:latest` or `FROM node:latest` | Pin to minor version: `node:20.11-alpine3.19` |
| Full official image in production/runtime stage | Use `-alpine`, `-slim`, or `distroless` for runtime |
| `latest` tag in any stage | Pin to digest or version; automate updates via Dependabot/Renovate |

## Check 2: Multi-Stage Builds

| Antipattern | Fix |
|-------------|-----|
| Single-stage build for a compiled app (Go, Java, Rust) | Add a builder stage; copy only the compiled artifact to runtime stage |
| Dev dependencies in the runtime image | Use multi-stage; `npm ci --omit=dev` or copy only `dist/` |
| `COPY --from=builder /app .` (copies everything) | Be explicit: `COPY --from=builder /app/dist ./dist` |

## Check 3: Layer Count and RUN Consolidation

| Antipattern | Fix |
|-------------|-----|
| Separate `RUN apt-get update` and `RUN apt-get install` | Combine: `RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*` |
| `apt-get install` without `--no-install-recommends` | Add flag to skip optional packages |
| Cache cleanup in a separate `RUN` from install | Cleanup must be in the same `RUN` or the cache is baked into the layer |
| All `RUN` commands merged into one giant command | Consolidate within phases only; not across unrelated phases |

## Check 4: .dockerignore

| Antipattern | Fix |
|-------------|-----|
| No `.dockerignore` file | Create one (see `references/dockerignore-template.md`) |
| `COPY . .` without `.dockerignore` | Context includes `.git`, `node_modules`, secrets — all sent to daemon |
| `.env` files in build context | Add `.env` and `.env.*` to `.dockerignore` |

## Check 5: Non-Root User

| Antipattern | Fix |
|-------------|-----|
| No `USER` instruction (runs as root) | Create a system user and add `USER` before `CMD`/`ENTRYPOINT` |
| Creating user but not switching before `CMD` | `USER` instruction must appear before the final `CMD`/`ENTRYPOINT` |

```dockerfile
# Debian/Ubuntu
RUN addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser
USER appuser

# Alpine
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Official images with built-in user (node, python)
USER node
```

## Check 6: COPY vs ADD

| Antipattern | Fix |
|-------------|-----|
| `ADD https://...` to fetch a remote file | Use `RUN curl -fsSL ... \| tar -xz ...` — explicit and cacheable |
| `ADD` for local files when no extraction is needed | Use `COPY` — intent is clearer and behavior is predictable |

## Check 7: CMD vs ENTRYPOINT

| Antipattern | Fix |
|-------------|-----|
| Shell form `CMD node server.js` | Use exec form: `CMD ["node", "server.js"]` |
| `CMD ["sh", "-c", "node server.js"]` | Direct exec form: `CMD ["node", "server.js"]` |
| No `ENTRYPOINT` for a single-purpose image | Define `ENTRYPOINT` for the executable; `CMD` for overridable defaults |

Shell form spawns `/bin/sh` as PID 1. `docker stop` sends SIGTERM to the shell, not your app. Exec form makes your process PID 1 and receives signals directly.

## Check 8: Secret Handling

| Antipattern | Fix |
|-------------|-----|
| `ARG API_KEY` / `ENV API_KEY=$API_KEY` | Use BuildKit secrets: `RUN --mount=type=secret,id=api_key ...` |
| Secret in `ENV` visible in `docker history` | Runtime injection via Kubernetes Secrets or AWS Secrets Manager |
| `.env` file copied into image | Add to `.dockerignore`; mount at runtime instead |

```dockerfile
# Bad — API key baked into the image
ARG API_KEY
ENV API_KEY=$API_KEY

# Good — secret mounted at build time, never committed to a layer
RUN --mount=type=secret,id=api_key \
    API_KEY=$(cat /run/secrets/api_key) ./fetch-assets.sh
```
