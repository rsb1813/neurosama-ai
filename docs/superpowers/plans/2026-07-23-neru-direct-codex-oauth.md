# Neru Direct Codex OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex CLI와 app-server 없이 Neru가 Device OAuth 자격 증명과 Codex Responses 스트리밍을 직접 처리한다.

**Architecture:** Electron main 프로세스에 암호화 자격 증명 저장소와 직접 Codex 클라이언트를 둔다. `@earendil-works/pi-ai`의 OpenAI Codex OAuth·Responses 구현을 좁은 어댑터 뒤에서 사용하고, 기존 Eventa·renderer LLM transport 계약은 유지한다.

**Tech Stack:** Electron `safeStorage`, TypeScript, Eventa, Vue/Pinia, `@earendil-works/pi-ai`, Vitest, pnpm.

## Global Constraints

- Codex CLI, `auth.json`, `codex app-server`, app-server JSON-RPC를 실행하거나 읽지 않는다.
- 액세스·갱신 토큰은 Electron main 프로세스와 Windows 사용자 범위 암호화 저장소 밖으로 전달하지 않는다.
- API 키와 CLI 토큰으로 자동 대체하지 않는다.
- 기존 `codex-oauth` 제공자 ID, Character 시스템 프롬프트, 스트리밍, 함수 도구, 취소를 보존한다.
- 모델과 Character 성격 자체의 제품 변경은 후속 작업으로 남긴다.
- 기존 미추적 `.pnpm-store/`, `.superpowers/`, `.turbo/`, `airi/packages/stage-ui/src/stores/ai/models/vad.test.ts`는 수정하거나 스테이징하지 않는다.

## File Map

- Create `airi/apps/stage-tamagotchi/src/main/services/codex/credential-store.ts` — `safeStorage`와 원자적 파일 교체를 결합한 자격 증명 저장소.
- Create `airi/apps/stage-tamagotchi/src/main/services/codex/credential-store.test.ts` — 평문 비노출과 직렬화된 갱신 검증.
- Create `airi/apps/stage-tamagotchi/src/main/services/codex/direct-client.ts` — pi-ai OAuth·모델·Responses 이벤트를 내부 계약으로 정규화.
- Create `airi/apps/stage-tamagotchi/src/main/services/codex/direct-client.test.ts` — Device Code, 갱신, 모델, 텍스트·도구 이벤트 검증.
- Rewrite `airi/apps/stage-tamagotchi/src/main/services/codex/manager.ts` — 프로세스 관리 대신 직접 인증 상태 머신 소유.
- Rewrite `airi/apps/stage-tamagotchi/src/main/services/codex/manager.test.ts` — 직접 인증 수명주기 검증.
- Rewrite `airi/apps/stage-tamagotchi/src/main/services/codex/turn-runtime.ts` — 직접 Responses 스트림과 도구 결과 루프 소유.
- Rewrite `airi/apps/stage-tamagotchi/src/main/services/codex/turn-runtime.test.ts` — 스트림·도구·취소 회귀 검증.
- Modify `airi/apps/stage-tamagotchi/src/main/services/codex/service.ts`와 테스트 — 직접 manager/runtime 연결.
- Modify `airi/apps/stage-tamagotchi/src/shared/eventa/codex.ts` — CLI·프로세스·app-server 전용 상태와 옵션 제거.
- Modify `airi/apps/stage-tamagotchi/src/main/index.ts` — userData 자격 증명 경로와 Electron `safeStorage` 주입.
- Modify `airi/packages/stage-ui/src/stores/codex-account.ts`와 테스트 — 직접 OAuth 상태와 모델 선택 반영.
- Modify `airi/packages/stage-pages/src/components/settings/CodexOAuthProviderSettings.vue` — CLI·app-server 문구와 전용 실행 옵션 제거.
- Modify `airi/apps/stage-tamagotchi/src/renderer/bridges/codex.ts`와 테스트 — app-server thread 저장을 제거하고 대화 입력을 직렬화.
- Delete `airi/apps/stage-tamagotchi/src/main/services/codex/cli.ts`, `cli.test.ts`, `json-rpc-client.ts`, `json-rpc-client.test.ts`, `types.ts` — 사용되지 않는 app-server 경계 제거.
- Modify `airi/apps/stage-tamagotchi/package.json`, `airi/pnpm-lock.yaml` — 직접 Codex 클라이언트 의존성 고정.
- Modify `README.md`, `WORKSPACE.md`, `ROADMAP.md`, `checklist.md`, `context-notes.md` — 실제 완료·검증 상태 동기화.

---

### Task 1: 암호화 자격 증명 저장소와 직접 클라이언트 의존성

**Files:**
- Modify: `airi/apps/stage-tamagotchi/package.json`
- Modify: `airi/pnpm-lock.yaml`
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/credential-store.ts`
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/credential-store.test.ts`

**Interfaces:**
- Produces: `createCodexCredentialStore(deps): CredentialStore`.
- Produces: 저장 키 `openai`, 자격 증명 타입 `OAuthCredentials`.

- [ ] **Step 1: pi-ai를 데스크톱 앱 의존성으로 추가한다.**

Run: `cd airi; pnpm --filter @proj-airi/stage-tamagotchi add @earendil-works/pi-ai@0.80.2`

Expected: `package.json`과 `pnpm-lock.yaml`만 의존성 변경으로 나타나며 설치가 성공한다.

- [ ] **Step 2: 실패 테스트로 암호화·삭제·동시 갱신 계약을 고정한다.**

```ts
it('stores only encrypted bytes and serializes modifications', async () => {
  const store = createCodexCredentialStore(harness.deps)
  await Promise.all([
    store.modify('openai', async () => credential('access-1')),
    store.modify('openai', async current => credential(`${current?.access}-2`)),
  ])
  expect(harness.rawFile()).not.toContain('access-1')
  expect(await store.read('openai')).toEqual(credential('access-1-2'))
  await store.delete('openai')
  expect(await store.read('openai')).toBeUndefined()
})
```

- [ ] **Step 3: 테스트가 구현 부재로 실패하는지 확인한다.**

Run: `cd airi; pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/credential-store.test.ts`

Expected: `createCodexCredentialStore`가 없어 FAIL.

- [ ] **Step 4: main 전용 CredentialStore를 최소 구현한다.**

```ts
export function createCodexCredentialStore(deps: CredentialStoreDeps): CredentialStore {
  const mutex = new Mutex()
  return {
    read: providerId => mutex.runExclusive(() => readCredential(deps, providerId)),
    modify: (providerId, update) => mutex.runExclusive(async () => {
      const next = await update(await readCredential(deps, providerId))
      await writeCredential(deps, providerId, next)
      return next
    }),
    delete: providerId => mutex.runExclusive(() => deleteCredential(deps, providerId)),
  }
}
```

저장 전 JSON 전체를 `safeStorage.encryptString`으로 암호화하고 같은 디렉터리의 임시 파일에 쓴 뒤 `rename`한다. `safeStorage.isEncryptionAvailable()`이 false면 평문 저장 없이 명확히 실패한다.

- [ ] **Step 5: 집중 테스트와 타입 검사를 실행한다.**

Run: `cd airi; pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/credential-store.test.ts`

Expected: PASS.

Run: `cd airi; pnpm -F @proj-airi/stage-tamagotchi typecheck`

Expected: PASS.

- [ ] **Step 6: 자격 증명 저장소를 커밋한다.**

```bash
git add airi/apps/stage-tamagotchi/package.json airi/pnpm-lock.yaml airi/apps/stage-tamagotchi/src/main/services/codex/credential-store.ts airi/apps/stage-tamagotchi/src/main/services/codex/credential-store.test.ts
git commit -m "feat: add encrypted Codex credential store"
```

### Task 2: 직접 Device OAuth 상태 머신

**Files:**
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/direct-client.ts`
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/direct-client.test.ts`
- Rewrite: `airi/apps/stage-tamagotchi/src/main/services/codex/manager.ts`
- Rewrite: `airi/apps/stage-tamagotchi/src/main/services/codex/manager.test.ts`
- Modify: `airi/apps/stage-tamagotchi/src/shared/eventa/codex.ts`

**Interfaces:**
- Consumes: Task 1의 `CredentialStore`.
- Produces: `CodexDirectClient.loginDevice`, `refresh`, `logout`, `listModels`, `stream`.
- Produces: `CodexRuntimeStatus.connection`과 `CodexDeviceLogin.expiresAt`.

- [ ] **Step 1: 직접 클라이언트 내부 계약과 실패 테스트를 작성한다.**

```ts
export interface CodexDirectClient {
  loginDevice: (handlers: DeviceLoginHandlers) => Promise<CodexAccount>
  readAccount: () => Promise<CodexAccount | undefined>
  logout: () => Promise<void>
  listModels: () => Promise<CodexModel[]>
  stream: (request: CodexDirectRequest, sink: CodexDirectSink, signal: AbortSignal) => Promise<void>
}
```

```ts
it('publishes only the device code and stores the returned credential', async () => {
  const login = await manager.startDeviceLogin()
  expect(login).toMatchObject({ verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-EFGH' })
  expect(JSON.stringify(manager.getStatus())).not.toContain('access-token')
  await harness.completeLogin()
  expect(manager.getStatus()).toMatchObject({ connection: 'connected', authMode: 'chatgpt' })
})
```

- [ ] **Step 2: 실패 테스트를 실행한다.**

Run: `cd airi; pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/direct-client.test.ts apps/stage-tamagotchi/src/main/services/codex/manager.test.ts`

Expected: 새 인터페이스와 상태 필드가 없어 FAIL.

- [ ] **Step 3: pi-ai의 OpenAI provider를 좁은 어댑터로 감싼다.**

```ts
const models = createModels({ credentials: deps.credentials })
models.setProvider(openaiProvider())

async function loginDevice(handlers: DeviceLoginHandlers): Promise<CodexAccount> {
  const provider = models.getProvider('openai')
  const oauth = provider?.auth.oauth
  if (oauth === undefined)
    throw new Error('Codex Device OAuth is unavailable.')
  const credential = await oauth.login({
    notify: event => notifyDeviceCode(event, handlers),
    prompt: prompt => selectDeviceFlow(prompt),
  })
  await deps.credentials.modify('openai', async () => credential)
  return accountFromCredential(credential)
}
```

외부 라이브러리 이벤트와 타입은 이 파일에서만 사용한다. Device Code 선택지가 없으면 브라우저 PKCE로 몰래 전환하지 않고 실패한다.

- [ ] **Step 4: manager를 인증 작업 하나만 허용하는 상태 머신으로 바꾼다.**

```ts
const initialStatus: CodexRuntimeStatus = {
  connection: 'disconnected',
  authMode: null,
  planType: null,
  login: 'idle',
}
```

`startDeviceLogin`은 코드가 준비되면 즉시 `CodexDeviceLogin`을 반환하고, 백그라운드 완료 promise가 상태를 `connected` 또는 `reauthenticationRequired`로 갱신한다. `cancelLogin`, `logout`, `stop`은 같은 `AbortController`와 직렬화 mutex를 사용한다.

- [ ] **Step 5: 인증 집중 테스트와 타입 검사를 실행한다.**

Run: `cd airi; pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/direct-client.test.ts apps/stage-tamagotchi/src/main/services/codex/manager.test.ts`

Expected: PASS.

Run: `cd airi; pnpm -F @proj-airi/stage-tamagotchi typecheck`

Expected: PASS.

- [ ] **Step 6: 직접 OAuth 상태 머신을 커밋한다.**

```bash
git add airi/apps/stage-tamagotchi/src/main/services/codex/direct-client.ts airi/apps/stage-tamagotchi/src/main/services/codex/direct-client.test.ts airi/apps/stage-tamagotchi/src/main/services/codex/manager.ts airi/apps/stage-tamagotchi/src/main/services/codex/manager.test.ts airi/apps/stage-tamagotchi/src/shared/eventa/codex.ts
git commit -m "feat: add direct Codex device OAuth"
```

### Task 3: 직접 Responses 스트리밍과 함수 도구 루프

**Files:**
- Rewrite: `airi/apps/stage-tamagotchi/src/main/services/codex/turn-runtime.ts`
- Rewrite: `airi/apps/stage-tamagotchi/src/main/services/codex/turn-runtime.test.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/services/codex/direct-client.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/services/codex/direct-client.test.ts`
- Modify: `airi/apps/stage-tamagotchi/src/shared/eventa/codex.ts`

**Interfaces:**
- Consumes: Task 2의 `CodexDirectClient.stream`.
- Produces: 기존 `text-delta`, `tool-call-request`, `finish`, `interrupted`, `error` 이벤트.
- Produces: `resolveToolCall(callId, result)` 대기 해제.

- [ ] **Step 1: 텍스트·도구·취소 실패 테스트를 작성한다.**

```ts
it('continues the same turn after a renderer tool result', async () => {
  const running = runtime.startTurn(request, event => events.push(event))
  harness.emit({ type: 'tool-call', callId: 'call-1', name: 'remember', arguments: { text: 'fact' } })
  runtime.resolveToolCall('call-1', { success: true, text: 'saved' })
  harness.emit({ type: 'text-delta', text: 'Done.' })
  harness.emit({ type: 'finish' })
  await running
  expect(events).toContainEqual(expect.objectContaining({ type: 'tool-call-request', tool: 'remember' }))
  expect(harness.requests[1].toolResults).toEqual([{ callId: 'call-1', output: 'saved', success: true }])
})
```

- [ ] **Step 2: 실패 테스트를 실행한다.**

Run: `cd airi; pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/turn-runtime.test.ts`

Expected: 기존 runtime가 app-server RPC를 요구해 FAIL.

- [ ] **Step 3: direct-client에서 pi-ai 이벤트를 내부 이벤트로 정규화한다.**

```ts
export type CodexDirectEvent
  = | { type: 'text-delta', text: string }
    | { type: 'tool-call', callId: string, name: string, arguments: CodexJsonValue }
    | { type: 'finish' }
```

pi-ai의 모델은 `openai` provider와 `openai-codex-responses` API인 항목만 허용한다. 전송 옵션은 Windows에서 검증하기 쉬운 `transport: 'sse'`, Character 프롬프트는 system/developer context, 함수 도구는 JSON Schema로 전달한다.

- [ ] **Step 4: runtime에 도구 결과 루프와 취소 정리를 구현한다.**

```ts
while (!finished) {
  await deps.client.stream(nextRequest, event => handleDirectEvent(active, event), active.abort.signal)
  const results = await Promise.all(active.pendingToolCalls.map(call => call.result))
  nextRequest = continuationRequest(nextRequest, results)
  finished = results.length === 0
}
```

활성 stream ID 하나에만 tool result를 연결하고, 중단·오류·종료 시 모든 pending resolver와 listener를 정리한다. 정상 abort는 `interrupted`로 끝내며 오류로 표시하지 않는다.

- [ ] **Step 5: runtime과 direct-client 집중 테스트를 실행한다.**

Run: `cd airi; pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/direct-client.test.ts apps/stage-tamagotchi/src/main/services/codex/turn-runtime.test.ts`

Expected: PASS.

Run: `cd airi; pnpm -F @proj-airi/stage-tamagotchi typecheck`

Expected: PASS.

- [ ] **Step 6: 직접 스트리밍을 커밋한다.**

```bash
git add airi/apps/stage-tamagotchi/src/main/services/codex/direct-client.ts airi/apps/stage-tamagotchi/src/main/services/codex/direct-client.test.ts airi/apps/stage-tamagotchi/src/main/services/codex/turn-runtime.ts airi/apps/stage-tamagotchi/src/main/services/codex/turn-runtime.test.ts airi/apps/stage-tamagotchi/src/shared/eventa/codex.ts
git commit -m "feat: stream Codex responses directly"
```

### Task 4: Eventa·renderer·설정 화면을 직접 경로로 전환

**Files:**
- Modify: `airi/apps/stage-tamagotchi/src/main/services/codex/service.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/services/codex/service.test.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/index.ts`
- Modify: `airi/apps/stage-tamagotchi/src/renderer/bridges/codex.ts`
- Modify: `airi/apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts`
- Modify: `airi/packages/stage-ui/src/stores/codex-account.ts`
- Modify: `airi/packages/stage-ui/src/stores/codex-account.test.ts`
- Modify: `airi/packages/stage-pages/src/components/settings/CodexOAuthProviderSettings.vue`
- Test: `airi/apps/stage-tamagotchi/src/renderer/codex-settings-route.test.ts`

**Interfaces:**
- Consumes: Task 2·3의 manager와 runtime.
- Produces: 기존 `codex-oauth` LLM transport와 직접 OAuth 설정 화면.

- [ ] **Step 1: CLI 상태 제거와 전체 대화 전달 실패 테스트를 작성한다.**

```ts
it('sends the full JSON-safe conversation without app-server thread state', async () => {
  await harness.transport(requestWithHistory())
  expect(harness.startTurn).toHaveBeenCalledWith(expect.objectContaining({
    messages: [
      expect.objectContaining({ role: 'system' }),
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ role: 'assistant' }),
      expect.objectContaining({ role: 'user' }),
    ],
  }))
  expect(localStorage.getItem('neru/codex/thread-ids')).toBeNull()
})
```

- [ ] **Step 2: 실패 테스트를 실행한다.**

Run: `cd airi; pnpm exec vitest run apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts packages/stage-ui/src/stores/codex-account.test.ts apps/stage-tamagotchi/src/renderer/codex-settings-route.test.ts`

Expected: 기존 thread 저장과 CLI 상태 때문에 FAIL.

- [ ] **Step 3: main 조립과 service를 직접 client로 바꾼다.**

```ts
const credentials = createCodexCredentialStore({
  filePath: join(app.getPath('userData'), 'neru-codex-oauth.bin'),
  safeStorage,
})
const client = createCodexDirectClient({ credentials })
const controller = createCodexController({ manager: createCodexManager({ client }), client })
```

`listModels`는 manager의 인증 상태를 확인한 뒤 `client.listModels()`를 호출한다. app-server RPC 조회는 제거한다.

- [ ] **Step 4: renderer 요청에서 thread ID 저장을 제거한다.**

```ts
await deps.startTurn({
  streamId,
  overrides: deps.getRuntimeOverrides(),
  developerInstructions: currentDeveloperInstructions(request.messages, deps.developerInstructions),
  dynamicTools: dynamicTools(request.tools),
  messages: jsonMessages(request.messages),
})
```

세션 대화는 AIRI가 제공하는 messages 배열을 사용한다. 모델·프롬프트 thread 서명과 localStorage의 `neru/codex/thread-ids`는 제거한다.

- [ ] **Step 5: 설정 UI에서 직접 OAuth에 맞지 않는 항목을 제거한다.**

`CodexAccountStatus`의 `cli`·`process`, overrides의 `cwd`·`sandbox`·`approvalPolicy`·`approvalsReviewer`, 고급 설정 필드를 제거한다. 문구는 “Neru가 Device OAuth로 직접 연결하며 토큰은 Windows 사용자 범위로 암호화됩니다.”로 바꾼다.

- [ ] **Step 6: 관련 테스트와 타입 검사를 실행한다.**

Run: `cd airi; pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/service.test.ts apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts packages/stage-ui/src/stores/codex-account.test.ts apps/stage-tamagotchi/src/renderer/codex-settings-route.test.ts`

Expected: PASS.

Run: `cd airi; pnpm -F @proj-airi/stage-ui typecheck`

Expected: PASS.

Run: `cd airi; pnpm -F @proj-airi/stage-tamagotchi typecheck`

Expected: PASS.

- [ ] **Step 7: UI·IPC 전환을 커밋한다.**

```bash
git add airi/apps/stage-tamagotchi/src/main/services/codex/service.ts airi/apps/stage-tamagotchi/src/main/services/codex/service.test.ts airi/apps/stage-tamagotchi/src/main/index.ts airi/apps/stage-tamagotchi/src/renderer/bridges/codex.ts airi/apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts airi/packages/stage-ui/src/stores/codex-account.ts airi/packages/stage-ui/src/stores/codex-account.test.ts airi/packages/stage-pages/src/components/settings/CodexOAuthProviderSettings.vue airi/apps/stage-tamagotchi/src/renderer/codex-settings-route.test.ts
git commit -m "feat: connect Neru to direct Codex OAuth"
```

### Task 5: app-server 코드 제거와 전체 검증

**Files:**
- Delete: `airi/apps/stage-tamagotchi/src/main/services/codex/cli.ts`
- Delete: `airi/apps/stage-tamagotchi/src/main/services/codex/cli.test.ts`
- Delete: `airi/apps/stage-tamagotchi/src/main/services/codex/json-rpc-client.ts`
- Delete: `airi/apps/stage-tamagotchi/src/main/services/codex/json-rpc-client.test.ts`
- Delete: `airi/apps/stage-tamagotchi/src/main/services/codex/types.ts`
- Modify: `README.md`
- Modify: `WORKSPACE.md`
- Modify: `ROADMAP.md`
- Modify: `checklist.md`
- Modify: `context-notes.md`

**Interfaces:**
- Consumes: Task 1~4의 완성된 직접 제공자.
- Produces: CLI·app-server 참조가 없는 실행 경로와 검증 기록.

- [ ] **Step 1: app-server 참조가 남아 실패하는 검색 검증을 만든다.**

Run: `cd airi; rg -n "startCodexAppServer|CodexJsonRpcClient|MIN_CODEX_VERSION|codex app-server" apps/stage-tamagotchi/src packages/stage-pages/src/components/settings/CodexOAuthProviderSettings.vue`

Expected before deletion: 기존 CLI·JSON-RPC 파일이 검색되어 FAIL 조건 충족.

- [ ] **Step 2: 사용되지 않는 app-server 파일과 import를 제거한다.**

삭제 뒤 같은 검색은 결과가 없어야 한다. 문서의 과거 기록은 보존하되 현재 상태 섹션은 직접 OAuth로 갱신한다.

- [ ] **Step 3: Codex 집중 테스트를 실행한다.**

Run: `cd airi; pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts apps/stage-tamagotchi/src/renderer/codex-settings-route.test.ts packages/stage-ui/src/stores/codex-account.test.ts packages/stage-ui/src/stores/llm-transports.test.ts packages/stage-ui/src/stores/llm.test.ts`

Expected: PASS.

- [ ] **Step 4: 타입 검사와 린트를 실행한다.**

Run: `cd airi; pnpm -F @proj-airi/stage-ui typecheck`

Expected: PASS.

Run: `cd airi; pnpm -F @proj-airi/stage-tamagotchi typecheck`

Expected: PASS.

Run: `cd airi; pnpm exec eslint apps/stage-tamagotchi/src/main/services/codex apps/stage-tamagotchi/src/renderer/bridges/codex.ts packages/stage-ui/src/stores/codex-account.ts packages/stage-pages/src/components/settings/CodexOAuthProviderSettings.vue`

Expected: 변경 파일 신규 오류 없음.

- [ ] **Step 5: 문서와 diff를 자체 검토한다.**

Run: `git diff --check`

Expected: 출력 없이 성공.

Run: `git diff --stat origin/master...HEAD`

Expected: 직접 OAuth 전환 파일과 문서만 표시.

Run: `git status --short`

Expected: 기존 미추적 파일 네 항목만 남음.

- [ ] **Step 6: 최종 구현을 커밋한다.**

```bash
git add README.md WORKSPACE.md ROADMAP.md checklist.md context-notes.md airi/apps/stage-tamagotchi/src/main/services/codex airi/apps/stage-tamagotchi/src/main/index.ts airi/apps/stage-tamagotchi/src/renderer/bridges/codex.ts airi/apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts airi/apps/stage-tamagotchi/src/renderer/codex-settings-route.test.ts airi/packages/stage-ui/src/stores/codex-account.ts airi/packages/stage-ui/src/stores/codex-account.test.ts airi/packages/stage-pages/src/components/settings/CodexOAuthProviderSettings.vue airi/apps/stage-tamagotchi/package.json airi/pnpm-lock.yaml
git commit -m "docs: complete direct Codex OAuth migration"
```

- [ ] **Step 7: 사용자 수동 검증 준비를 확인한다.**

앱을 master가 아닌 현재 기능 브랜치에서 실행하고, 사용자가 Device Code 로그인, 모델 조회, Character 대화, `remember` 도구, TTS, 중단, 재시작 후 연결 복원, 로그아웃을 순서대로 확인할 수 있게 한다.
