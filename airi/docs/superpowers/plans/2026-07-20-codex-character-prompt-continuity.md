# Codex Character Prompt Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AIRI가 조립한 현재 시스템 메시지를 Codex 지침으로 전달하고, 해당 지침이나 실제 모델 override가 바뀔 때만 새 Codex thread를 시작한다.

**Architecture:** 렌더러 Codex 브리지가 전송 직전에 시스템 메시지와 runtime override를 읽어 지침과 SHA-256 thread 서명을 만든다. 세션별 저장값은 thread ID와 서명을 함께 보관하며, 서명이 일치할 때만 resume한다.

**Tech Stack:** TypeScript, Vue 메시지 모델, Electron Eventa IPC, Vitest, Web Crypto API, localStorage.

## Global Constraints

- 현재 시스템 메시지가 없을 때만 고정 Neru 프롬프트를 폴백으로 사용한다.
- 프롬프트나 모델 override 변경 외에는 기존 thread 연속성을 보존한다.
- 기존 문자열 저장값은 최초 요청에서 새 thread로 전환한다.
- 전체 AIRI 과거 대화 이식, 도구 목록 서명, 기본 모델·서비스 티어 강제는 범위에서 제외한다.
- 새 의존성을 추가하지 않는다.

---

### Task 1: 동적 지침과 서명 기반 thread 재사용

**Files:**
- Modify: `apps/stage-tamagotchi/src/renderer/bridges/codex.ts`
- Test: `apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts`
- Modify: `../checklist.md`
- Modify: `../context-notes.md`

**Interfaces:**
- Consumes: `LlmTransportRequest.messages`, `CodexBridgeDeps.developerInstructions`, `CodexRuntimeOverrides.model`, `localStorage`의 `neru/codex/thread-ids`.
- Produces: `CodexTurnRequest.developerInstructions`에 현재 시스템 메시지, `{ threadId, signature }` 세션 저장값, 서명 일치 시에만 설정되는 `CodexTurnRequest.threadId`.

- [ ] **Step 1: 동적 시스템 메시지 전달 실패 테스트 작성**

```ts
it('uses the composed system message as Codex developer instructions', async () => {
  const harness = createHarness()
  const stream = harness.bridge.transport({
    providerId: 'codex-oauth',
    sessionId: 'session-1',
    model: 'codex-configured',
    messages: [
      { role: 'system', content: 'You are the currently selected character.' },
      { role: 'user', content: 'Hello.' },
    ],
    tools: [],
    options: {},
  })

  await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledOnce())
  const request = harness.startTurn.mock.calls[0][0]
  expect(request.developerInstructions).toBe('You are the currently selected character.')
  await harness.emit({ type: 'finish', streamId: request.streamId, threadId: 'thread-1', turnId: 'turn-1' })
  await stream
})
```

- [ ] **Step 2: 집중 테스트를 실행해 고정 지침 때문에 실패하는지 확인**

Run: `pnpm exec vitest run src/renderer/bridges/codex.test.ts`

Working directory: `apps/stage-tamagotchi`

Expected: 새 테스트가 `You are Neru.`를 받아 FAIL한다.

- [ ] **Step 3: thread 재사용 조건 테스트 작성**

다음 네 동작을 각각 검증한다.

```ts
expect(secondRequest.threadId).toBe('thread-1')
expect(changedPromptRequest.threadId).toBeUndefined()
expect(changedModelRequest.threadId).toBeUndefined()
expect(legacyStorageRequest.threadId).toBeUndefined()
```

동일한 시스템 메시지와 `overrides.model`에서는 저장된 thread를 재사용하고, 프롬프트 또는 모델 변경과 기존 문자열 저장값에서는 새 thread를 시작하도록 테스트한다.

- [ ] **Step 4: 집중 테스트를 실행해 저장 형식과 서명 로직 부재로 실패하는지 확인**

Run: `pnpm exec vitest run src/renderer/bridges/codex.test.ts`

Working directory: `apps/stage-tamagotchi`

Expected: 기존 코드는 세션 ID만으로 thread를 재사용해 변경·마이그레이션 테스트가 FAIL한다.

- [ ] **Step 5: 현재 시스템 지침 선택과 SHA-256 서명을 최소 구현**

```ts
interface StoredThread {
  threadId: string
  signature: string
}

function developerInstructions(messages: Message[], fallback: string): string {
  const systemMessage = messages.find(message => message.role === 'system')
  const content = systemMessage?.content
  if (typeof content === 'string' && content.trim())
    return content
  return fallback
}

async function threadSignature(instructions: string, model: string | undefined): Promise<string> {
  const input = new TextEncoder().encode(JSON.stringify([model ?? null, instructions]))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  return `v1:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`
}
```

전송 함수에서 override를 한 번만 읽고, 지침과 서명을 만든 뒤 일치하는 `{ threadId, signature }`만 resume한다. 성공한 thread는 현재 서명과 함께 저장한다.

- [ ] **Step 6: 집중 테스트와 LLM 전송기 회귀 테스트 실행**

Run: `pnpm exec vitest run src/renderer/bridges/codex.test.ts`

Working directory: `apps/stage-tamagotchi`

Expected: 모든 Codex 브리지 테스트 PASS.

Run: `pnpm exec vitest run src/stores/llm.test.ts`

Working directory: `packages/stage-ui`

Expected: 31개 LLM 전송기 테스트 PASS.

- [ ] **Step 7: 변경 파일 린트와 diff 검사 실행**

Run: `pnpm exec eslint apps/stage-tamagotchi/src/renderer/bridges/codex.ts apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts`

Expected: 새 오류 없음. 테스트 파일의 기존 `style/max-statements-per-line`과 `test/prefer-lowercase-title` 두 오류가 남으면 기존 커밋의 줄임을 `git blame`으로 확인해 별도 보고한다.

Run: `git diff --check`

Expected: 출력 없이 exit 0.

- [ ] **Step 8: 앱 재시작 후 실제 응답 형식 검증**

Neru 앱을 재시작하고 `5173`과 인증된 `3457/v1/models`가 HTTP 200인지 확인한다. 새 채팅에서 짧은 한국어 인사를 보내 영어 발화, `<ko>` 번역, 첫 ACT 감정 토큰이 모두 출력되는지 확인한다.

- [ ] **Step 9: 작업 기록 갱신과 커밋**

```bash
git add apps/stage-tamagotchi/src/renderer/bridges/codex.ts \
  apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts \
  ../checklist.md ../context-notes.md
git commit -m "fix(codex): preserve character prompt continuity"
```

