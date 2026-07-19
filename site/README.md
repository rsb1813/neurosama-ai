# Neru landing page

The Neru landing page is a local-first editorial introduction to the Neru AI VTuber project.

## Requirements

- Node.js `>=22.13.0`

## Local development

```bash
npm ci
npm run dev
```

Open the local URL printed by the development server. This project is for a local-only private preview; do not deploy or publish it as part of this workflow.

## Validation

```bash
npm test
npm run lint
npm run build
```

The default test command builds the site and runs every `tests/*.test.mjs` suite.

## Content and assets

The language selector includes English, Simplified Chinese, Japanese, and Korean. The page uses the repository-owned Neru render in `public/neru-render-airi.png` and the editorial social card in `public/og.png`.
