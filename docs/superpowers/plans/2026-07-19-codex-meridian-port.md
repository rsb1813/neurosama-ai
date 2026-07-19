# Codex Meridian 포팅 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 문서 탐색과 계획·체크포인트·완료 검증을 제공하는 개인 Codex 플러그인 `meridian`을 구현하고 설치한다.

**Architecture:** 실행 코드나 생명주기 훅 없이 네 개의 독립적인 절차형 스킬이 같은 저장소 문서를 읽고 갱신한다. 플러그인 원본은 `C:\Users\jolib\plugins\meridian`, 등록 정보는 개인 마켓플레이스 `C:\Users\jolib\.agents\plugins\marketplace.json`에 두며, 저장소에는 설계·계획·작업 이력만 기록한다.

**Tech Stack:** Codex 개인 플러그인, Markdown 기반 `SKILL.md`, JSON 플러그인 매니페스트, Python 정적 검증 도구, PowerShell 검증 명령.

## Global Constraints

- 플러그인 이름은 `meridian`, 초기 버전은 `0.1.0`으로 고정한다.
- 제공 스킬은 `start`, `plan`, `checkpoint`, `finish` 네 개뿐이다.
- hooks, MCP servers, apps, 세션 학습, transcript 저장, action counter, 자동 커밋·푸시·PR을 추가하지 않는다.
- 기존 `.meridian/docs`, `.meridian/plans`, `WORKSPACE.md`, `ROADMAP.md`, `checklist.md`, `context-notes.md`를 재사용하고 기존 내용을 덮어쓰지 않는다.
- 저장소의 `AGENTS.md`와 사용자의 명시적 요청이 플러그인 지침보다 우선한다.
- 플러그인 원본 디렉터리에 새 Git 저장소를 만들지 않는다.
- 원본 Meridian 0.8.0의 MIT 선언과 출처를 `LICENSE`와 `NOTICE.md`에 보존하되 Claude 전용 코드는 복사하지 않는다.
- 새 소스 파일을 만들 경우 첫 줄에 파일 역할을 설명하는 한 줄짜리 한국어 주석을 둔다. 이번 구현은 소스 파일을 만들지 않는다.
- 이 Windows 환경은 `python`이 PATH에 없으므로 검증된 `C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`를 사용한다.
- `quick_validate.py`가 Windows 기본 인코딩으로 읽으므로 네 `SKILL.md`는 ASCII 영어로 작성하고 한국어 UI 문구는 `agents/openai.yaml`에만 둔다.

---

### Task 1: 개인 플러그인 골격과 메타데이터 생성

**Files:**
- Create: `C:\Users\jolib\plugins\meridian\.codex-plugin\plugin.json`
- Create: `C:\Users\jolib\plugins\meridian\README.md`
- Create: `C:\Users\jolib\plugins\meridian\NOTICE.md`
- Create: `C:\Users\jolib\plugins\meridian\LICENSE`
- Modify or Create: `C:\Users\jolib\.agents\plugins\marketplace.json`

**Interfaces:**
- Consumes: `create_basic_plugin.py`의 기본 개인 마켓플레이스 계약.
- Produces: `skills/`를 가리키는 검증 가능한 `meridian` 플러그인과 `meridian@personal` 설치 항목.

- [ ] **Step 1: 실행 시점의 충돌 여부를 확인한다**

```powershell
Test-Path C:\Users\jolib\plugins\meridian
Test-Path C:\Users\jolib\.agents\plugins\marketplace.json
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe --version
```

Expected: 현재 기준으로 앞의 두 명령은 `False`, 마지막 명령은 `Python 3.11.15`. 실행 시 앞의 두 값 중 하나라도 `True`면 내용을 읽고 `meridian` 항목이나 디렉터리를 덮어쓰기 전에 중단해 사용자 변경인지 확인한다.

- [ ] **Step 2: 공식 생성기로 플러그인과 개인 마켓플레이스를 만든다**

```powershell
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\plugin-creator\scripts\create_basic_plugin.py meridian --path C:\Users\jolib\plugins --with-skills --with-marketplace
```

Expected: `Created plugin scaffold: C:\Users\jolib\plugins\meridian`과 개인 마켓플레이스 경로가 출력된다. 샌드박스가 사용자 홈 쓰기를 차단하면 동일 명령을 승인받아 다시 실행한다.

- [ ] **Step 3: 생성된 매니페스트를 최소 계약으로 교체한다**

```json
{
  "name": "meridian",
  "version": "0.1.0",
  "description": "Route project context and verify planned work in Codex.",
  "author": {
    "name": "rsb1813"
  },
  "homepage": "https://github.com/markmdev/meridian",
  "repository": "https://github.com/markmdev/meridian",
  "license": "MIT",
  "keywords": [
    "context",
    "planning",
    "verification"
  ],
  "skills": "./skills/",
  "interface": {
    "displayName": "Meridian for Codex",
    "shortDescription": "프로젝트 문맥과 작업 완료 상태를 관리합니다.",
    "longDescription": "관련 프로젝트 문서를 선별하고 계획, 체크포인트, 완료 검증 흐름을 제공합니다.",
    "developerName": "rsb1813",
    "category": "Productivity",
    "capabilities": [
      "Project document routing",
      "Planning and completion verification"
    ],
    "defaultPrompt": "현재 저장소의 관련 문서를 찾아 작업 문맥을 정리하고 필요한 Meridian 스킬을 사용해 주세요."
  }
}
```

Expected: `hooks`, `mcpServers`, `apps` 키가 없다.

- [ ] **Step 4: 사용자 문서와 출처 고지를 작성한다**

`README.md`에는 네 스킬의 목적, 명시적 호출 예시, 자동 선택은 Codex 라우팅에 의존한다는 한계, 강제 규칙은 `AGENTS.md`에 둔다는 설명을 적는다. 업데이트 절차는 `update_plugin_cachebuster.py`, `read_marketplace_name.py`, `codex plugin add meridian@<출력된 이름>` 순서로 안내하고 업데이트 후 새 Codex 작업이 필요하다고 명시한다.

`NOTICE.md`에는 아래 내용을 그대로 넣는다.

```markdown
# Third-party notice

This plugin is a Codex compatibility port inspired by Meridian 0.8.0.

- Original project: https://github.com/markmdev/meridian
- Original author: Mark Morgan
- Original license: MIT

Claude lifecycle hooks, background session learning, transcripts, and automatic Git actions are not included in this port.
```

원본 캐시의 `.claude-plugin/plugin.json`에 MIT가 명시된 것을 근거로 표준 MIT 전문을 `LICENSE`에 넣고, 저작권 고지는 `Copyright (c) Mark Morgan`으로 보존한다. 연도를 추측하지 않는다.

- [ ] **Step 5: 빈 스킬 디렉터리 상태의 플러그인을 검증한다**

```powershell
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py C:\Users\jolib\plugins\meridian
```

Expected: `Plugin validation passed: C:\Users\jolib\plugins\meridian`.

### Task 2: `start`와 `plan` 스킬 구현

**Files:**
- Create: `C:\Users\jolib\plugins\meridian\skills\start\SKILL.md`
- Create: `C:\Users\jolib\plugins\meridian\skills\start\agents\openai.yaml`
- Create: `C:\Users\jolib\plugins\meridian\skills\plan\SKILL.md`
- Create: `C:\Users\jolib\plugins\meridian\skills\plan\agents\openai.yaml`

**Interfaces:**
- Consumes: 적용 범위의 `AGENTS.md`, 루트 운영 문서, `.meridian/docs/*.md`의 `summary`와 `read_when` frontmatter.
- Produces: 선택 문서와 선택 근거 보고, 승인 가능한 구현 계획, 기존 체크리스트·컨텍스트 노트의 최소 갱신.

- [ ] **Step 1: 생성 전 검증이 실패하는지 확인한다**

```powershell
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\jolib\plugins\meridian\skills\start
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\jolib\plugins\meridian\skills\plan
```

Expected: 두 명령 모두 스킬 디렉터리 또는 `SKILL.md`가 없어서 실패한다.

- [ ] **Step 2: 공식 초기화기로 두 스킬을 생성한다**

```powershell
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\skill-creator\scripts\init_skill.py start --path C:\Users\jolib\plugins\meridian\skills --interface display_name="Meridian Start" --interface short_description="관련 프로젝트 문서를 선별합니다." --interface default_prompt="현재 작업에 필요한 저장소 문서를 찾아 문맥을 정리해 주세요."
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\skill-creator\scripts\init_skill.py plan --path C:\Users\jolib\plugins\meridian\skills --interface display_name="Meridian Plan" --interface short_description="비단순 작업의 계획과 추적 문서를 준비합니다." --interface default_prompt="현재 작업의 구현 계획과 체크리스트를 준비해 주세요."
```

Expected: `skills/start`와 `skills/plan`에 `SKILL.md`와 `agents/openai.yaml`이 생성된다.

- [ ] **Step 3: `start/SKILL.md`를 아래 계약으로 교체한다**

```markdown
---
name: start
description: Select and read only the project documents relevant to the current task. Use when entering or resuming a repository, when the user asks for project context, or before work that depends on WORKSPACE.md, ROADMAP.md, checklist.md, context-notes.md, or .meridian/docs metadata.
---

# Start

1. Read the repository root and every applicable `AGENTS.md` before other project documents.
2. Check whether `WORKSPACE.md`, `ROADMAP.md`, `checklist.md`, and `context-notes.md` exist.
3. If `.meridian/docs` exists, inspect only the first frontmatter block of each Markdown file for `summary` and `read_when`.
4. Read the body only when `read_when` matches the current request. Read only the relevant sections of required operating documents.
5. Report each selected document and one short reason, then continue the task.

Do not stop when `.meridian` is absent. Exclude missing or malformed frontmatter from automatic routing and report the file name and reason. If the user names a document or a higher-priority instruction requires it, follow that instruction regardless of frontmatter.

Do not create or modify files. Do not run Claude hooks, session recording, or background processes.
```

- [ ] **Step 4: `plan/SKILL.md`를 아래 계약으로 교체한다**

```markdown
---
name: plan
description: Prepare an implementation-ready plan and safely maintain repository checklists and context notes. Use before multi-file changes, design decisions, migrations, or any non-trivial task that needs explicit scope, verification criteria, and user approval.
---

# Plan

1. Read applicable `AGENTS.md` files and relevant project documents, then verify the current state from real files.
2. Do not create a plan file for a simple question, one-line edit, or read-only check.
3. For non-trivial work, specify the goal, scope, exact file paths, verification commands, and completion criteria.
4. Use the repository-defined plan location. If none exists, use `.meridian/plans/YYYY-MM-DD-<slug>.md`.
5. If `checklist.md` and `context-notes.md` exist, add or update only the current task section. Do not delete or reorder another task's entries.
6. Ask the user to approve the plan before implementation. Do not modify implementation files before approval.

Do not guess paths, commands, or APIs. Surface any decision that cannot be verified from the repository. Do not leave unresolved placeholder markers in the plan.
```

- [ ] **Step 5: 두 스킬의 정적 검증을 통과시킨다**

```powershell
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\jolib\plugins\meridian\skills\start
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\jolib\plugins\meridian\skills\plan
```

Expected: 두 명령 모두 `Skill is valid!`.

### Task 3: `checkpoint`와 `finish` 스킬 구현

**Files:**
- Create: `C:\Users\jolib\plugins\meridian\skills\checkpoint\SKILL.md`
- Create: `C:\Users\jolib\plugins\meridian\skills\checkpoint\agents\openai.yaml`
- Create: `C:\Users\jolib\plugins\meridian\skills\finish\SKILL.md`
- Create: `C:\Users\jolib\plugins\meridian\skills\finish\agents\openai.yaml`

**Interfaces:**
- Consumes: 현재 계획, 체크리스트, 컨텍스트 노트, 실제 Git 변경과 검증 출력.
- Produces: 중요한 결정만 남긴 체크포인트와 근거가 있는 완료·미완료 판정.

- [ ] **Step 1: 생성 전 검증이 실패하는지 확인한다**

```powershell
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\jolib\plugins\meridian\skills\checkpoint
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\jolib\plugins\meridian\skills\finish
```

Expected: 두 명령 모두 스킬 디렉터리 또는 `SKILL.md`가 없어서 실패한다.

- [ ] **Step 2: 공식 초기화기로 두 스킬을 생성한다**

```powershell
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\skill-creator\scripts\init_skill.py checkpoint --path C:\Users\jolib\plugins\meridian\skills --interface display_name="Meridian Checkpoint" --interface short_description="중요 결정과 검증 결과를 기록합니다." --interface default_prompt="현재 작업의 중요한 결정과 남은 상태만 체크포인트로 기록해 주세요."
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\skill-creator\scripts\init_skill.py finish --path C:\Users\jolib\plugins\meridian\skills --interface display_name="Meridian Finish" --interface short_description="완료 선언 전에 누락과 검증 상태를 확인합니다." --interface default_prompt="계획, 체크리스트, 테스트와 Git 상태를 확인해 완료 여부를 판정해 주세요."
```

Expected: `skills/checkpoint`와 `skills/finish`에 `SKILL.md`와 `agents/openai.yaml`이 생성된다.

- [ ] **Step 3: `checkpoint/SKILL.md`를 아래 계약으로 교체한다**

```markdown
---
name: checkpoint
description: Record only durable decisions, failures, verification results, and remaining work for the current task. Use after a scope change, an important technical decision, a repeated failure, a successful verification, or before handing work to another session.
---

# Checkpoint

1. Find the plan and checklist section for the current task.
2. Check only items whose completion is proven. Never mark a failed or unexecuted verification complete.
3. If `context-notes.md` exists, append only durable decisions and rationale, confirmed causes of repeated failures, verification commands and results, and work that a later session must resume.
4. If no tracking document exists, do not create one without a user request or repository instruction. Report that there is no approved recording location.
5. Report the documents changed and every remaining incomplete item.

Do not record routine progress text, tool-call counts, token usage, or full conversation transcripts. Do not rewrite existing records or change another task's checkboxes.
```

- [ ] **Step 4: `finish/SKILL.md`를 아래 계약으로 교체한다**

```markdown
---
name: finish
description: Verify planned work before claiming completion. Use when the user asks whether work is done, before a final handoff, commit, push, or pull request, or whenever tests, checklist state, documentation, and Git changes must be reconciled.
---

# Finish

1. Find every required incomplete item in the approved plan and current task checklist.
2. Compare `git status --short` and the actual changed files with the approved scope.
3. Run the repository-defined tests, static checks, build, or documentation validation. Discover commands from manifests and instructions instead of guessing.
4. Run `git diff --check` and inspect unexpected files, whitespace errors, and untracked artifacts.
5. Report the commands executed, pass or fail results, and remaining required work with evidence.

Do not claim completion when a required check failed or was not run without equivalent evidence. Withhold completion while a required checklist item remains. Update documents, commit, push, or open a pull request only when the user request and repository instructions authorize it. Never hide a failure or describe an unexecuted check as passing.
```

- [ ] **Step 5: 두 스킬의 정적 검증을 통과시킨다**

```powershell
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\jolib\plugins\meridian\skills\checkpoint
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\jolib\plugins\meridian\skills\finish
```

Expected: 두 명령 모두 `Skill is valid!`.

### Task 4: 실패 경로 fixture와 전체 계약 검증

**Files:**
- Create: `C:\Users\jolib\plugins\meridian\tests\fixtures\no-meridian\README.md`
- Create: `C:\Users\jolib\plugins\meridian\tests\fixtures\docs-routing\.meridian\docs\auth.md`
- Create: `C:\Users\jolib\plugins\meridian\tests\fixtures\docs-routing\.meridian\docs\broken.md`
- Create: `C:\Users\jolib\plugins\meridian\tests\fixtures\finish-failure\checklist.md`
- Create: `C:\Users\jolib\plugins\meridian\tests\fixtures\finish-failure\verification.txt`
- Create: `C:\Users\jolib\plugins\meridian\tests\fixtures\SCENARIOS.md`

**Interfaces:**
- Consumes: 네 스킬의 문서 탐색과 완료 판정 계약.
- Produces: 새 Codex 작업이나 승인된 서브에이전트가 정답을 미리 전달받지 않고 실행할 수 있는 최소 fixture.

- [ ] **Step 1: 세 가지 fixture를 만든다**

`docs-routing/.meridian/docs/auth.md`에는 아래 내용을 넣는다.

```markdown
---
summary: 로그인 토큰 갱신 규칙
read_when:
  - 인증 또는 토큰 갱신 작업
---

# 인증

토큰 갱신은 단일 비행으로 처리한다.
```

`docs-routing/.meridian/docs/broken.md`에는 닫히지 않은 frontmatter를 넣는다.

```markdown
---
summary: 손상된 문서
read_when:
  - 모든 작업

# 손상된 문서
```

`finish-failure/checklist.md`에는 아래 내용을 넣는다.

```markdown
# 작업 체크리스트

- [x] 구현
- [ ] 필수 테스트
```

`finish-failure/verification.txt`에는 `pytest: FAILED`를 넣고, `no-meridian/README.md`에는 `# 저장소`만 넣는다.

- [ ] **Step 2: fixture별 중립 요청을 기록한다**

`SCENARIOS.md`에는 아래 요청만 기록하고 기대 답안은 적지 않는다.

```markdown
# Meridian forward-test scenarios

1. `no-meridian`에서 `meridian:start`를 사용해 저장소 문맥을 정리해 주세요.
2. `docs-routing`에서 인증 토큰 갱신 작업에 필요한 문서만 찾아 주세요.
3. `finish-failure`에서 현재 작업이 완료되었는지 `meridian:finish`로 판정해 주세요.
4. 실제 `neurosama-ai`에서 문서 작업을 재개하기 위한 관련 문서만 찾아 주세요.
```

- [ ] **Step 3: 전체 정적 검증과 금지 구성 검사를 실행한다**

```powershell
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py C:\Users\jolib\plugins\meridian
Get-ChildItem C:\Users\jolib\plugins\meridian\skills -Directory | ForEach-Object { & C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\skill-creator\scripts\quick_validate.py $_.FullName }
if (rg -n '"(hooks|mcpServers|apps)"' C:\Users\jolib\plugins\meridian\.codex-plugin\plugin.json) { throw 'Forbidden plugin component found' }
if (rg -n "TODO|TBD|PLACEHOLDER" C:\Users\jolib\plugins\meridian) { throw 'Placeholder found' }
```

Expected: 플러그인과 네 스킬 검증이 성공하고 두 금지 검사가 출력 없이 통과한다.

- [ ] **Step 4: 승인된 실행 방식에서 세 fixture를 forward-test한다**

각 테스트 작업에는 대상 스킬 경로와 `SCENARIOS.md`의 요청 한 줄만 전달한다. 정답, 설계 의도, 예상 실패 원인은 전달하지 않는다.

Expected: `no-meridian`은 중단하지 않고, `docs-routing`은 `auth.md`를 선택하면서 `broken.md`를 손상 문서로 보고하며, `finish-failure`는 완료 선언을 보류한다. 실패한 시나리오가 있으면 해당 `SKILL.md`만 최소 수정하고 Step 3부터 반복한다.

### Task 5: 설치 검증과 저장소 이력 마감

**Files:**
- Modify: `C:\Users\jolib\Documents\neurosama-ai\.worktrees\codex-meridian-port\checklist.md`
- Modify: `C:\Users\jolib\Documents\neurosama-ai\.worktrees\codex-meridian-port\context-notes.md`

**Interfaces:**
- Consumes: 검증이 끝난 개인 플러그인과 `personal` 마켓플레이스 항목.
- Produces: 설치된 `meridian@personal`, 재현 가능한 검증 기록, 하나의 의미 있는 저장소 커밋.

- [ ] **Step 1: 개인 마켓플레이스 이름과 항목을 확인한다**

```powershell
& C:\Users\jolib\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\jolib\.codex\skills\.system\plugin-creator\scripts\read_marketplace_name.py
Get-Content -Raw C:\Users\jolib\.agents\plugins\marketplace.json
```

Expected: 첫 명령은 `personal`을 출력하고 JSON에는 다른 항목을 보존한 채 `meridian`이 정확히 한 번 들어 있다.

- [ ] **Step 2: 플러그인을 설치하고 목록에서 확인한다**

```powershell
codex plugin add meridian@personal
codex plugin list
```

Expected: 설치 명령이 성공하고 목록에 `meridian@personal`이 표시된다. Codex 실행이 샌드박스에서 거부되면 동일 명령을 승인받아 다시 실행한다.

- [ ] **Step 3: 실제 저장소 검증을 새 Codex 작업으로 안내한다**

새 작업에서 다음 요청을 사용한다.

```text
meridian:start를 사용해 이 저장소의 문서 작업을 재개하는 데 필요한 문서만 찾아 주세요.
```

Expected: 적용되는 `AGENTS.md`를 먼저 읽고 `WORKSPACE.md`, `ROADMAP.md`, `checklist.md`, `context-notes.md`와 관련 `.meridian/docs`만 선택하며 이유를 보고한다. 현재 작업에서는 설치 전부터 로드된 스킬 목록을 성공 근거로 사용하지 않는다.

- [ ] **Step 4: 저장소 추적 문서를 실제 결과로 갱신한다**

`checklist.md`의 Meridian 구역에서 구현·검증·설치 항목은 실제 성공한 것만 체크한다. `context-notes.md`에는 생성한 플러그인 버전, 설치 경로, 실행한 검증 명령과 결과, 새 작업 검증의 남은 여부만 덧붙인다.

- [ ] **Step 5: 저장소 문서 검증을 실행한다**

```powershell
git diff --check
git status --short
rg -n "Codex Meridian 포팅|meridian@personal|C:\\Users\\jolib\\plugins\\meridian" checklist.md context-notes.md docs/superpowers/specs docs/superpowers/plans
```

Expected: `git diff --check`는 출력 없이 성공하고, 상태에는 `checklist.md`와 `context-notes.md`만 수정된 것으로 표시된다. `rg`는 설계·계획·이력의 연결 지점을 출력한다.

- [ ] **Step 6: 이력 갱신을 커밋한다**

```powershell
git add checklist.md context-notes.md
git commit -m "docs: record Codex Meridian installation"
```

Expected: 하나의 문서 커밋이 생성되고 `git status --short`가 비어 있다. 개인 플러그인 디렉터리는 이 저장소 커밋에 포함하지 않는다.

## 최종 검증 기준

- `validate_plugin.py`와 네 번의 `quick_validate.py`가 모두 성공한다.
- 플러그인 매니페스트에 hooks, MCP servers, apps가 없다.
- 세 fixture가 문서 부재, 손상된 frontmatter, 실패한 검증을 안전하게 처리한다.
- `codex plugin list`에서 `meridian@personal`이 확인된다.
- 새 Codex 작업에서 `meridian:start`가 실제 저장소의 관련 문서와 선택 이유를 보고한다.
- 저장소 작업 트리가 깨끗하고 계획·설계·결과 이력이 서로 연결된다.
