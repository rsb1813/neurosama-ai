# Codex Personal Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selectively merge reusable Claude Code guidance into Codex, connect the existing RTK binary to Codex, and migrate only the `clone-website` personal skill.

**Architecture:** Build exact target content in a workspace staging directory, back up the current user-global Codex files, and install the staged artifacts into the user profile. Use RTK's native Codex initializer for `RTK.md`, then install the reviewed merged `AGENTS.md` and skill without changing Claude originals or unrelated Codex configuration.

**Tech Stack:** Markdown, YAML, PowerShell, RTK 0.42.2, Codex skill validation scripts.

## Global Constraints

- Do not migrate or create `brutal-critique`.
- Do not modify hooks, MCP servers, plugins, credentials, or session history.
- Preserve all Claude originals.
- Back up every existing Codex target before replacement.
- Use `$HOME/.agents/skills/clone-website` for the personal skill.
- Keep Claude-specific model IDs, forced delegation, `$ARGUMENTS`, and Claude slash-command metadata out of installed files.
- Perform user-profile writes only after verifying exact resolved target paths.

---

### Task 1: Merge Global Guidance and Connect RTK

**Files:**
- Modify: `C:\Users\jolib\.codex\AGENTS.md`
- Create: `C:\Users\jolib\.codex\RTK.md`
- Create: `C:\Users\jolib\.codex\migration-backups\20260719-personal-migration\AGENTS.md`
- Create if replacing existing file: `C:\Users\jolib\.codex\migration-backups\20260719-personal-migration\RTK.md`

**Interfaces:**
- Consumes: `C:\Users\jolib\.claude\CLAUDE.md`, current Codex `AGENTS.md`, and `rtk init -g --codex` output.
- Produces: concise global Codex guidance plus an absolute `@C:\Users\jolib\.codex\RTK.md` reference.

- [x] **Step 1: Verify the pre-migration state fails the completion contract**

Run checks for the absence of `C:\Users\jolib\.codex\RTK.md`, the absence of the RTK reference, and the absence of selected merged guidance headings.

Expected: at least one check reports missing content.

- [x] **Step 2: Build and review the exact merged AGENTS.md in workspace staging**

Preserve the existing language, honorific, simplicity, surgical-change, plan, test, commit, and error-reading rules. Add only intent, evidence calibration, repository evidence, alternative comparison, context hygiene, ripple checks, self-review, stuck recovery, and instruction-source boundaries.

- [x] **Step 3: Resolve and back up exact user-profile targets**

Verify all resolved paths remain under `C:\Users\jolib\.codex`, create a timestamped backup directory, and copy existing target files there.

- [x] **Step 4: Run the RTK-supported Codex initializer**

Run `rtk init -g --codex` outside the sandbox so it targets `C:\Users\jolib\.codex` rather than the sandbox profile.

Expected: `RTK.md` is created and `AGENTS.md` receives its reference.

- [x] **Step 5: Install the reviewed merged AGENTS.md and verify RTK**

Install the staged `AGENTS.md` with the RTK reference, then run `rtk --version`, `rtk gain`, and static path/reference checks.

Expected: RTK reports version `0.42.2`, analytics run successfully, and the global instructions contain no Claude model IDs.

- [x] **Step 6: Commit workspace records**

Update `checklist.md` and `context-notes.md`, then commit the logical documentation change.

### Task 2: Migrate the clone-website Skill

**Files:**
- Read: `C:\Users\jolib\.claude\skills\clone-website\SKILL.md`
- Create: `C:\Users\jolib\.agents\skills\clone-website\SKILL.md`
- Create: `C:\Users\jolib\.agents\skills\clone-website\agents\openai.yaml`
- Create if replacing existing directory: `C:\Users\jolib\.codex\migration-backups\20260719-personal-migration\clone-website\...`

**Interfaces:**
- Consumes: the existing Claude skill's website inspection, specification, asset extraction, build, responsive, interaction, and visual QA procedures.
- Produces: a Codex-discoverable skill that uses user-provided URLs and currently available browser capabilities without forced delegation.

- [x] **Step 1: Verify the pre-migration discovery check fails**

Run a path check for `C:\Users\jolib\.agents\skills\clone-website\SKILL.md`.

Expected: the target is absent.

- [x] **Step 2: Initialize a Codex skill in workspace staging**

Use `skill-creator/scripts/init_skill.py` with `name=clone-website` and deterministic `display_name`, `short_description`, and `default_prompt` values.

- [x] **Step 3: Port the skill body with Codex-specific adaptations**

Retain the proven extraction and QA workflow. Remove `argument-hint`, `user-invocable`, `$ARGUMENTS`, Claude-only MCP preference, mandatory worktrees, mandatory parallel builders, and assumptions that every project is Next.js with shadcn/Tailwind.

- [x] **Step 4: Validate the staged skill**

Run `quick_validate.py`, YAML parsing, frontmatter field checks, and searches for forbidden Claude-only tokens.

Expected: all validators pass and forbidden-token searches return no matches.

- [x] **Step 5: Back up and install the skill**

Verify the destination resolves under `C:\Users\jolib\.agents\skills`, back up a pre-existing target if present, and copy the validated staged directory into place.

- [x] **Step 6: Validate the installed skill independently**

Run the same structural validator against `C:\Users\jolib\.agents\skills\clone-website` and confirm `brutal-critique` was not created.

- [x] **Step 7: Commit workspace records**

Update `checklist.md` and `context-notes.md`, then commit the logical documentation change.

### Task 3: Final Scope and Integrity Verification

**Files:**
- Verify: `C:\Users\jolib\.codex\AGENTS.md`
- Verify: `C:\Users\jolib\.codex\RTK.md`
- Verify: `C:\Users\jolib\.agents\skills\clone-website\SKILL.md`
- Verify unchanged: `C:\Users\jolib\.claude\CLAUDE.md`
- Verify unchanged: `C:\Users\jolib\.claude\skills\clone-website\SKILL.md`
- Verify unchanged: `C:\Users\jolib\.claude\settings.json`
- Verify unchanged: `C:\Users\jolib\.codex\config.toml`

**Interfaces:**
- Consumes: file hashes captured before implementation and installed artifacts from Tasks 1 and 2.
- Produces: evidence that the requested migration is installed and excluded surfaces remain unchanged.

- [x] **Step 1: Compare protected-file hashes**

Expected: all Claude originals match their pre-migration hashes. If Codex rewrites `config.toml` concurrently, record the observed delta without overwriting it.

- [x] **Step 2: Run all completion checks in one fresh verification pass**

Expected: global guidance, RTK, and `clone-website` checks pass; `brutal-critique` remains absent; hook, MCP, and plugin configuration remains unchanged.

- [x] **Step 3: Review the final diff and records for scope**

Expected: no unrelated agent-authored workspace or user-profile changes are present; any concurrent external drift is documented.

- [x] **Step 4: Mark the checklist complete and record backup paths**

Commit only the final workspace record update if it is not already included in Task 2.
