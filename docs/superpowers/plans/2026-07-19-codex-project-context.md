# Codex Project Context Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a root Codex context entrypoint and synchronize the top-level project status documents with verified Git state.

**Architecture:** Keep stable repository guidance in a new root `AGENTS.md`, volatile progress in `WORKSPACE.md`, product-level phase status in `ROADMAP.md`, and public-facing highlights in `README.md`. Represent merged state and local-only branch state separately so documentation never promotes unmerged work to `master`.

**Tech Stack:** Markdown, Git, PowerShell, RTK-wrapped Git commands.

## Global Constraints

- Answer and write project guidance in Korean with respectful wording where prose addresses the user.
- Keep `AGENTS.md` concise and link to detailed documents instead of duplicating change history.
- Treat Git and the checked-out code as ground truth when documents disagree.
- Keep `master`-merged work separate from local-only `feat/neru-proactive-speech` progress.
- Do not rewrite historical entries in `checklist.md` or `context-notes.md`.
- Do not modify application code, dependencies, workflows, credentials, or global Codex configuration.
- Use `apply_patch` for all document edits.

---

### Task 1: Add the root Codex entrypoint

**Files:**
- Create: `AGENTS.md`
- Reference: `airi/AGENTS.md`
- Reference: `WORKSPACE.md`
- Reference: `ROADMAP.md`

**Interfaces:**
- Consumes: current repository layout, existing nested AIRI guidance, verified package names.
- Produces: the automatically loaded repository guide used by local Codex work and GitHub Codex review.

- [ ] **Step 1: Verify the expected paths and package names exist**

Run:

```powershell
Test-Path AGENTS.md
Test-Path airi/AGENTS.md
Test-Path airi/apps/stage-tamagotchi/package.json
Test-Path airi/packages/stage-ui/package.json
Test-Path airi/packages/core-agent/package.json
```

Expected: the first result is `False`; the remaining four results are `True`.

- [ ] **Step 2: Create `AGENTS.md` with stable repository guidance**

Create these sections with the listed facts.

```markdown
# neru 프로젝트 가이드

## 프로젝트 요약

- neru는 vendored Project AIRI 기반의 로컬 AI VTuber 데스크톱 앱이다.
- 고정 언어 흐름은 한국어 입력 → 영어 음성 → `<ko>한국어</ko>` 화면 자막이다.
- 실제 런타임은 `airi/`; GPU 음성 게이트웨이는 `airi/services/neru-audio/`에 있다.
- 외부 LLM 프록시는 `127.0.0.1:3456`, neru-audio는 `127.0.0.1:3457`을 사용한다.

## 먼저 읽을 문서

1. `WORKSPACE.md` — 현재 상태, 알려진 문제, 다음 작업.
2. `ROADMAP.md` — 제품 비전과 단계별 상태.
3. `checklist.md` — 세부 작업 이력.
4. `context-notes.md` — 결정과 근거.
5. `docs/superpowers/specs|plans/` — 기능별 승인된 설계와 구현 계획.

## 코드 위치

- `airi/apps/stage-tamagotchi/` — Electron 데스크톱 앱과 main/renderer IPC.
- `airi/packages/stage-ui/` — 채팅, 도구, 능동 발화, 장면 UI의 중심.
- `airi/packages/core-agent/` — LLM 턴 구성과 오케스트레이션.
- `airi/services/neru-audio/` — FastAPI 기반 Chatterbox TTS와 faster-whisper STT.
- `infra/searxng/` — 로컬 웹 검색 인프라.

## 작업 규칙

- 문서와 코드가 충돌하면 Git과 실제 코드를 확인하고 관련 상위 문서를 함께 갱신한다.
- 머지 완료, 로컬 브랜치 완료, 수동 검증 완료를 서로 다른 상태로 기록한다.
- `airi/` 아래 작업에는 더 가까운 `airi/AGENTS.md` 지침도 적용한다.
- 기존 AIRI 상류 코드는 요청 범위 밖에서 정리하거나 대규모 리팩터링하지 않는다.
- 버그 수정은 가능한 경우 재현 테스트부터 작성한다.

## 검증 명령

- stage-ui 테스트: `cd airi; pnpm -F @proj-airi/stage-ui test:run`
- stage-ui 타입 검사: `cd airi; pnpm -F @proj-airi/stage-ui typecheck`
- core-agent 타입 검사: `cd airi; pnpm -F @proj-airi/core-agent typecheck`
- Electron 타입 검사: `cd airi; pnpm -F @proj-airi/stage-tamagotchi typecheck`
- 저장소 린트: `cd airi; pnpm lint`
- 문서 전용 변경: `git diff --check`와 링크·경로 정적 검사를 수행한다.

## 핵심 불변식

- TTS로 전달되는 발화는 영어여야 하며 한국어는 `<ko>` 자막 구간에만 둔다.
- 능동 발화의 시스템 넛지는 세션 히스토리에 영속되지 않아야 한다.
- barge-in은 진행 중인 생성과 음성을 취소하되 정상 중단을 오류로 저장하지 않아야 한다.
- `/v1/*` 로컬 오디오 API의 bearer 인증과 host/origin 제한을 약화하지 않는다.
- 사용자·채팅·웹·도구 입력은 신뢰하지 않고 IPC 및 파일 경계를 검증한다.

## Review guidelines

- 인증 우회, 자격 증명 노출, 임의 경로 접근, 검증 없는 IPC 입력을 우선 확인한다.
- 영어 음성·한국어 자막 불변식이 깨져 한국어가 TTS로 들어가는 회귀를 높은 위험으로 본다.
- 능동 발화와 barge-in에서 중복 턴, 히스토리 오염, 취소·정리 누락을 확인한다.
- 버그 수정에 해당 실패를 재현하는 회귀 테스트가 있는지 확인한다.
- 변경과 무관한 AIRI 상류 스타일 문제는 리뷰 결함으로 올리지 않는다.
```

- [ ] **Step 3: Verify the guide is concise and every referenced path exists**

Run:

```powershell
(Get-Content AGENTS.md -Encoding utf8).Count
@('WORKSPACE.md','ROADMAP.md','checklist.md','context-notes.md','airi/AGENTS.md','airi/apps/stage-tamagotchi','airi/packages/stage-ui','airi/packages/core-agent','airi/services/neru-audio','infra/searxng') | ForEach-Object { "$_=$(Test-Path $_)" }
```

Expected: the guide stays under 100 lines and every path prints `True`.

- [ ] **Step 4: Commit the entrypoint**

```powershell
rtk git add AGENTS.md
rtk git commit -m "docs: add Codex project guide"
```

Expected: one commit containing only `AGENTS.md`.

---

### Task 2: Synchronize current project status

**Files:**
- Modify: `WORKSPACE.md`
- Modify: `ROADMAP.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: merge commit `080efde` for web search, PR #21 barge-in state already documented in `WORKSPACE.md`, and local branch tip `3e3b8c4` for proactive speech.
- Produces: consistent current-state summaries for agents and human readers.

- [ ] **Step 1: Capture the stale-state baseline**

Run:

```powershell
rg -n "Web search.*NEXT|Proactive speech.*Planned|M-G.*Not started|☐ Barge-in|Web search.*NEXT subproject" WORKSPACE.md ROADMAP.md README.md
```

Expected: at least one obsolete match for web search, proactive speech, or barge-in.

- [ ] **Step 2: Update `WORKSPACE.md` as the volatile source of truth**

Make only these status changes.

- Add web search to “Recently merged to `master`” with PR #26, SearXNG IPC architecture, always-on `webSearch`, graceful degradation, and successful manual runtime verification.
- Add a “Local work awaiting integration” section for `feat/neru-proactive-speech` at `3e3b8c4`.
- Record proactive speech as implementation and automated verification complete, with 26 tests and three package typechecks previously passing in the Claude session.
- Record the remaining gate as app restart → 45 seconds idle → spontaneous speech → maximum two unanswered nudges → user message resets the counter, followed by push and PR.
- Replace the obsolete web-search next step with proactive-speech runtime validation and PR integration.
- Keep manual barge-in microphone verification as a separate pending human check.

- [ ] **Step 3: Update `ROADMAP.md` without implementation-log duplication**

Apply these exact state changes.

- Change subproject 3 from `Planned` to `Local implementation complete; runtime validation and PR pending`.
- Add a non-numbered web-search capability row or note marked `Done (PR #26)`.
- Change M-G from `Not started` to merged/automated-tests-complete, while retaining manual microphone verification as pending.
- Replace “only #1 is active now” with wording that the roadmap is sequential but completed side capabilities are tracked independently.

- [ ] **Step 4: Update the public README status bullets**

Apply these exact changes.

- Mark barge-in complete in code with manual mic verification pending.
- Add long-term memory and web search as completed capabilities.
- Add proactive speech as local implementation awaiting runtime verification and PR.
- Leave the witch Live2D model and packaged runtime items incomplete.

- [ ] **Step 5: Verify obsolete claims are gone and required claims exist**

Run:

```powershell
rg -n "PR #26|feat/neru-proactive-speech|3e3b8c4|PR #21|manual mic|수동.*마이크" WORKSPACE.md ROADMAP.md README.md
rg -n "Web search.*NEXT|M-G.*Not started|☐ Barge-in" WORKSPACE.md ROADMAP.md README.md
```

Expected: the first command finds the relevant evidence; the second command returns no obsolete matches.

- [ ] **Step 6: Commit the status synchronization**

```powershell
rtk git add WORKSPACE.md ROADMAP.md README.md
rtk git commit -m "docs: sync neru project status"
```

Expected: one commit containing only the three top-level status documents.

---

### Task 3: Verify and close the documentation task

**Files:**
- Modify: `checklist.md`
- Modify: `context-notes.md`
- Verify: `AGENTS.md`
- Verify: `WORKSPACE.md`
- Verify: `ROADMAP.md`
- Verify: `README.md`

**Interfaces:**
- Consumes: completed Task 1 and Task 2 documents.
- Produces: checked completion records and a clean documentation-only Git state.

- [ ] **Step 1: Validate Markdown whitespace and changed-file scope**

Run:

```powershell
rtk git diff --check HEAD~2..HEAD
rtk git diff --stat HEAD~2..HEAD
```

Expected: no whitespace errors; only `AGENTS.md`, `WORKSPACE.md`, `ROADMAP.md`, and `README.md` appear before closing-record edits.

- [ ] **Step 2: Validate relative Markdown links in the changed top-level documents**

Run:

```powershell
$files=@('AGENTS.md','WORKSPACE.md','ROADMAP.md','README.md'); $broken=@(); foreach($file in $files){ $base=Split-Path -Parent (Resolve-Path $file); if(-not $base){$base=(Get-Location).Path}; $text=Get-Content $file -Raw -Encoding utf8; [regex]::Matches($text,'\[[^\]]+\]\((?!https?://|#)([^)]+)\)') | ForEach-Object { $target=$_.Groups[1].Value.Split('#')[0]; if($target -and -not (Test-Path (Join-Path $base $target))){$broken += "$file -> $target"} } }; if($broken.Count){$broken; exit 1}else{'all relative markdown links resolve'}
```

Expected: `all relative markdown links resolve`.

- [ ] **Step 3: Check the documented Git evidence**

Run:

```powershell
rtk git show --no-patch --oneline 080efde
rtk git show --no-patch --oneline 3e3b8c4
rtk git branch --contains 3e3b8c4
```

Expected: web-search merge `080efde` exists; proactive-speech tip `3e3b8c4` exists only on its local feature branch and not on `master`.

- [ ] **Step 4: Mark the documentation checklist complete and append final evidence**

In `checklist.md`, check the four remaining boxes under “Codex 프로젝트 컨텍스트 초기화 문서”. In `context-notes.md`, append the created commit hashes, link-validation result, stale-claim scan result, and the verified local-only proactive branch status.

- [ ] **Step 5: Commit the completion record**

```powershell
rtk git add checklist.md context-notes.md
rtk git commit -m "docs: record project context verification"
```

Expected: one commit containing only the two working-history documents.

- [ ] **Step 6: Confirm the worktree is clean**

Run:

```powershell
rtk git status --short --branch
```

Expected: `master` is ahead of `origin/master` and the worktree is clean.
