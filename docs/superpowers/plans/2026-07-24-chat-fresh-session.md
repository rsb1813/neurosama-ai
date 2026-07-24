# Neru 자동 발화 1회 및 채팅 새 세션 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** 사용자 입력 뒤 자동 발화를 최대 한 번만 허용하고, 채팅 쓰레기통 버튼을 누르면 현재 대화를 삭제한 뒤 같은 캐릭터의 완전히 새로운 세션을 시작합니다.

**구조:** 자동 발화 훅의 기본 연속 횟수를 1로 낮춥니다. 세션 저장소에는 새 세션을 먼저 활성화한 뒤 이전 세션을 삭제하는 원자적 교체 동작을 추가하고, maintenance와 멀티 윈도우 chat-sync 경계를 통해 UI에서 호출합니다. 시스템 프롬프트와 캐릭터 설정은 변경하지 않습니다.

**기술:** Vue 3, Pinia, TypeScript, Vitest, Electron renderer BroadcastChannel.

## 전역 제약

- 시스템 프롬프트 파일은 수정하지 않습니다.
- 새 세션 생성 실패 시 기존 세션을 보존합니다.
- 성공 후 과거 세션으로 자동 복귀하지 않습니다.
- follower 창의 요청은 authority 창에서 정확히 한 번 실행합니다.
- 구현 중 별도 커밋을 만들지 않고 모든 검증 뒤 하나의 의미 단위로 커밋합니다.

### 작업 1. 자동 발화 기본값을 1회로 제한

**파일**

- 수정. `airi/packages/stage-ui/src/composables/use-proactive-speech.test.ts`
- 수정. `airi/packages/stage-ui/src/composables/use-proactive-speech.ts`

- [ ] `maxConsecutive`를 생략한 기본 설정에서 첫 자동 발화만 실행되고 다음 타이머가 예약되지 않는 테스트를 작성합니다.
- [ ] `recordUserActivity()` 뒤에는 다시 한 번 자동 발화할 수 있음을 같은 테스트에서 확인합니다.
- [ ] 아래 명령으로 실패를 확인합니다.

```powershell
rtk pnpm -F @proj-airi/stage-ui exec vitest run src/composables/use-proactive-speech.test.ts
```

- [ ] 훅의 문서와 기본값을 `1`로 바꿉니다.
- [ ] 같은 명령으로 테스트 통과를 확인합니다.

### 작업 2. 현재 세션을 새 세션으로 교체

**파일**

- 수정. `airi/packages/stage-ui/src/stores/chat/session-store.test.ts`
- 수정. `airi/packages/stage-ui/src/stores/chat/session-store.ts`
- 수정. `airi/packages/stage-ui/src/stores/chat/maintenance.ts`

- [ ] 기존 세션에 메시지를 넣고 교체했을 때 새 ID가 활성화되며 이전 세션이 삭제되고 새 세션에는 초기 시스템 메시지만 남는 테스트를 작성합니다.
- [ ] 아래 명령으로 실패를 확인합니다.

```powershell
rtk pnpm -F @proj-airi/stage-ui exec vitest run src/stores/chat/session-store.test.ts
```

- [ ] `replaceSession(sessionId)`를 추가합니다. 같은 캐릭터의 새 세션을 먼저 생성·활성화하고 성공한 뒤 이전 세션을 삭제합니다.
- [ ] maintenance의 정리 동작을 `startNewSession`으로 바꾸고 진행 중 전송 취소, 컨텍스트 초기화, 스트림 초기화 후 세션을 교체합니다.
- [ ] 같은 명령으로 테스트 통과를 확인합니다.

### 작업 3. 쓰레기통 요청을 authority에서 한 번만 실행

**파일**

- 수정. `airi/apps/stage-tamagotchi/src/renderer/stores/chat-sync.test.ts`
- 수정. `airi/apps/stage-tamagotchi/src/renderer/stores/chat-sync.ts`
- 수정. `airi/apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue`

- [ ] follower의 새 세션 요청이 authority의 `startNewSession`을 정확히 한 번 호출하는 테스트를 작성합니다.
- [ ] 아래 명령으로 실패를 확인합니다.

```powershell
rtk pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/renderer/stores/chat-sync.test.ts
```

- [ ] chat-sync 명령을 `new-session`으로 바꾸고 `requestNewSession(sessionId)`을 노출합니다.
- [ ] 쓰레기통 핸들러가 현재 활성 세션 ID로 새 API를 호출하도록 바꿉니다.
- [ ] 같은 명령으로 테스트 통과를 확인합니다.

### 작업 4. 문서 갱신과 전체 검증

**파일**

- 수정. `checklist.md`
- 수정. `context-notes.md`
- 수정. `WORKSPACE.md`

- [ ] 작업 결과와 검증 상태를 문서에 반영합니다.
- [ ] 집중 테스트를 모두 다시 실행합니다.

```powershell
rtk pnpm -F @proj-airi/stage-ui exec vitest run src/composables/use-proactive-speech.test.ts src/stores/chat/session-store.test.ts
rtk pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/renderer/stores/chat-sync.test.ts
```

- [ ] 변경 파일 ESLint와 두 패키지 타입 검사를 실행합니다.

```powershell
rtk pnpm exec eslint packages/stage-ui/src/composables/use-proactive-speech.ts packages/stage-ui/src/composables/use-proactive-speech.test.ts packages/stage-ui/src/stores/chat/session-store.ts packages/stage-ui/src/stores/chat/session-store.test.ts packages/stage-ui/src/stores/chat/maintenance.ts apps/stage-tamagotchi/src/renderer/stores/chat-sync.ts apps/stage-tamagotchi/src/renderer/stores/chat-sync.test.ts apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue
pnpm.cmd --filter @proj-airi/stage-ui run typecheck
pnpm.cmd --filter @proj-airi/stage-tamagotchi run typecheck
```

- [ ] diff 무결성과 시스템 프롬프트 무변경을 확인합니다.

```powershell
git diff --check
git diff --exit-code HEAD -- airi/packages/stage-ui/src/constants/neru-persona.ts
```

- [ ] diff를 자체 검토하고 하나의 구현 커밋으로 저장한 뒤 기존 PR 브랜치에 푸시합니다.
