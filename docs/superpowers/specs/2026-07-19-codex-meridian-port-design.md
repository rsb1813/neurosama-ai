# Codex Meridian 포팅 설계

## 목적

Claude Code용 Meridian의 핵심 가치 가운데 프로젝트 문서 탐색과 계획·완료 검증만 Codex 네이티브 개인 플러그인으로 옮긴다. Claude 생명주기 훅, 세션 학습, 백그라운드 로그 수집은 포팅하지 않는다. 기존 저장소의 `.meridian/docs`, `.meridian/plans`, `WORKSPACE.md`, `checklist.md`, `context-notes.md`는 그대로 공유한다.

## 범위

플러그인은 네 개의 스킬을 제공한다.

1. `meridian:start`는 작업 시작 시 저장소 지침과 관련 문서를 선별한다.
2. `meridian:plan`은 비단순 작업의 계획, 체크리스트, 컨텍스트 노트를 준비한다.
3. `meridian:checkpoint`는 중요한 결정과 검증 결과만 기록한다.
4. `meridian:finish`는 완료 선언 전에 누락과 검증 상태를 확인한다.

세션 학습기, transcript 저장, action counter, 중지 훅, 자동 커밋, 자동 푸시, 자동 PR은 범위에서 제외한다.

## 설치 구조

`plugin-creator`의 기본 개인 마켓플레이스 흐름을 사용한다.

- 플러그인 원본은 `C:\Users\jolib\plugins\meridian`에 둔다.
- 개인 마켓플레이스는 `C:\Users\jolib\.agents\plugins\marketplace.json`을 사용한다.
- 플러그인 이름은 `meridian`, 초기 버전은 `0.1.0`이다.
- `.codex-plugin/plugin.json`은 `skills: "./skills/"`만 선언하고 hooks, MCP, apps는 선언하지 않는다.
- 마켓플레이스 항목은 `AVAILABLE`, `ON_INSTALL`, `Productivity` 정책을 사용한다.
- 원본 프로젝트와 MIT 라이선스를 `README.md`, `NOTICE.md`, `LICENSE`에 명시하고 Codex 호환 포팅판임을 구분한다.

플러그인 파일은 다음 구조를 갖는다.

```text
meridian/
├── .codex-plugin/plugin.json
├── README.md
├── NOTICE.md
├── LICENSE
├── skills/
│   ├── start/SKILL.md
│   ├── plan/SKILL.md
│   ├── checkpoint/SKILL.md
│   └── finish/SKILL.md
└── tests/fixtures/
```

## 스킬 동작

### `meridian:start`

1. 적용되는 `AGENTS.md`를 먼저 읽는다.
2. `WORKSPACE.md`, `ROADMAP.md`, `checklist.md`, `context-notes.md`의 존재 여부를 확인한다.
3. `.meridian/docs`가 있으면 각 Markdown 파일의 `summary`와 `read_when` frontmatter를 훑는다.
4. 현재 작업과 일치하는 문서만 읽고, 선택한 문서와 선택 이유를 짧게 보고한다.
5. `.meridian`이 없으면 오류로 중단하지 않고 일반 Codex 작업으로 계속한다.

frontmatter가 없거나 손상된 문서는 전체 작업을 막지 않는다. 해당 문서를 후보에서 제외하고 파일명과 이유만 알린다. frontmatter가 없는 필수 상위 문서는 파일 역할에 따라 읽는다.

### `meridian:plan`

사소한 질의, 한 줄 수정, 읽기 전용 확인에는 계획 파일을 만들지 않는다. 여러 파일을 수정하거나 설계 판단과 검증 단계가 필요한 작업은 비단순 작업으로 취급한다.

비단순 작업에서는 사용자 승인 전 구현하지 않는다. 승인 후 `.meridian/plans`에 구현 계획을 기록하고, 저장소에 기존 `checklist.md`와 `context-notes.md`가 있으면 작업별 구역을 추가한다. 기존 내용을 덮어쓰거나 전체 파일을 재정렬하지 않는다. 더 가까운 저장소 지침이 다른 위치나 형식을 요구하면 그 지침을 우선한다.

### `meridian:checkpoint`

다음 사건만 체크포인트로 기록한다.

- 설계 또는 범위 변경.
- 중요한 기술 결정과 기각한 대안.
- 반복 실패의 원인과 새 전략.
- 테스트, 타입 검사, 빌드, 수동 검증 결과.
- 다음 세션에서 반드시 알아야 할 미완료 상태.

도구 호출 횟수, 단순 파일 열람, 매 단계 진행 문구는 기록하지 않는다. 이 규칙으로 문서 소음과 토큰 사용을 제한한다.

### `meridian:finish`

완료 전에 다음 순서로 확인한다.

1. 계획과 체크리스트의 미완료 항목을 확인한다.
2. 실제 변경 파일과 계획 범위의 차이를 확인한다.
3. 저장소가 요구하는 테스트, 타입 검사, 빌드 또는 문서 정적 검사를 실행한다.
4. `git diff --check`와 `git status --short`로 공백 오류와 미추적 파일을 확인한다.
5. 문서 갱신, 커밋, 푸시, PR이 사용자 요청과 저장소 지침상 필요한지 구분한다.

실패한 검증을 통과했다고 표현하지 않는다. 미완료 항목이 있으면 완료 선언 대신 남은 작업과 근거를 보고한다. 외부 쓰기와 Git 변경은 사용자 요청 및 적용되는 지침의 권한 범위를 따른다.

## 호출과 자동성

Codex 플러그인에는 Claude의 `SessionStart`, `PreCompact`, `Stop` 훅을 복제하지 않는다. `meridian:start`의 설명을 프로젝트 진입, 작업 재개, 문서 탐색 요청에 맞게 작성해 Codex의 스킬 선택 대상이 되게 하고 플러그인 기본 프롬프트에서도 진입점을 제공한다. 사용자는 필요할 때 스킬을 명시적으로 호출할 수 있다.

따라서 자동 선택은 Codex의 스킬 라우팅에 의존하며 생명주기마다 강제 실행된다고 보장하지 않는다. 강제성이 필요한 규칙은 저장소 `AGENTS.md`에 두고, Meridian은 재사용 가능한 작업 흐름을 제공한다.

## 오류 처리와 안전

- `.meridian` 또는 상위 문서가 없어도 읽기 전용 탐색 결과를 보고하고 계속한다.
- 손상된 frontmatter 하나 때문에 다른 문서 탐색을 중단하지 않는다.
- 기존 문서를 자동 삭제하거나 전면 재작성하지 않는다.
- 체크리스트와 컨텍스트 노트는 작업별 구역만 추가하거나 갱신한다.
- 자동 학습, transcript 수집, 사용자 프롬프트 저장, 백그라운드 프로세스는 만들지 않는다.
- Claude 전용 환경 변수와 훅 이벤트를 참조하지 않는다.

## 검증 전략

플러그인 구조는 `plugin-creator/scripts/validate_plugin.py`로 검증한다. 네 스킬은 `skill-creator/scripts/quick_validate.py`로 각각 검증한다.

fixture는 다음 경우를 포함한다.

- `.meridian`이 없는 저장소.
- 정상 `summary`와 `read_when`이 있는 문서.
- 손상된 frontmatter가 섞인 문서.
- 기존 계획, 체크리스트, 컨텍스트 노트가 있는 저장소.
- 완료된 항목과 실패한 검증이 함께 있는 저장소.

설치 후 다음을 확인한다.

1. 개인 마켓플레이스 JSON이 기존 항목을 보존하고 Meridian 항목을 한 번만 포함한다.
2. `codex plugin add meridian@personal`이 성공한다.
3. 새 Codex 작업에서 네 스킬이 노출된다.
4. 실제 `neurosama-ai` 저장소에서 `meridian:start`가 관련 문서만 선택한다.
5. `meridian:finish`가 실패한 검증이나 미완료 체크리스트를 완료로 오인하지 않는다.

## 업데이트

로컬 플러그인 수정 시 마켓플레이스를 직접 재작성하지 않는다. `update_plugin_cachebuster.py`로 버전 suffix를 갱신하고 개인 마켓플레이스 이름을 읽은 뒤 플러그인을 재설치한다. 변경된 스킬을 확인할 때는 새 Codex 작업을 사용한다.

## 완료 조건

- Codex가 관련 프로젝트 문서를 선별해 읽고 선택 근거를 보고한다.
- 비단순 작업에서 승인된 계획과 기존 체크리스트·컨텍스트 노트를 안전하게 유지한다.
- 완료 전에 실제 검증 결과와 Git 상태를 확인한다.
- `.meridian` 부재와 손상된 frontmatter가 전체 작업을 중단시키지 않는다.
- Claude 훅과 세션 학습 없이 네 스킬만으로 동작한다.
- 플러그인과 네 스킬의 정적 검증 및 개인 마켓플레이스 설치가 모두 성공한다.
