# Documentation Site Generators

## Docusaurus (Meta)

```bash
# Setup
npx create-docusaurus@latest docs classic
cd docs && npm start

# Structure
docs/
├── docs/           # Documentation pages
├── blog/           # Blog posts
├── src/
│   └── pages/      # Custom pages
└── docusaurus.config.js
```

**docusaurus.config.js:**
```javascript
module.exports = {
  title: 'My API',
  tagline: 'Build amazing things',
  url: 'https://docs.example.com',
  baseUrl: '/',

  themeConfig: {
    navbar: {
      items: [
        {to: '/docs/intro', label: 'Docs', position: 'left'},
        {to: '/api', label: 'API', position: 'left'},
      ],
    },

    // Algolia search
    algolia: {
      apiKey: 'YOUR_API_KEY',
      indexName: 'your_index',
      contextualSearch: true,
    },

    prism: {
      theme: lightCodeTheme,
      darkTheme: darkCodeTheme,
      additionalLanguages: ['python', 'rust'],
    },
  },
};
```

## MkDocs (Python)

```yaml
# mkdocs.yml
site_name: My API Documentation
theme:
  name: material
  features:
    - navigation.tabs
    - navigation.sections
    - toc.integrate
    - search.suggest
    - search.highlight
  palette:
    - scheme: default
      toggle:
        icon: material/brightness-7
        name: Switch to dark mode
    - scheme: slate
      toggle:
        icon: material/brightness-4
        name: Switch to light mode

plugins:
  - search
  - mkdocstrings:
      handlers:
        python:
          options:
            show_source: true
  - git-revision-date-localized

markdown_extensions:
  - pymdownx.highlight
  - pymdownx.superfences
  - admonition
  - codehilite

nav:
  - Home: index.md
  - Getting Started: getting-started.md
  - API Reference: api/
```

## VitePress (Vue)

```typescript
// .vitepress/config.ts
export default defineConfig({
  title: 'API Docs',
  description: 'Developer documentation',

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'API', link: '/api/' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Configuration', link: '/guide/config' },
          ],
        },
      ],
    },

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/user/repo/edit/main/docs/:path',
    },
  },
});
```

## Quick Reference

| Tool | Best For | Tech Stack |
|------|----------|-----------|
| Docusaurus | React projects, versioning | React, MDX |
| MkDocs | Python projects, simple setup | Python, Jinja2 |
| VitePress | Vue projects, fast builds | Vue, Vite |
| Nextra | Next.js integration | React, Next.js |
| Mintlify | Modern UI, AI search | React |
