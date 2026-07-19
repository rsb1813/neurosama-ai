# Neru Codex OAuth Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Neru가 새 설치에서 LLM을 자동 선택하지 않고, 설정에서 로컬 프록시 또는 공식 Codex Device OAuth 제공자를 선택해 대화·펑션 도구·파일·명령 도구를 사용할 수 있게 한다.

**Architecture:** 기존 OpenAI 호환 공급자와 xsAI 스트림 경로는 유지한다. `codex-oauth`만 별도 LLM transport로 라우팅하고, Electron 메인 프로세스의 단일 `codex app-server` JSON-RPC 매니저가 인증·thread·turn·도구·승인을 담당한다. 렌더러와 메인 사이에는 직렬화 가능한 Eventa 계약만 오간다.

**Tech Stack:** TypeScript, Vue 3, Pinia, Electron, `@moeru/eventa`, Vitest, Codex app-server JSON-RPC v2, pnpm 10.33.0.

## Global Constraints

- 첫 실행 제공자 선택 화면을 추가하지 않는다.
- 새 설치에서 LLM·STT·TTS의 active provider, active model, 자격 증명을 만들지 않는다.
- 기존 사용자의 LLM·STT·TTS active 값과 자격 증명은 덮어쓰지 않는다.
- 로컬 LLM·STT·TTS 제공자는 기본값이 아니라 설정에서 고르는 선택지로만 등록한다.
- 로컬 프록시와 Codex 어느 쪽도 기본값이나 자동 폴백으로 사용하지 않는다.
- Codex 바이너리를 번들하지 않고 PATH의 `codex`를 사용한다.
- 최소 지원 버전은 `codex-cli 0.144.4`이며 버전 확인 뒤 기능 초기화도 검증한다.
- Neru는 `~/.codex/auth.json`과 OAuth 토큰을 읽거나 기록하지 않는다.
- Codex thread는 `workspaceWrite`와 `unlessTrusted` 승인 정책으로 시작한다.
- 저장소 밖 파일, 추가 네트워크, 위험 명령은 사용자 승인이 필요하다.
- 새 TypeScript·Vue 소스 파일의 첫 줄에는 역할을 설명하는 한국어 한 줄 주석을 둔다.

## File Structure

- `airi/apps/stage-tamagotchi/src/main/services/codex/json-rpc-client.ts` — 줄 단위 JSON-RPC 상관관계와 서버 발 요청 처리.
- `airi/apps/stage-tamagotchi/src/main/services/codex/manager.ts` — CLI 탐색, app-server 수명주기, OAuth, thread·turn, 승인·동적 도구 조정.
- `airi/apps/stage-tamagotchi/src/main/services/codex/service.ts` — Eventa context 한 개를 Codex 매니저에 연결.
- `airi/apps/stage-tamagotchi/src/shared/eventa/codex.ts` — 메인·렌더러 공용 직렬화 타입과 Eventa 계약.
- `airi/packages/stage-ui/src/stores/llm-transports.ts` — provider ID별 사용자 정의 LLM 스트림 transport 등록소.
- `airi/packages/stage-ui/src/stores/codex-account.ts` — 설정 UI가 쓰는 Codex 계정 브리지와 상태.
- `airi/packages/stage-ui/src/libs/providers/providers/neru-local-proxy/index.ts` — 기본 주소 없는 로컬 OpenAI 호환 제공자.
- `airi/packages/stage-ui/src/libs/providers/providers/codex-oauth/index.ts` — 자격 증명 없는 Codex 제공자와 설정 모델 sentinel.
- `airi/apps/stage-tamagotchi/src/renderer/bridges/codex.ts` — Eventa 스트림을 AIRI `StreamEvent`와 도구 실행으로 변환.
- `airi/apps/stage-tamagotchi/src/renderer/stores/codex-approvals.ts` — 진행 중인 승인 요청과 사용자 결정.
- `airi/apps/stage-tamagotchi/src/renderer/components/CodexApprovalDialog.vue` — 명령·파일·권한 승인 UI.
- `airi/packages/stage-pages/src/components/settings/CodexOAuthProviderSettings.vue` — 설치·로그인·플랜·오류 상태 UI.

---

### Task 1: provider 기본 프리시드를 제거하고 선택지만 등록

**Files:**
- Modify: `airi/apps/stage-tamagotchi/src/renderer/neruPreseed.ts`
- Modify: `airi/apps/stage-tamagotchi/src/renderer/neruPreseed.test.ts`

**Interfaces:**
- Consumes: 기존 localStorage 키 `settings/credentials/providers`, `settings/providers/added`, `settings/consciousness/*`, `settings/hearing/*`, `settings/speech/*`.
- Produces: 로컬 LLM·Codex·로컬 STT·로컬 TTS가 보이되 active 값과 credential은 생성하지 않는 선택지 등록.

- [x] **Step 1: 실패 테스트를 추가**

```ts
it('does not choose or configure providers on a fresh install', () => {
  preseedNeruProviders()
  expect(localStorage.getItem('settings/consciousness/active-provider')).toBeNull()
  expect(localStorage.getItem('settings/consciousness/active-model')).toBeNull()
  expect(localStorage.getItem('settings/hearing/active-provider')).toBeNull()
  expect(localStorage.getItem('settings/hearing/active-model')).toBeNull()
  expect(localStorage.getItem('settings/speech/active-provider')).toBeNull()
  expect(localStorage.getItem('settings/speech/active-model')).toBeNull()
  expect(localStorage.getItem('settings/credentials/providers')).toBeNull()
})

it('lists provider choices and preserves existing settings', () => {
  localStorage.setItem('settings/consciousness/active-provider', 'openai-compatible')
  localStorage.setItem('settings/consciousness/active-model', 'existing-model')
  localStorage.setItem('settings/hearing/active-provider', 'existing-stt')
  localStorage.setItem('settings/speech/active-provider', 'existing-tts')
  const credentials = { existing: { apiKey: 'kept' } }
  localStorage.setItem('settings/credentials/providers', JSON.stringify(credentials))
  preseedNeruProviders()
  const added = JSON.parse(localStorage.getItem('settings/providers/added')!)
  expect(added).toMatchObject({
    'neru-local-proxy': true,
    'codex-oauth': true,
    'openai-compatible-audio-transcription': true,
    'openai-compatible-audio-speech': true,
  })
  expect(localStorage.getItem('settings/consciousness/active-provider')).toBe('openai-compatible')
  expect(localStorage.getItem('settings/consciousness/active-model')).toBe('existing-model')
  expect(localStorage.getItem('settings/hearing/active-provider')).toBe('existing-stt')
  expect(localStorage.getItem('settings/speech/active-provider')).toBe('existing-tts')
  expect(JSON.parse(localStorage.getItem('settings/credentials/providers')!)).toEqual(credentials)
})
```

- [x] **Step 2: 실패 확인**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/renderer/neruPreseed.test.ts`

Expected: 기존 LLM·STT·TTS 강제 프리시드 때문에 FAIL한다.

- [x] **Step 3: 최소 프리시드 수정**

```ts
export function preseedNeruProviders(): void {
  const STT = 'openai-compatible-audio-transcription'
  const TTS = 'openai-compatible-audio-speech'

  mergeObject('settings/providers/added', {
    'neru-local-proxy': true,
    'codex-oauth': true,
    [STT]: true,
    [TTS]: true,
  })
  assertRaw('onboarding/completed', 'true')
  // 이 블록 아래의 expression, stage model, Neru card 시드 코드는 수정하지 않는다.
}
```

- [x] **Step 4: 테스트 통과 확인**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/renderer/neruPreseed.test.ts`

Expected: PASS.

- [x] **Step 5: 커밋**

```bash
git add airi/apps/stage-tamagotchi/src/renderer/neruPreseed.ts airi/apps/stage-tamagotchi/src/renderer/neruPreseed.test.ts
git commit -m "feat(neru): make LLM providers opt-in"
```

---

### Task 2: app-server JSON-RPC 클라이언트와 CLI 호환성 검사

**Files:**
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/types.ts`
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/json-rpc-client.ts`
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/json-rpc-client.test.ts`
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/cli.ts`
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/cli.test.ts`

**Interfaces:**
- Consumes: `ChildProcessWithoutNullStreams`, 줄 단위 JSON 문자열.
- Produces: `CodexJsonRpcClient.request<T>()`, `respond()`, `onNotification()`, `onServerRequest()`, `inspectCodexCli()`.

- [ ] **Step 1: JSON-RPC와 버전 실패 테스트 작성**

```ts
it('matches responses and exposes notifications and server requests', async () => {
  const io = createFakeLineIo()
  const client = createCodexJsonRpcClient(io)
  const pending = client.request('account/read', { refreshToken: false })
  io.push({ id: 1, result: { account: null } })
  await expect(pending).resolves.toEqual({ account: null })
})

it('rejects all pending calls when the process exits', async () => {
  const io = createFakeLineIo()
  const client = createCodexJsonRpcClient(io)
  const pending = client.request('thread/start', {})
  io.exit(1)
  await expect(pending).rejects.toThrow('Codex app-server exited')
})

it.each([
  ['codex-cli 0.144.4', true],
  ['codex-cli 0.144.3', false],
  ['unexpected', false],
])('checks the supported Codex version', async (stdout, supported) => {
  await expect(inspectCodexCli(fakeExec(stdout))).resolves.toMatchObject({ supported })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/json-rpc-client.test.ts apps/stage-tamagotchi/src/main/services/codex/cli.test.ts`

Expected: 모듈이 없어 FAIL한다.

- [ ] **Step 3: 공용 타입과 최소 클라이언트 구현**

```ts
// Codex app-server JSON-RPC 메시지와 런타임 상태를 정의한다.
export interface JsonRpcResponse { id: number, result?: unknown, error?: { code: number, message: string } }
export interface JsonRpcNotification { method: string, params?: unknown }
export interface JsonRpcServerRequest extends JsonRpcNotification { id: number }
export const MIN_CODEX_VERSION = '0.144.4'
```

```ts
// Codex app-server의 줄 단위 JSON-RPC 요청과 응답을 상관관계로 연결한다.
export function createCodexJsonRpcClient(io: CodexLineIo) {
  let nextId = 1
  const pending = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()
  const notifications = new Set<(message: JsonRpcNotification) => void>()
  const serverRequests = new Set<(message: JsonRpcServerRequest) => void>()

  io.onLine((line) => {
    const message = JSON.parse(line)
    if (typeof message.id === 'number' && ('result' in message || 'error' in message)) {
      const waiter = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) waiter?.reject(new Error(message.error.message))
      else waiter?.resolve(message.result)
    }
    else if (typeof message.id === 'number') serverRequests.forEach(handler => handler(message))
    else notifications.forEach(handler => handler(message))
  })

  return {
    request<T>(method: string, params: unknown): Promise<T> {
      const id = nextId++
      io.write({ id, method, params })
      return new Promise<T>((resolve, reject) => pending.set(id, { resolve: value => resolve(value as T), reject }))
    },
    respond(id: number, result: unknown) { io.write({ id, result }) },
    onNotification(handler: (message: JsonRpcNotification) => void) { notifications.add(handler); return () => notifications.delete(handler) },
    onServerRequest(handler: (message: JsonRpcServerRequest) => void) { serverRequests.add(handler); return () => serverRequests.delete(handler) },
  }
}
```

`cli.ts`는 `execFile('codex', ['--version'])` 결과를 semver로 비교하고 `spawn('codex', ['app-server'], { stdio: 'pipe', windowsHide: true })`만 노출한다. `shell: true`는 사용하지 않는다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/json-rpc-client.test.ts apps/stage-tamagotchi/src/main/services/codex/cli.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add airi/apps/stage-tamagotchi/src/main/services/codex
git commit -m "feat(codex): add app-server JSON-RPC client"
```

---

### Task 3: Codex 프로세스·계정·Device OAuth 매니저

**Files:**
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/manager.ts`
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/manager.test.ts`

**Interfaces:**
- Consumes: Task 2의 `createCodexJsonRpcClient`, `inspectCodexCli`, `spawnCodexAppServer`.
- Produces: `CodexManager.ensureStarted()`, `getStatus()`, `startDeviceLogin()`, `cancelLogin()`, `logout()`, `stop()`.

- [ ] **Step 1: 상태 전이 실패 테스트 작성**

```ts
it('initializes experimental API and reads the account', async () => {
  const harness = createManagerHarness()
  await harness.manager.ensureStarted()
  expect(harness.calls).toContainEqual(['initialize', expect.objectContaining({ capabilities: { experimentalApi: true } })])
  expect(harness.calls).toContainEqual(['account/read', { refreshToken: true }])
})

it('returns device URL and activates only after completion', async () => {
  const harness = createManagerHarness({ loginStart: { loginId: 'login-1', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234' } })
  const login = await harness.manager.startDeviceLogin()
  expect(login.userCode).toBe('ABCD-1234')
  harness.notify('account/login/completed', { loginId: 'login-1', success: true, error: null })
  harness.notify('account/updated', { authMode: 'chatgpt', planType: 'plus' })
  expect(harness.manager.getStatus()).toMatchObject({ authMode: 'chatgpt', planType: 'plus' })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/manager.test.ts`

Expected: `manager.ts` 부재로 FAIL한다.

- [ ] **Step 3: 최소 매니저 구현**

```ts
// Codex CLI 프로세스와 계정·대화 수명주기를 소유한다.
export interface CodexManager {
  ensureStarted: () => Promise<void>
  getStatus: () => CodexRuntimeStatus
  startDeviceLogin: () => Promise<CodexDeviceLogin>
  cancelLogin: (loginId: string) => Promise<void>
  logout: () => Promise<void>
  stop: () => Promise<void>
}

export function createCodexManager(deps: CodexManagerDeps): CodexManager {
  let status: CodexRuntimeStatus = { cli: 'unknown', process: 'stopped', authMode: null, planType: null }
  let process: ReturnType<CodexManagerDeps['spawn']> | undefined
  let rpc: CodexJsonRpcClient | undefined

  async function ensureStarted() {
    if (rpc) return
    const inspection = await deps.inspect()
    if (!inspection.installed || !inspection.supported) throw new Error(inspection.error ?? `Codex ${MIN_CODEX_VERSION}+ is required`)
    process = deps.spawn()
    rpc = createCodexJsonRpcClient(createChildProcessLineIo(process))
    await rpc.request('initialize', { clientInfo: { name: 'neru', version: deps.appVersion }, capabilities: { experimentalApi: true } })
    const probe = await rpc.request<{ thread: { id: string } }>('thread/start', {
      cwd: deps.workspaceRoot,
      ephemeral: true,
      sandbox: 'readOnly',
      approvalPolicy: 'never',
      dynamicTools: [{ type: 'function', name: 'neru_capability_probe', description: 'Neru capability probe', inputSchema: { type: 'object', properties: {} } }],
    })
    await rpc.request('thread/unsubscribe', { threadId: probe.thread.id })
    const account = await rpc.request<CodexAccountRead>('account/read', { refreshToken: true })
    status = accountToStatus(inspection, account)
  }

  async function startDeviceLogin() {
    await ensureStarted()
    return rpc!.request<CodexDeviceLogin>('account/login/start', { type: 'chatgptDeviceCode' })
  }
  async function cancelLogin(loginId: string) {
    await rpc?.request('account/login/cancel', { loginId })
  }
  async function logout() {
    await ensureStarted()
    await rpc!.request('account/logout', {})
    status = { ...status, authMode: null, planType: null }
  }
  async function stop() {
    rpc?.close(new Error('Codex app-server stopped'))
    process?.stdin.end()
    await deps.waitForExit(process, 2_000)
    if (process && process.exitCode == null) process.kill()
    rpc = undefined
    process = undefined
    status = { ...status, process: 'stopped' }
  }
  return { ensureStarted, getStatus: () => status, startDeviceLogin, cancelLogin, logout, stop }
}
```

`rpc.onNotification`은 `account/updated`의 `authMode`·`planType`과 `account/login/completed`의 성공·오류를 status에 반영하고 status subscriber에게 새 스냅샷을 보낸다. capability probe가 `experimentalApi` 또는 `dynamicTools` 오류를 반환하면 프로세스를 종료하고 `cli: 'unsupported'`와 업데이트 안내 오류를 저장한다.

stderr에는 토큰이나 JSON 응답을 기록하지 않고 마지막 오류 메시지만 보관한다. `account/login/completed`, `account/updated` 알림으로 상태를 갱신한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/manager.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add airi/apps/stage-tamagotchi/src/main/services/codex/manager.ts airi/apps/stage-tamagotchi/src/main/services/codex/manager.test.ts
git commit -m "feat(codex): manage device OAuth sessions"
```

---

### Task 4: Codex thread·turn·동적 도구·승인 런타임

**Files:**
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/turn-runtime.ts`
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/turn-runtime.test.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/services/codex/manager.ts`

**Interfaces:**
- Consumes: `CodexTurnRequest`, `CodexDynamicToolDescriptor[]`, 저장된 `threadId`, RPC 알림과 서버 발 요청.
- Produces: `startTurn(request, sink)`, `interrupt(streamId)`, `resolveToolCall()`, `resolveApproval()`.

- [ ] **Step 1: thread와 이벤트 매핑 실패 테스트 작성**

```ts
it('starts a workspace-scoped thread with tools and developer instructions', async () => {
  await runtime.startTurn(request({ threadId: undefined }), sink)
  expect(rpc.request).toHaveBeenCalledWith('thread/start', expect.objectContaining({
    cwd: 'C:/repo', sandbox: 'workspaceWrite', approvalPolicy: 'unlessTrusted',
    dynamicTools: [expect.objectContaining({ name: 'remember' })],
    config: { developer_instructions: 'You are Neru.' },
  }))
})

it('streams text and completes the turn', async () => {
  const running = runtime.startTurn(request({}), sink)
  rpc.notify('item/agentMessage/delta', { threadId: 'thr-1', turnId: 'turn-1', delta: 'Hello' })
  rpc.notify('turn/completed', { threadId: 'thr-1', turn: { id: 'turn-1', status: 'completed' } })
  await expect(running).resolves.toMatchObject({ threadId: 'thr-1' })
  expect(sink).toHaveBeenCalledWith({ type: 'text-delta', text: 'Hello' })
})

it('forwards dynamic tools and permission approvals without broadening scope', async () => {
  rpc.serverRequest('item/tool/call', 60, { callId: 'call-1', tool: 'remember', arguments: { text: 'x' } })
  expect(sink).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool-call-request', callId: 'call-1' }))
  rpc.serverRequest('item/permissions/requestApproval', 61, { permissions: { fileSystem: { write: ['C:/outside'] } } })
  expect(sink).toHaveBeenCalledWith(expect.objectContaining({ type: 'approval-request', requestId: '61' }))
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/turn-runtime.test.ts`

Expected: 모듈 부재로 FAIL한다.

- [ ] **Step 3: 최소 런타임 구현**

```ts
// Codex thread와 turn 이벤트를 Neru 스트림·도구·승인 이벤트로 변환한다.
export interface CodexTurnRuntime {
  startTurn: (request: CodexTurnRequest, sink: (event: CodexBridgeEvent) => void) => Promise<{ threadId: string }>
  interrupt: (streamId: string) => Promise<void>
  resolveToolCall: (callId: string, result: CodexToolResult) => void
  resolveApproval: (requestId: string, decision: CodexApprovalDecision) => void
}
```

새 thread는 `thread/start`, 저장된 ID는 `thread/resume`을 사용한다. 두 요청 모두 `cwd`, `sandbox: 'workspaceWrite'`, `approvalPolicy: 'unlessTrusted'`, `config.developer_instructions`, `dynamicTools`를 전달한다. 이후 `turn/start`에는 마지막 사용자 입력만 보내고 `item/agentMessage/delta`, `turn/completed`, `turn/interrupt`를 `streamId`별로 상관시킨다.

`model === 'codex-configured'`이면 thread 요청의 `model` 필드를 생략해 사용자 Codex 설정을 사용한다. 저장된 thread resume이 not found 또는 invalid thread 오류로 실패하면 `thread-resume-failed` bridge event를 내보내고 실패한다. 렌더러는 해당 session의 stale thread ID를 지우며, 사용자가 재시도를 누른 다음 요청에서만 새 thread를 만든다.

`item/tool/call` 응답은 다음 형태만 허용한다.

```ts
rpc.respond(requestId, {
  contentItems: [{ type: 'inputText', text: result.text }],
  success: result.success,
})
```

승인 응답은 원 요청에 포함된 권한의 부분집합만 허용하고, 세션 허용일 때만 `scope: 'session'`을 넣는다. 알 수 없는 승인 종류는 자동 거절한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/turn-runtime.test.ts apps/stage-tamagotchi/src/main/services/codex/manager.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add airi/apps/stage-tamagotchi/src/main/services/codex
git commit -m "feat(codex): stream turns with tools and approvals"
```

---

### Task 5: Eventa 계약과 Electron 창별 Codex 서비스

**Files:**
- Create: `airi/apps/stage-tamagotchi/src/shared/eventa/codex.ts`
- Modify: `airi/apps/stage-tamagotchi/src/shared/eventa/index.ts`
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/service.ts`
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/service.test.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/index.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/windows/main/rpc/index.electron.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/windows/settings/rpc/index.electron.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/windows/chat/rpc/index.electron.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/windows/spotlight/index.ts`

**Interfaces:**
- Consumes: Task 3·4의 단일 `CodexManager`.
- Produces: status/login/logout/turn/interrupt/tool-result/approval-decision invoke와 stream/status event.

- [ ] **Step 1: 계약 라우팅 실패 테스트 작성**

```ts
it('routes account, turn, tool and approval calls to one manager', async () => {
  const { handlers, emitted } = setupHarness()
  await handlers.getStatus()
  await handlers.startTurn(turnRequest)
  manager.emit({ type: 'text-delta', streamId: 's1', text: 'Hi' })
  expect(emitted).toContainEqual(expect.objectContaining({ streamId: 's1', type: 'text-delta' }))
  await handlers.resolveApproval({ requestId: '61', decision: 'deny' })
  expect(manager.resolveApproval).toHaveBeenCalledWith('61', 'deny')
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/service.test.ts`

Expected: 계약 모듈 부재로 FAIL한다.

- [ ] **Step 3: 직렬화 타입과 계약 구현**

```ts
// Codex app-server와 렌더러 사이의 직렬화 가능한 Eventa 계약을 정의한다.
export const codexGetStatus = defineInvokeEventa<CodexRuntimeStatus>('eventa:invoke:electron:codex:status')
export const codexStartDeviceLogin = defineInvokeEventa<CodexDeviceLogin>('eventa:invoke:electron:codex:login:start')
export const codexCancelDeviceLogin = defineInvokeEventa<void, { loginId: string }>('eventa:invoke:electron:codex:login:cancel')
export const codexLogout = defineInvokeEventa<void>('eventa:invoke:electron:codex:logout')
export const codexStartTurn = defineInvokeEventa<{ threadId: string }, CodexTurnRequest>('eventa:invoke:electron:codex:turn:start')
export const codexInterruptTurn = defineInvokeEventa<void, { streamId: string }>('eventa:invoke:electron:codex:turn:interrupt')
export const codexResolveToolCall = defineInvokeEventa<void, CodexToolCallResolution>('eventa:invoke:electron:codex:tool:resolve')
export const codexResolveApproval = defineInvokeEventa<void, CodexApprovalResolution>('eventa:invoke:electron:codex:approval:resolve')
export const codexBridgeEvent = defineEventa<CodexBridgeEvent>('eventa:event:electron:codex:bridge')
export const codexStatusChanged = defineEventa<CodexRuntimeStatus>('eventa:event:electron:codex:status')
```

`main/index.ts`에서 manager를 Injeca 단일 서비스로 만들고 main/settings/chat/spotlight 창 의존성에 전달한다. 각 창은 자신의 Eventa context에 동일한 `createCodexService({ context, manager })`를 등록한다. 앱 종료 hook은 manager를 정확히 한 번 `stop()`한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/service.test.ts`

Expected: PASS.

- [ ] **Step 5: 타입 검사**

Run: `cd airi && pnpm -F @proj-airi/stage-tamagotchi typecheck`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add airi/apps/stage-tamagotchi/src/shared/eventa airi/apps/stage-tamagotchi/src/main
git commit -m "feat(codex): expose app-server over Electron IPC"
```

---

### Task 6: 두 제공자 정의와 사용자 정의 LLM transport seam

**Files:**
- Create: `airi/packages/stage-ui/src/libs/providers/providers/neru-local-proxy/index.ts`
- Create: `airi/packages/stage-ui/src/libs/providers/providers/codex-oauth/index.ts`
- Modify: `airi/packages/stage-ui/src/libs/providers/providers/index.ts`
- Create: `airi/packages/stage-ui/src/stores/llm-transports.ts`
- Create: `airi/packages/stage-ui/src/stores/llm-transports.test.ts`
- Modify: `airi/packages/stage-ui/src/stores/llm.ts`
- Modify: `airi/packages/core-agent/src/types/llm.ts`
- Modify: `airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts`
- Modify: `airi/packages/stage-ui/src/stores/chat.ts`
- Modify: `airi/packages/i18n/src/locales/en/settings.yaml`
- Modify: `airi/packages/i18n/src/locales/ko/settings.yaml`

**Interfaces:**
- Consumes: 기존 `ChatProvider`, `StreamEvent`, `Tool`, active provider와 session ID.
- Produces: `registerLlmTransport(providerId, transport)`, `unregisterLlmTransport()`, `neru-local-proxy`, `codex-oauth`.

- [ ] **Step 1: transport 분기 실패 테스트 작성**

```ts
it('routes only the registered provider through its custom transport', async () => {
  const transport = vi.fn(async () => {})
  const unregister = registerLlmTransport('codex-oauth', transport)
  await streamWithRegisteredTransport({ providerId: 'codex-oauth', model: 'codex-configured', messages: [], tools: [] })
  expect(transport).toHaveBeenCalledOnce()
  unregister()
})

it('keeps ordinary OpenAI-compatible providers on coreStreamFrom', async () => {
  await store.stream('model', openAiCompatibleProvider, [], { providerId: 'neru-local-proxy' })
  expect(coreStreamFrom).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd airi && pnpm exec vitest run packages/stage-ui/src/stores/llm-transports.test.ts packages/stage-ui/src/stores/llm.test.ts`

Expected: transport 등록소가 없어 FAIL한다.

- [ ] **Step 3: transport와 제공자 구현**

```ts
// OpenAI 호환 경로 밖의 LLM 스트림 구현을 provider ID로 등록한다.
export interface LlmTransportRequest {
  providerId: string
  sessionId: string
  model: string
  messages: Message[]
  tools: Tool[]
  options: StreamOptions
}
export type LlmTransport = (request: LlmTransportRequest) => Promise<void>
const transports = new Map<string, LlmTransport>()
export function registerLlmTransport(providerId: string, transport: LlmTransport) {
  transports.set(providerId, transport)
  return () => transports.delete(providerId)
}
export function getLlmTransport(providerId: string) { return transports.get(providerId) }
```

`StreamOptions`에 `providerId?: string`과 `sessionId?: string`을 추가하고 `chat-orchestrator-runtime.ts`의 `deps.llm.stream` 호출에서 현재 provider와 session ID를 채운다. `useLLM.stream()`은 등록 transport가 있으면 builtin+custom 도구를 한 번 해석해 전달하고, 없으면 기존 `coreStreamFrom()`을 그대로 호출한다.

`neru-local-proxy`는 기본 URL·키·모델이 없는 `createOpenAI` 제공자다. `codex-oauth`는 `requiresCredentials: false`, 모델 목록 `[ { id: 'codex-configured', name: 'Codex configured model', provider: 'codex-oauth' } ]`를 제공하고 transport 미등록 상태에서 대화가 실행되면 명확한 오류를 던지는 sentinel `ChatProvider`를 반환한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd airi && pnpm exec vitest run packages/stage-ui/src/stores/llm-transports.test.ts packages/stage-ui/src/stores/llm.test.ts apps/stage-tamagotchi/src/renderer/neruPreseed.test.ts`

Expected: PASS.

- [ ] **Step 5: 타입 검사**

Run: `cd airi && pnpm -F @proj-airi/core-agent typecheck && pnpm -F @proj-airi/stage-ui typecheck`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add airi/packages/core-agent airi/packages/stage-ui airi/packages/i18n
git commit -m "feat(neru): add selectable proxy and Codex providers"
```

---

### Task 7: 렌더러 Codex 스트림·도구 브리지와 thread 보존

**Files:**
- Create: `airi/apps/stage-tamagotchi/src/renderer/bridges/codex.ts`
- Create: `airi/apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts`
- Modify: `airi/apps/stage-tamagotchi/src/renderer/App.vue`

**Interfaces:**
- Consumes: Task 5 Eventa 계약, Task 6 `registerLlmTransport`, AIRI `Tool[]`.
- Produces: `initializeCodexBridge(context)`, `dispose()`, `neru/codex/thread-ids` session→thread 저장.

- [ ] **Step 1: 스트림·tool-call 실패 테스트 작성**

```ts
it('maps app-server deltas and finish into AIRI stream events', async () => {
  const bridge = createHarness()
  const stream = bridge.transport(request({ sessionId: 'session-1' }))
  bridge.emit({ streamId: bridge.streamId, type: 'text-delta', text: 'Hi' })
  bridge.emit({ streamId: bridge.streamId, type: 'finish', threadId: 'thr-1' })
  await stream
  expect(onStreamEvent).toHaveBeenCalledWith({ type: 'text-delta', text: 'Hi' })
  expect(JSON.parse(localStorage.getItem('neru/codex/thread-ids')!)).toEqual({ 'session-1': 'thr-1' })
})

it('executes a named AIRI tool and returns a structured result', async () => {
  bridge.emit({ streamId, type: 'tool-call-request', callId: 'call-1', tool: 'remember', arguments: { text: 'x' } })
  await flushPromises()
  expect(remember.execute).toHaveBeenCalledWith({ text: 'x' }, expect.anything())
  expect(resolveToolCall).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-1', success: true }))
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts`

Expected: 브리지 부재로 FAIL한다.

- [ ] **Step 3: transport 구현**

```ts
// Electron Codex 이벤트를 AIRI 스트림과 로컬 펑션 도구 실행으로 연결한다.
export function initializeCodexBridge(deps: CodexBridgeDeps) {
  const threads = useLocalStorage<Record<string, string>>('neru/codex/thread-ids', {})
  const unregister = registerLlmTransport('codex-oauth', async (request) => {
    const streamId = crypto.randomUUID()
    const tools = new Map(request.tools.map(tool => [tool.function.name, tool]))
    const stop = deps.onEvent(async (event) => {
      if (event.streamId !== streamId) return
      if (event.type === 'text-delta') await request.options.onStreamEvent?.({ type: 'text-delta', text: event.text })
      if (event.type === 'tool-call-request') await executeAndResolveTool(event, tools, deps.resolveToolCall)
    })
    try {
      const result = await deps.startTurn(toCodexTurnRequest(streamId, request, threads.value[request.sessionId]))
      threads.value[request.sessionId] = result.threadId
      await request.options.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    }
    finally { stop() }
  })
  return () => unregister()
}
```

AbortSignal이 취소되면 `codexInterruptTurn({ streamId })`를 한 번 호출한다. tool 이름이 없거나 실행이 실패하면 `success: false`와 오류 문자열을 반환하며 전체 bridge를 종료하지 않는다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add airi/apps/stage-tamagotchi/src/renderer/bridges/codex.ts airi/apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts airi/apps/stage-tamagotchi/src/renderer/App.vue
git commit -m "feat(codex): bridge Neru chat and function tools"
```

---

### Task 8: Codex 설정 UI와 위험 작업 승인 대화상자

**Files:**
- Create: `airi/packages/stage-ui/src/stores/codex-account.ts`
- Create: `airi/packages/stage-ui/src/stores/codex-account.test.ts`
- Create: `airi/packages/stage-pages/src/components/settings/CodexOAuthProviderSettings.vue`
- Create: `airi/apps/stage-tamagotchi/src/renderer/stores/codex-approvals.ts`
- Create: `airi/apps/stage-tamagotchi/src/renderer/stores/codex-approvals.test.ts`
- Create: `airi/apps/stage-tamagotchi/src/renderer/components/CodexApprovalDialog.vue`
- Modify: `airi/packages/stage-pages/src/pages/v2/settings/providers/edit/[providerId]/index.vue`
- Modify: `airi/apps/stage-tamagotchi/src/renderer/App.vue`
- Modify: `airi/packages/i18n/src/locales/en/settings.yaml`
- Modify: `airi/packages/i18n/src/locales/ko/settings.yaml`

**Interfaces:**
- Consumes: account bridge, `CodexApprovalRequest`, Eventa resolve invoke.
- Produces: 설치·로그인·플랜·오류 UI, 승인 큐와 이번만·세션·거절 결정.

- [ ] **Step 1: 계정과 승인 상태 실패 테스트 작성**

```ts
it('does not activate Codex before login completion', async () => {
  const store = useCodexAccountStore()
  store.setBridge(fakeBridge({ authMode: null }))
  await store.startLogin()
  expect(consciousness.activeProvider).not.toBe('codex-oauth')
  store.applyStatus({ authMode: 'chatgpt', planType: 'plus', process: 'running', cli: 'supported' })
  await store.selectCodex()
  expect(consciousness.activeProvider).toBe('codex-oauth')
  expect(consciousness.activeModel).toBe('codex-configured')
})

it('resolves approval with an explicit bounded decision', async () => {
  approvals.enqueue(request({ requestId: '61' }))
  await approvals.resolveCurrent('allow-session')
  expect(resolveApproval).toHaveBeenCalledWith({ requestId: '61', decision: 'allow-session' })
  expect(approvals.current).toBeNull()
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd airi && pnpm exec vitest run packages/stage-ui/src/stores/codex-account.test.ts apps/stage-tamagotchi/src/renderer/stores/codex-approvals.test.ts`

Expected: 스토어 부재로 FAIL한다.

- [ ] **Step 3: UI 상태와 승인 큐 구현**

```ts
// Codex 계정 설정 UI가 Electron 브리지를 통해 상태와 로그인을 관리한다.
export interface CodexAccountBridge {
  getStatus: () => Promise<CodexRuntimeStatus>
  startDeviceLogin: () => Promise<CodexDeviceLogin>
  cancelDeviceLogin: (loginId: string) => Promise<void>
  logout: () => Promise<void>
  onStatus: (handler: (status: CodexRuntimeStatus) => void) => () => void
}
```

`CodexOAuthProviderSettings.vue`는 CLI 없음, 구버전, 로그아웃, 로그인 대기, 로그인 완료, 오류 상태를 별도 렌더링한다. 로그인 대기 화면에는 URL 열기, 코드 복사, 취소 버튼을 둔다. `authMode === 'chatgpt'`일 때만 `Codex 사용` 버튼을 활성화하며 이 버튼이 active provider와 `codex-configured` 모델을 저장한다.

provider 편집 페이지는 `providerDefinition.id === 'codex-oauth'`이면 일반 Zod 필드 대신 `CodexOAuthProviderSettings`를 렌더링한다. 로컬 프록시는 기존 Zod 편집·검증 UI를 그대로 사용한다.

`CodexApprovalDialog.vue`는 명령, cwd, 이유, 추가 권한을 표시하고 `이번만 허용`, `세션 동안 허용`, `거절`을 제공한다. 닫기와 앱 unmount는 거절로 처리한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd airi && pnpm exec vitest run packages/stage-ui/src/stores/codex-account.test.ts apps/stage-tamagotchi/src/renderer/stores/codex-approvals.test.ts`

Expected: PASS.

- [ ] **Step 5: 타입 검사**

Run: `cd airi && pnpm -F @proj-airi/stage-ui typecheck && pnpm -F @proj-airi/stage-pages typecheck && pnpm -F @proj-airi/stage-tamagotchi typecheck`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add airi/packages/stage-ui airi/packages/stage-pages airi/packages/i18n airi/apps/stage-tamagotchi/src/renderer
git commit -m "feat(codex): add OAuth settings and approval UI"
```

---

### Task 9: 통합 회귀 검증과 문서 동기화

**Files:**
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `WORKSPACE.md`
- Modify: `ROADMAP.md`
- Modify: `checklist.md`
- Modify: `context-notes.md`
- Test: Task 1~8의 모든 신규·수정 테스트.

**Interfaces:**
- Consumes: 완성된 두 제공자와 Codex bridge.
- Produces: 현재 동작을 정확히 설명하는 문서와 최종 검증 증거.

- [ ] **Step 1: 정적 회귀 스캔**

Run: `rg -n "settings/consciousness/active-provider.*openai-compatible|localhost:3456.*기본|LLM.*자동" airi/apps/stage-tamagotchi README*.md WORKSPACE.md ROADMAP.md`

Expected: 실행 코드에서 강제 LLM 기본값이 없고, 문서에는 로컬 프록시가 선택 옵션이라는 설명만 남는다.

- [ ] **Step 2: 관련 테스트 전체 실행**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts apps/stage-tamagotchi/src/renderer/stores/codex-approvals.test.ts apps/stage-tamagotchi/src/renderer/neruPreseed.test.ts packages/stage-ui/src/stores/codex-account.test.ts packages/stage-ui/src/stores/llm-transports.test.ts packages/stage-ui/src/stores/llm.test.ts`

Expected: PASS.

- [ ] **Step 3: 타입 검사와 Electron 빌드**

Run: `cd airi && pnpm -F @proj-airi/core-agent typecheck && pnpm -F @proj-airi/stage-ui typecheck && pnpm -F @proj-airi/stage-pages typecheck && pnpm -F @proj-airi/stage-tamagotchi typecheck && pnpm -F @proj-airi/stage-tamagotchi build`

Expected: 모든 명령 exit 0.

- [ ] **Step 4: 실제 수동 검증**

Run: `cd airi && pnpm desktop`

Expected:

1. 새 프로필에서 active LLM이 비어 있다.
2. 로컬 프록시 설정 후 선택하면 대화가 정상 동작한다.
3. Codex 설정에서 Device URL과 코드가 표시되고 로그인 완료 후에만 선택 가능하다.
4. Codex 대화가 스트리밍되고 영어 TTS·한국어 자막이 유지된다.
5. `remember` 호출이 `MEMORY.md`에 기록된다.
6. 저장소 안 명령은 workspace 범위에서 동작한다.
7. 저장소 밖 파일 또는 추가 권한은 승인 창을 띄우며 거절 시 실행되지 않는다.
8. 앱 재시작 뒤 계정과 Codex thread가 재개된다.

- [ ] **Step 5: 문서와 체크리스트 갱신**

README 3개 언어 중 현재 관리 대상인 영어·한국어에 LLM 선택 절차를 추가하고, `WORKSPACE.md`와 `ROADMAP.md`에서 외부 프록시가 유일한 LLM이라는 표현을 제거한다. `checklist.md`에는 검증 결과를 체크하고 `context-notes.md`에는 테스트 명령, Codex 버전, 수동 검증 결과를 기록한다.

- [ ] **Step 6: 최종 커밋**

```bash
git add README.md README.ko.md WORKSPACE.md ROADMAP.md checklist.md context-notes.md
git commit -m "docs: document selectable Neru LLM providers"
```

- [ ] **Step 7: 최종 상태 확인**

Run: `git status --short && git log --oneline -10`

Expected: 사용자 소유 `.pnpm-store/`와 `.superpowers/` 외에 계획 작업의 미커밋 변경이 없고 Task 1~9의 의미 단위 커밋이 보인다.
