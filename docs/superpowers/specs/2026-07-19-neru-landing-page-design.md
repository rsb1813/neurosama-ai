<!-- Neru 제품 랜딩 페이지의 승인된 콘텐츠, 시각 체계, 구현 경계를 정의하는 설계 문서 -->
# Neru Landing Page Design

**Date:** 2026-07-19  
**Status:** Approved in conversation; awaiting written-spec review  
**Deliverable:** Local private preview only. No Sites deployment or public URL.

## Goal

Create an English-first, multilingual landing page that introduces Neru to general visitors,
developers, and open-source contributors. The page should make Neru feel like a distinct
character first, then explain the working system honestly, and finally lead interested visitors
to the GitHub repository or contribution material.

The primary success path is:

1. Understand Neru's character in the first viewport.
2. See how voice, language, memory, and Live2D expression work together.
3. Distinguish completed capabilities from work in progress.
4. Continue to GitHub, the roadmap, or contribution guidance.

## Product truth

All claims must remain consistent with `README.md`, `README.ko.md`, `ROADMAP.md`,
`WORKSPACE.md`, and the current Neru persona and expression specifications.

Neru is presented as a playful, warm, slightly cheeky AI VTuber with a witch Live2D model.
She understands Korean, speaks with an English voice, and shows Korean subtitles. The system is
local-first and built on the vendored Project AIRI fork plus Neru's local GPU audio gateway.

The site must not imply that a packaged download, public demo, or production release exists.
Completed and in-progress capabilities must be visually distinct.

## Chosen direction

The chosen visual direction is **Arcane Editorial**, with the **Character Centerpiece** hero
layout.

- Use warm paper-like ivory backgrounds, near-ink brown text, muted brick accents, and small
  amounts of violet sampled from Neru's costume.
- Pair an authored editorial serif for English display text with a highly legible sans-serif
  stack for body copy and CJK languages.
- Place the real Neru Live2D render at the center of the first viewport like a character-profile
  cover.
- Build rhythm with folio numbers, fine rules, captions, generous negative space, and restrained
  asymmetry.
- Avoid neon cyber styling, glass panels, excessive gradients, repeated rounded cards, generic
  dashboard motifs, and generated character art.

The rejected directions were **Midnight Familiar**, which felt too generically AI-fantasy, and
**Neon Ritual**, which felt too much like a synthetic streaming console.

## Information architecture

The landing page is a single scrolling route with six sections.

### 1. Character Centerpiece

The hero uses the real witch model and the headline **"Intelligence, with a stage presence."**
The supporting copy describes Neru as an open character experiment that can listen, speak,
remember, and grow. The primary action opens the GitHub repository; the secondary action scrolls
to the system explanation.

### 2. Meet Neru

Short editorial copy introduces Neru's playful, warm, slightly cheeky personality and her fixed
language identity: Korean understanding, English voice, and Korean on-screen subtitles.

### 3. How she comes alive

A concise visual sequence explains the actual loop:

`Korean input -> local AI -> English voice + Korean subtitles -> Live2D expression`

The explanation stays conceptual for general visitors while offering precise labels for
developers.

### 4. Built in public

A status ledger shows completed and in-progress capabilities without marketing inflation.
Examples include voice generation, long-term memory, barge-in, bilingual output, and Live2D
expression. Status copy is derived from the repository documents during implementation.

### 5. Under the spell

An architectural section explains the relationship among the AIRI desktop app, Neru's local GPU
audio gateway, and the local OpenAI-compatible LLM provider. The presentation remains readable
without requiring prior knowledge of the stack.

### 6. Join the experiment

The closing section offers three concrete next steps: view the GitHub repository, read the
roadmap, and start contributing. It does not offer a download or public demo.

## Multilingual behavior

English is the default language. The page also ships complete hand-authored content sets for
Simplified Chinese, Japanese, and Korean. Locale identifiers are `en`, `zh-CN`, `ja`, and `ko`.

- The language control is available in the global header and remains keyboard accessible.
- A selection replaces all user-facing copy without changing the current scroll position.
- The selected locale is stored in browser local storage.
- English is used when no selection exists, the stored value is invalid, or storage access fails.
- No runtime translation API, account, cookie banner, or server persistence is introduced.
- Document language metadata changes with the selected locale.

## Project shape

The landing page lives in an isolated top-level `site/` directory so it does not alter the AIRI
desktop application or Neru audio service. It uses the Sites-compatible project structure created
for this repository, one route, and no backend services.

Keep the implementation intentionally small:

- one page composition;
- focused components only where they clarify locale switching or repeated content;
- one translation data module;
- local static assets copied from repository-owned Neru material;
- no database, authentication, upload, analytics, external connector, or speculative feature.

The normal Sites hosting handoff is explicitly skipped because the requested deliverable is a
local private preview that must not be deployed.

## Interaction and responsive behavior

- Use restrained entry and scroll reveal motion only where it reinforces editorial hierarchy.
- Respect `prefers-reduced-motion` and keep the page fully understandable without animation.
- Preserve visible focus indicators, semantic landmarks, sensible heading order, descriptive
  alternative text, and accessible color contrast.
- Size controls for keyboard, mouse, and touch input.
- On narrow screens, show Neru before the supporting hero copy and collapse editorial columns
  into a clear reading order.
- External links identify their destinations and do not depend on JavaScript.

## Failure behavior

This static site has no network-dependent product data. A missing or invalid stored locale falls
back to English. If decorative motion or browser storage is unavailable, the core page remains
usable. Missing optional imagery must not hide product copy or navigation.

## Verification

Implementation is complete only when all of the following are true:

- the production build and type checks pass;
- required copy exists for all four locales;
- locale selection, persistence, invalid-value fallback, and storage-failure fallback are tested;
- primary navigation and GitHub/roadmap links resolve to the intended destinations;
- keyboard focus, semantic structure, alternative text, contrast, and reduced-motion behavior are
  reviewed;
- the layout remains coherent across phone, tablet, and desktop breakpoints;
- current capability claims match repository documentation;
- a local private preview is available and no deployment or public Sites URL has been created.

## Out of scope

- public or private cloud deployment;
- packaged app downloads or waitlists;
- sign-in, forms, comments, analytics, or persistence beyond the locale preference;
- live chatbot or Live2D runtime embedding in the landing page;
- generated character art, video production, or unrelated AIRI refactoring.
