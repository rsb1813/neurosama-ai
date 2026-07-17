---
summary: neru long-term memory architecture — remember tool (LLM-callable) appends categorized facts to MEMORY.md via Electron IPC; recall context provider injects bounded text into every prompt; renderer-side RMW serialization prevents concurrent tool-call lost updates; ensureFile guards ENOENT only to avoid truncating irreplaceable memory on transient errors
read_when:
  - understanding how neru remembers facts across sessions
  - debugging the remember tool or MEMORY.md file I/O
  - debugging the recall context provider or memory injection into prompts
  - adding new memory categories or changing the MEMORY.md format
  - working on the resolveTools always-on wiring (memory tools are always included)
  - debugging concurrent remember calls or lost-update issues
  - understanding the cross-window Pinia store isolation risk for memory
  - planning future memory features (RAG, consolidation, settings UI)
---

# neru Long-Term Memory System

## Overview

neru records and recalls facts across sessions via a `remember` tool and a MEMORY.md file. The LLM decides when to remember (guided by persona instructions); a recall provider injects the stored text into every prompt.

**Spec:** `docs/superpowers/specs/2026-07-16-neru-long-term-memory-design.md`
**Plan:** `docs/superpowers/plans/2026-07-16-neru-long-term-memory.md`
**Branch:** `feat/neru-long-term-memory` (master-based)

## Data flow

```
User says something worth remembering
  → LLM emits remember({category, text}) tool call
  → renderer executeRemember (serialized on module-level writeChain)
    → IPC readMemoryText → main reads <userData>/neru-memory/MEMORY.md
    → appendMemoryToMarkdown (pure helper: section-aware, exact-dup dedup)
    → IPC writeMemoryText → main writes file (serialized on main writeChain)
    → useMemoryStore().setMemoryText(next)  [renderer-local Pinia]

On startup:
  main.ts → void initMemory() [after .mount('#app'), Pinia active]
    → IPC readMemoryText → useMemoryStore().setMemoryText(text)

Every LLM turn:
  createMemoryContext() [runtime context provider, synchronous]
    → reads useMemoryStore().memoryText
    → renderMemoryContext(text, 4000)  [bounded, truncation marker if over]
    → injected as ContextMessage {contextId: 'system:neru-memory', ReplaceSelf}
```

## File locations

| Piece | Path | Package |
|-------|------|---------|
| Pure markdown helpers | `packages/stage-ui/src/utils/memory-md.ts` | @proj-airi/stage-ui |
| Reactive store | `packages/stage-ui/src/stores/modules/memory.ts` | @proj-airi/stage-ui |
| Recall provider | `packages/stage-ui/src/stores/chat/context-providers/memory.ts` | @proj-airi/stage-ui |
| Remember tool | `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/memory.ts` | stage-tamagotchi |
| IPC helpers | `apps/stage-tamagotchi/src/renderer/memory-io.ts` | stage-tamagotchi |
| Startup loader | `apps/stage-tamagotchi/src/renderer/memory-init.ts` | stage-tamagotchi |
| Main IPC service | `apps/stage-tamagotchi/src/main/services/airi/memory/index.ts` | stage-tamagotchi |
| Eventa contracts | `apps/stage-tamagotchi/src/shared/eventa/index.ts` (electronMemoryReadText/WriteText) | stage-tamagotchi |
| Persona guidance | `packages/stage-ui/src/constants/neru-persona.ts` (MEMORY block in NERU_SYSTEM_PROMPT) | @proj-airi/stage-ui |

## Key design decisions

1. **Tool-call mechanism** (not `<|MEMORY|>` streaming token): the local LLM proxy's function-calling was verified via probe (returns proper `remember` tool_calls with category+text).

2. **Always-on tools**: `resolveTools` in `chat-sync.ts` always returns a factory including `memoryTools()`, even when no toolset is set (previously returned `undefined`). This means `remember` is available on every turn regardless of chat mode.

3. **Single MEMORY.md file** at `<userData>/neru-memory/MEMORY.md`: category sections (`## Identity`, `## Preferences`, `## Context`, `## Misc`), markdown bullet format `- fact text (YYYY-MM-DD)`. Human-readable/editable.

4. **Exact-duplicate dedup**: case-insensitive, trimmed, date-stripped comparison within the same section. Cross-section duplicates are kept (same fact in different categories is intentional).

5. **Recall budget**: `renderMemoryContext` hard-caps the ENTIRE output (header + body + truncation marker) to `budgetChars` (default 4000 chars).

## Concurrency: the lost-update fix

`@xsai/stream-text` runs a round's tool calls via `await Promise.all(...)` (dist/index.js:138). The design probe showed 2 `remember` calls in one turn. Without serialization, both would read the same base text and the later write would clobber the earlier bullet.

**Fix**: renderer-side module-level `writeChain` serializes the full read→append→write→store-update cycle. Each call chains onto the previous via `.then(run, run)` (failed writes don't wedge the chain). The main service also has its own `writeChain` for file-write serialization, but that alone was insufficient because the read happens before the main chain.

**Scope**: this guarantee holds when the chat window is the sole writer. If a second writer window is added later, cross-window serialization would need to move to main.

## Cross-window Pinia risk

`useMemoryStore` is renderer-local Pinia — same structural pattern as the exp3 expression bug (M-E: stage window registers expressions, settings window has empty store). The recall provider runs in the same window as the chat orchestrator and the remember tool, so it sees fresh writes. **But**: this was verified by code reasoning only, not runtime instrumentation. The most valuable manual check is: tell neru a fact → restart app → confirm she recalls (this path goes through the file + initMemory, bypassing any window isolation concern).

## Out of scope (future)

- RAG / vector search (for when MEMORY.md exceeds the 4KB injection budget)
- Memory consolidation / summarization
- Settings UI for viewing/editing memories
- Prompt-injection hardening (when untrusted audience/chat input is wired — attacker could induce `remember` of adversarial text that gets injected every turn)
