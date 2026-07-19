# neru 프로젝트 가이드

## 프로젝트 요약

- neru는 vendored Project AIRI 기반의 로컬 AI VTuber 데스크톱 시스템입니다.
- 사용자의 한국어 입력에 영어 음성 및 `<ko>한국어</ko>` 화면 자막으로 응답하는 고정 언어 흐름입니다.
- 실제 구현은 `airi/`에 있고 GPU 음성 게이트웨이는 `airi/services/neru-audio/`에 있습니다.
- 로컬 LLM 프록시는 `127.0.0.1:3456`, neru-audio는 `127.0.0.1:3457`을 사용합니다.

## 먼저 읽을 문서

1. `WORKSPACE.md`에서 현재 상태, 알려진 문제, 다음 작업을 확인합니다.
2. `ROADMAP.md`에서 제품 비전과 단계별 상태를 확인합니다.
3. `checklist.md`에서 최근 작업 이력을 확인합니다.
4. `context-notes.md`에서 결정과 근거를 확인합니다.
5. `docs/superpowers/specs/`와 `docs/superpowers/plans/`에서 기능별 승인 사양과 구현 계획을 확인합니다.

## 코드 위치

- `airi/apps/stage-tamagotchi/`는 Electron 데스크톱 셸과 main/renderer IPC를 담당합니다.
- `airi/packages/stage-ui/`는 채팅, 아바타, 자동 발화, 화면 UI의 중심입니다.
- `airi/packages/core-agent/`는 LLM 및 구성과 스트리밍을 담당합니다.
- `airi/services/neru-audio/`는 FastAPI 기반 Chatterbox TTS와 faster-whisper STT입니다.
- `infra/searxng/`은 로컬 웹 검색 인프라입니다.

## 작업 규칙

- 문서와 코드가 충돌하면 Git과 실제 코드를 확인하고 관련 상위 문서를 함께 갱신합니다.
- 머지 완료, 로컬 브랜치 완료, 수동 검증 완료를 서로 다른 상태로 기록합니다.
- `airi/` 아래 작업에는 가장 가까운 `airi/AGENTS.md` 지침도 적용합니다.
- 기존 AIRI 업스트림 코드는 요청 범위 밖에서 정리하거나 대규모 리팩터링하지 않습니다.
- 버그 수정은 가능한 경우 재현 테스트를 먼저 작성합니다.

## 검증 명령

- stage-ui 테스트. `cd airi; pnpm -F @proj-airi/stage-ui test:run`
- stage-ui 타입 검사. `cd airi; pnpm -F @proj-airi/stage-ui typecheck`
- core-agent 타입 검사. `cd airi; pnpm -F @proj-airi/core-agent typecheck`
- Electron 타입 검사. `cd airi; pnpm -F @proj-airi/stage-tamagotchi typecheck`
- 리포지터리 린트. `cd airi; pnpm lint`
- 문서만 변경했을 때는 `git diff --check`와 변경된 상대 링크별 `Test-Path <path>` 검사를 수행합니다.

## 보안 불변 조건

- TTS로 전달하는 발화는 영어여야 하고 한국어는 `<ko>` 자막 구간에만 둡니다.
- 자동 발화의 시스템 넛지는 세션 히스토리에 영속하지 않아야 합니다.
- barge-in은 진행 중인 생성과 음성을 취소하며 정상 중단을 오류로 취급하지 않습니다.
- `/v1/*` 로컬 오디오 API는 bearer 인증과 host/origin 제한을 완화하지 않습니다.
- 사용자, 채팅, 웹, 도구 입력은 신뢰하지 않으며 IPC 및 파일 경계에서 검증합니다.

## Review guidelines

- 인증 우회, 자격 증명 노출, 위험한 경로 역참조, 검증 없는 IPC 입력을 우선 확인합니다.
- 영어 음성 및 한국어 자막 경계가 깨져 한국어가 TTS로 들어가는 경우를 높은 위험으로 봅니다.
- 자동 발화와 barge-in에서 중복 턴, 리스너 누수, 히스토리 오염, 취소 및 정리 누락을 확인합니다.
- 버그 수정에는 해당 실패를 재현하는 최소 테스트가 있는지 확인합니다.
- 변경과 무관한 AIRI 업스트림 문제를 리뷰 결함으로 처리하지 않습니다.
