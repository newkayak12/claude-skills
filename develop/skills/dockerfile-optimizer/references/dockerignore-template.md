# .dockerignore Template

Copy this file to the root of your project and adjust for your stack.

---

## Universal Baseline

```
# Version control
.git
.gitignore
.gitattributes

# Logs
*.log
logs/

# Environment / secrets
.env
.env.*
*.pem
*.key

# OS artifacts
.DS_Store
Thumbs.db
```

---

## Node.js / JavaScript

```
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.npm
.yarn/cache
.yarn/unplugged

# Build output (if not needed in context)
dist/
build/
.next/
.nuxt/

# Test / coverage
coverage/
.nyc_output/
__tests__/
*.test.js
*.spec.js

# Documentation
README.md
docs/
```

---

## Python

```
__pycache__/
*.pyc
*.pyo
*.pyd
.Python
*.egg-info/
.eggs/
dist/
build/

# Virtual environments
venv/
.venv/
env/
.env/

# Test / coverage
.pytest_cache/
.coverage
htmlcov/
```

---

## Java / Maven / Gradle

```
target/
*.class
*.jar (if building from source inside Docker — otherwise keep)

.gradle/
build/

# IDE files
.idea/
*.iml
.eclipse/
.settings/

# Test reports
surefire-reports/
```

---

## Go

```
# Binaries
*.exe
*.exe~
*.dll
*.so
*.dylib

# Test coverage
*.out

# Vendor (only if using modules without vendor/)
vendor/
```

---

## General Development Artifacts

```
# Docker files themselves (usually fine to include, listed here for reference)
# Dockerfile
# docker-compose.yml

# CI configs (not needed in image)
.github/
.gitlab-ci.yml
.circleci/
Jenkinsfile

# Editor configs
.editorconfig
.vscode/
*.swp
*.swo

# Documentation
*.md
docs/
```

---

## Notes

- Always include `.env` and `.env.*` — these often contain secrets and must never enter the build context.
- `node_modules/` and similar dependency directories: exclude them. Install inside the container from the lockfile so the build is reproducible.
- `dist/` or `build/` output directories: exclude if you build inside Docker. Include only if your Dockerfile copies a pre-built artifact.
- Check with `docker build --no-cache . 2>&1 | head` — the first line shows context size. A large context (>100MB) usually means `.dockerignore` is missing something.
