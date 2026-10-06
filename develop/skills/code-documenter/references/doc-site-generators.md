# Documentation Sites

## Choosing

| Generator | Fits when | Content | Config |
|-----------|-----------|---------|--------|
| Docusaurus | Product docs with versioning, React ecosystem | `docs/` Markdown/MDX | `docusaurus.config.js`, `sidebars.js` |
| MkDocs (Material theme) | Python or ops teams, plain Markdown | `docs/` | `mkdocs.yml` |
| VitePress | Vue ecosystem, fast small sites | `docs/` | `docs/.vitepress/config.mts` |

## Commands

```bash
# Docusaurus
npx create-docusaurus@latest site classic
npm run start        # dev server
npm run build        # static output in build/

# MkDocs
pip install mkdocs mkdocs-material
mkdocs serve
mkdocs build --strict   # fail on warnings such as broken nav entries

# VitePress
npm add -D vitepress
npx vitepress dev docs
npx vitepress build docs
```

## Minimal MkDocs config

```yaml
site_name: Billing Platform
theme: { name: material }
nav:
  - Home: index.md
  - Guides:
      - Quick start: guides/quickstart.md
  - API: api/index.md
```

## Versioned docs

- Docusaurus snapshots a version with `npm run docusaurus docs:version 2.0`; older copies live under `versioned_docs/`.
- Cut a version only at a release that changes behaviour; keep "next" for unreleased work.
- Pair each major release with a migration page: what broke, old vs new snippet, and the deprecation timeline.

## Search

Docusaurus supports Algolia DocSearch through the theme config; MkDocs and VitePress ship local search options. Prefer the built-in local search until the corpus is large.

## Quality checks in CI

- Strict build (`mkdocs build --strict`, or Docusaurus failing on broken links by default).
- Link checking over the output with a tool such as `lychee`.
- Extract and run code samples; a stale sample is a bug.

## Hosting

Publish the built folder to any static host (GitHub Pages, S3 + CDN). Serve hashed assets with long cache lifetimes and HTML with short ones.
