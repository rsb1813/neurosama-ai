# Codex Remote Model Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모델 새로고침 버튼을 누를 때 현재 ChatGPT 계정의 Codex 모델 카탈로그를 한 번 조회하고, 반환된 모델을 실제 직접 Responses 요청에도 사용한다.

**Architecture:** Electron main의 새 `remote-models.ts`가 OAuth 토큰으로 공식 Codex 모델 엔드포인트를 호출하고 신뢰할 수 없는 응답을 정규화한다. `direct-client.ts`는 마지막 정상 런타임 카탈로그를 메모리에 유지하며 조회 성공 시에만 교체한다. renderer는 기존 IPC를 그대로 사용하되 화면 진입 시 자동 조회를 제거해 버튼 클릭만 네트워크 조회를 일으킨다.

**Tech Stack:** TypeScript, Electron main, `@earendil-works/pi-ai`, Eventa, Vue 3, Pinia, Vitest, pnpm.

## Global Constraints

- 원격 모델 요청 경로는 `https://chatgpt.com/backend-api/codex/models?client_version=0.144.0`이다.
- 새로고침 동작 한 번당 모델 엔드포인트 요청은 정확히 한 번만 보낸다.
- 백그라운드 폴링, 자동 재시도, 디스크 모델 캐시를 추가하지 않는다.
- OAuth 토큰, `chatgpt-account-id`, 원격 응답 원문은 Electron main 밖이나 로그로 내보내지 않는다.
- 원격 조회가 실패하거나 빈 목록을 반환하면 마지막 정상 런타임 목록을 교체하지 않는다.
- 원격 추론 강도 중 현재 전송기가 지원하는 `none`, `minimal`, `low`, `medium`, `high`, `xhigh`만 허용하며 `none`은 런타임의 `off`에 대응시킨다.
- Codex CLI와 app-server를 재도입하지 않고 현재 직접 OAuth 자격 증명 저장소를 사용한다.
- 모든 새 TypeScript 파일 첫 줄에는 역할을 설명하는 한국어 한 줄 주석을 둔다.

---

## File Map

- Create `airi/apps/stage-tamagotchi/src/main/services/codex/remote-models.ts` — 원격 요청, JWT 계정 ID 추출, 응답 검증 및 런타임 모델 변환을 소유한다.
- Create `airi/apps/stage-tamagotchi/src/main/services/codex/remote-models.test.ts` — 요청 횟수·헤더·응답 정규화·오류 거부를 검증한다.
- Modify `airi/apps/stage-tamagotchi/src/main/services/codex/direct-client.ts` — 마지막 정상 카탈로그 상태와 원격 조회를 직접 스트림 모델 선택에 연결한다.
- Modify `airi/apps/stage-tamagotchi/src/main/services/codex/direct-client.test.ts` — 원격 Terra 선택과 실패 후 마지막 정상 모델 보존을 검증한다.
- Modify `airi/packages/stage-pages/src/components/settings/CodexOAuthProviderSettings.vue` — 화면 진입 자동 조회를 제거하고 버튼만 새로고침을 호출하게 한다.
- Modify `airi/packages/stage-ui/src/stores/codex-account.test.ts` — 한 번의 명시적 새로고침이 bridge를 한 번 호출하고 실패 시 기존 표시 목록을 보존함을 검증한다.
- Modify `checklist.md`, `context-notes.md`, `WORKSPACE.md` — 구현 결과와 검증 근거를 기록한다.

### Task 1: 원격 모델 요청과 응답 정규화

**Files:**
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/remote-models.ts`
- Create: `airi/apps/stage-tamagotchi/src/main/services/codex/remote-models.test.ts`

**Interfaces:**
- Consumes: OAuth access token, `fetch` 호환 함수, 내장 `Model<'openai-codex-responses'>` 템플릿.
- Produces: `fetchRemoteCodexModels(params: FetchRemoteCodexModelsParams): Promise<RemoteCodexModel[]>`와 `toRuntimeModel(remote: RemoteCodexModel, template: Model<'openai-codex-responses'>): Model<'openai-codex-responses'>`.

- [ ] **Step 1: 정상 원격 응답을 재현하는 실패 테스트 작성**

```ts
// Codex 원격 모델 요청과 신뢰 경계 정규화를 검증합니다.
import type { Model } from '@earendil-works/pi-ai'

import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import { fetchRemoteCodexModels, toRuntimeModel } from './remote-models'

describe('Codex remote models', () => {
  it('fetches the account catalog once and normalizes listed models', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      models: [{
        slug: 'gpt-5.6-terra',
        display_name: 'GPT-5.6 Terra',
        visibility: 'list',
        context_window: 1_050_000,
        supported_reasoning_levels: [
          { effort: 'low', description: 'Low' },
          { effort: 'high', description: 'High' },
          { effort: 'max', description: 'Max' },
        ],
      }],
    }), { status: 200 }))

    const models = await fetchRemoteCodexModels({
      accessToken: tokenWithAccount('account-1'),
      fetchFn,
    })

    expect(fetchFn).toHaveBeenCalledOnce()
    expect(fetchFn).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/codex/models?client_version=0.144.0',
      expect.objectContaining({ method: 'GET' }),
    )
    const headers = new Headers(fetchFn.mock.calls[0][1]?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${tokenWithAccount('account-1')}`)
    expect(headers.get('chatgpt-account-id')).toBe('account-1')
    expect(models).toEqual([{
      id: 'gpt-5.6-terra',
      name: 'GPT-5.6 Terra',
      contextWindow: 1_050_000,
      reasoningEfforts: ['low', 'high'],
    }])

    const template: Model<'openai-codex-responses'> = {
      id: 'gpt-5.5',
      name: 'GPT-5.5',
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      baseUrl: 'https://chatgpt.com/backend-api',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 272_000,
      maxTokens: 128_000,
    }
    const remote = models[0]
    if (remote === undefined)
      throw new Error('Expected one remote model.')
    expect(toRuntimeModel(remote, template)).toMatchObject({
      id: 'gpt-5.6-terra',
      name: 'GPT-5.6 Terra',
      contextWindow: 1_050_000,
      baseUrl: 'https://chatgpt.com/backend-api',
    })
  })
})

function tokenWithAccount(accountId: string): string {
  const payload = Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: accountId },
  })).toString('base64url')
  return `header.${payload}.signature`
}
```

- [ ] **Step 2: 집중 테스트를 실행해 기대한 이유로 실패하는지 확인**

Run: `cd airi; pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/remote-models.test.ts`

Expected: FAIL with module `./remote-models` not found.

- [ ] **Step 3: 요청과 정규화의 최소 구현 작성**

```ts
// Codex 계정별 원격 모델 카탈로그를 안전한 런타임 모델로 정규화합니다.
import type { Model, ModelThinkingLevel, ThinkingLevelMap } from '@earendil-works/pi-ai'

import { Buffer } from 'node:buffer'

const CODEX_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models?client_version=0.144.0'
const PLAN_CLAIM = 'https://api.openai.com/auth'
const supportedEfforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])

export interface RemoteCodexModel {
  id: string
  name: string
  contextWindow?: number
  reasoningEfforts: string[]
}

export interface FetchRemoteCodexModelsParams {
  accessToken: string
  fetchFn?: typeof fetch
}

export async function fetchRemoteCodexModels(params: FetchRemoteCodexModelsParams): Promise<RemoteCodexModel[]> {
  const accountId = readAccountId(params.accessToken)
  if (accountId === undefined)
    throw new Error('Codex access token does not contain an account ID.')

  const response = await (params.fetchFn ?? fetch)(CODEX_MODELS_URL, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${params.accessToken}`,
      'chatgpt-account-id': accountId,
      originator: 'neru',
    },
  })
  if (!response.ok)
    throw new Error(`Codex model refresh failed with HTTP ${response.status}.`)

  const value: unknown = await response.json()
  const models = parseModels(value)
  if (models.length === 0)
    throw new Error('Codex model refresh returned no selectable models.')
  return models
}

export function toRuntimeModel(
  remote: RemoteCodexModel,
  template: Model<'openai-codex-responses'>,
): Model<'openai-codex-responses'> {
  return {
    ...template,
    id: remote.id,
    name: remote.name,
    contextWindow: remote.contextWindow ?? template.contextWindow,
    thinkingLevelMap: toThinkingLevelMap(remote.reasoningEfforts),
  }
}

function toThinkingLevelMap(efforts: string[]): ThinkingLevelMap {
  const levels: ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
  const enabled = new Set(efforts.map(value => value === 'none' ? 'off' : value))
  const result: ThinkingLevelMap = {}
  for (const level of levels)
    result[level] = enabled.has(level) ? level : null
  return result
}

function parseModels(value: unknown): RemoteCodexModel[] {
  if (!isRecord(value) || !Array.isArray(value.models))
    throw new Error('Codex model refresh returned an invalid response.')

  return value.models.flatMap((entry): RemoteCodexModel[] => {
    if (!isRecord(entry)
      || entry.visibility !== 'list'
      || typeof entry.slug !== 'string'
      || entry.slug.length === 0
      || typeof entry.display_name !== 'string'
      || entry.display_name.length === 0)
      return []

    const reasoningEfforts = Array.isArray(entry.supported_reasoning_levels)
      ? entry.supported_reasoning_levels.flatMap((level): string[] => {
          if (!isRecord(level) || typeof level.effort !== 'string' || !supportedEfforts.has(level.effort))
            return []
          return [level.effort]
        })
      : []
    const contextWindow = typeof entry.context_window === 'number' && entry.context_window > 0
      ? entry.context_window
      : undefined
    return [{
      id: entry.slug,
      name: entry.display_name,
      contextWindow,
      reasoningEfforts,
    }]
  })
}

function readAccountId(accessToken: string): string | undefined {
  try {
    const payload = accessToken.split('.')[1]
    if (payload === undefined)
      return undefined
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!isRecord(claims) || !isRecord(claims[PLAN_CLAIM]))
      return undefined
    const accountId = claims[PLAN_CLAIM].chatgpt_account_id
    return typeof accountId === 'string' && accountId.length > 0 ? accountId : undefined
  }
  catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
```

- [ ] **Step 4: 오류 응답과 신뢰 경계를 검증하는 실패 테스트 추가**

```ts
it('rejects missing account IDs, HTTP errors, malformed payloads, and empty lists', async () => {
  await expect(fetchRemoteCodexModels({ accessToken: 'invalid' })).rejects.toThrow('account ID')

  const unauthorized = vi.fn(async () => new Response('', { status: 401 }))
  await expect(fetchRemoteCodexModels({
    accessToken: tokenWithAccount('account-1'),
    fetchFn: unauthorized,
  })).rejects.toThrow('HTTP 401')

  const empty = vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 }))
  await expect(fetchRemoteCodexModels({
    accessToken: tokenWithAccount('account-1'),
    fetchFn: empty,
  })).rejects.toThrow('no selectable models')
})
```

- [ ] **Step 5: 전체 집중 테스트 통과 확인**

Run: `cd airi; pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/remote-models.test.ts`

Expected: PASS with all remote-model tests green and no token or response-body logging.

- [ ] **Step 6: 첫 의미 단위 커밋**

```powershell
git add -- airi/apps/stage-tamagotchi/src/main/services/codex/remote-models.ts airi/apps/stage-tamagotchi/src/main/services/codex/remote-models.test.ts
git commit -m "feat: Codex 원격 모델 카탈로그 조회"
```

### Task 2: 원격 카탈로그를 실제 직접 스트림에 연결

**Files:**
- Modify: `airi/apps/stage-tamagotchi/src/main/services/codex/direct-client.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/services/codex/direct-client.test.ts`

**Interfaces:**
- Consumes: Task 1의 `fetchRemoteCodexModels`와 `toRuntimeModel`.
- Produces: `CodexDirectClient.listModels()` 호출 성공 시 갱신되는 메모리 카탈로그와 그 카탈로그를 사용하는 `stream()`.

- [ ] **Step 1: Terra 조회와 실제 선택을 재현하는 실패 테스트 작성**

```ts
it('refreshes remote models once and streams with the selected remote model', async () => {
  const credentials = createMemoryCredentialStore()
  await credentials.modify('openai-codex', async () => credential(tokenWithAccountAndPlan('account-1', 'pro')))
  const stream = vi.fn(() => eventStream([{ type: 'done', reason: 'stop', message: assistantMessage() }]))
  const fetchFn = vi.fn(async () => modelResponse('gpt-5.6-terra'))
  const client = createCodexDirectClient({
    credentials,
    runtime: createRuntime(vi.fn(), vi.fn(async () => ({})), stream),
    fetchFn,
  })

  const models = await client.listModels()
  expect(fetchFn).toHaveBeenCalledOnce()
  expect(models.map(model => model.id)).toContain('gpt-5.6-terra')

  await client.stream(request({ model: 'gpt-5.6-terra' }), vi.fn(), new AbortController().signal)
  expect(stream).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'gpt-5.6-terra' }),
    expect.anything(),
    expect.anything(),
  )
})

function tokenWithAccountAndPlan(accountId: string, planType: string): string {
  const payload = Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': {
      chatgpt_account_id: accountId,
      chatgpt_plan_type: planType,
    },
  })).toString('base64url')
  return `header.${payload}.signature`
}

function modelResponse(id: string): Response {
  return new Response(JSON.stringify({
    models: [{
      slug: id,
      display_name: 'GPT-5.6 Terra',
      visibility: 'list',
      supported_reasoning_levels: [{ effort: 'high', description: 'High' }],
    }],
  }), { status: 200 })
}

function request(overrides: Partial<CodexDirectRequest> = {}): CodexDirectRequest {
  return {
    sessionId: 'stream-1',
    systemPrompt: 'Stay in character.',
    messages: [{ role: 'user', content: 'Hello', timestamp: 1 }],
    tools: [],
    ...overrides,
  }
}
```

`CodexDirectRequest`는 `./direct-client`에서 기존 `CodexPiAiRuntime`과 함께 type import한다.

- [ ] **Step 2: 테스트를 실행해 정적 목록 때문에 실패하는지 확인**

Run: `cd airi; pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/direct-client.test.ts`

Expected: FAIL because `fetchFn` is not accepted or Terra is absent.

- [ ] **Step 3: 마지막 정상 카탈로그 상태를 최소 구현**

`CodexDirectClientDeps`에 `fetchFn?: typeof fetch`를 추가하고 클라이언트 생성 시 다음 상태를 둔다.

```ts
const bundledModels = [...runtime.provider.getModels()]
let activeModels = bundledModels
let activeViews = toCodexModels(bundledModels)
```

내장 목록의 renderer 표현은 현재 동작을 그대로 보존하는 비공개 함수로 옮긴다.

```ts
function toCodexModels(models: readonly Model<'openai-codex-responses'>[]): CodexModel[] {
  return models.map(model => ({
    id: model.id,
    name: model.name,
    supportedReasoningEfforts: getSupportedThinkingLevels(model).map(value => ({ value, label: value })),
    serviceTiers: ['auto', 'fast'],
  }))
}
```

`listModels()`는 먼저 기존 `refresh()`로 자격 증명을 갱신하고 자격 증명 저장소에서 최신 OAuth access token을 다시 읽는다. 원격 요청이 성공한 뒤에만 두 상태를 함께 교체한다.

```ts
async listModels() {
  const refreshModel = activeModels[0]
  if (refreshModel === undefined)
    throw new Error('No Codex model is available for token refresh.')
  const auth = await runtime.models.getAuth(refreshModel)
  if (auth === undefined)
    throw new Error('Codex OAuth credentials are unavailable.')

  const credential = await deps.credentials.read(CODEX_PROVIDER_ID)
  if (credential?.type !== 'oauth')
    throw new Error('Codex OAuth credentials are unavailable.')

  const remote = await fetchRemoteCodexModels({ accessToken: credential.access, fetchFn: deps.fetchFn })
  const template = activeModels.find(model => model.id === 'gpt-5.5') ?? bundledModels[0]
  if (template === undefined)
    throw new Error('No Codex model template is available.')

  const nextModels = remote.map(model => toRuntimeModel(model, template))
  const nextViews = remote.map(model => ({
    id: model.id,
    name: model.name,
    supportedReasoningEfforts: model.reasoningEfforts.map(value => ({ value, label: value })),
    serviceTiers: ['auto', 'fast'],
  }))
  activeModels = nextModels
  activeViews = nextViews
  return activeViews
}
```

`refresh()`와 `stream()`의 `runtime.provider.getModels()` 참조를 `activeModels`로 바꾼다. `listModels()`의 catch에서 상태를 덮어쓰거나 원격 오류를 감싸지 않는다. 그러면 실패가 호출자에게 전달되면서 마지막 정상 상태는 그대로 남는다.

- [ ] **Step 4: 실패 뒤 마지막 정상 모델 보존 테스트 작성**

```ts
it('keeps the last successful runtime catalog when refresh fails', async () => {
  const credentials = createMemoryCredentialStore()
  await credentials.modify('openai-codex', async () => credential(tokenWithAccountAndPlan('account-1', 'pro')))
  const fetchFn = vi.fn()
    .mockResolvedValueOnce(modelResponse('gpt-5.6-terra'))
    .mockResolvedValueOnce(new Response('', { status: 503 }))
  const stream = vi.fn(() => eventStream([{ type: 'done', reason: 'stop', message: assistantMessage() }]))
  const client = createCodexDirectClient({
    credentials,
    runtime: createRuntime(vi.fn(), vi.fn(async () => ({})), stream),
    fetchFn,
  })

  await client.listModels()
  await expect(client.listModels()).rejects.toThrow('HTTP 503')
  await client.stream(request({ model: 'gpt-5.6-terra' }), vi.fn(), new AbortController().signal)

  expect(stream).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: 'gpt-5.6-terra' }),
    expect.anything(),
    expect.anything(),
  )
})
```

- [ ] **Step 5: 직접 클라이언트 테스트와 타입 검사 실행**

Run: `cd airi; pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/direct-client.test.ts apps/stage-tamagotchi/src/main/services/codex/remote-models.test.ts`

Expected: PASS.

Run: `cd airi; pnpm -F @proj-airi/stage-tamagotchi typecheck`

Expected: PASS. 기존 워크스페이스 설치 결함이 재현되면 변경 파일 대상 `vue-tsc` 또는 이전에 문서화된 동일 결함과 분리해 기록한다.

- [ ] **Step 6: 두 번째 의미 단위 커밋**

```powershell
git add -- airi/apps/stage-tamagotchi/src/main/services/codex/direct-client.ts airi/apps/stage-tamagotchi/src/main/services/codex/direct-client.test.ts
git commit -m "feat: 원격 Codex 모델을 직접 전송에 연결"
```

### Task 3: 버튼 전용 새로고침과 최종 회귀 검증

**Files:**
- Modify: `airi/packages/stage-pages/src/components/settings/CodexOAuthProviderSettings.vue`
- Modify: `airi/packages/stage-ui/src/stores/codex-account.test.ts`
- Modify: `checklist.md`
- Modify: `context-notes.md`
- Modify: `WORKSPACE.md`

**Interfaces:**
- Consumes: 기존 `CodexAccountBridge.listModels()`와 Task 2의 원격 조회 동작.
- Produces: 화면 진입 자동 요청 없이 버튼 클릭 한 번당 bridge 호출 한 번인 사용자 흐름.

- [ ] **Step 1: 명시적 새로고침 1회와 실패 시 표시 목록 보존 테스트 작성**

```ts
it('refreshes models once per explicit request and preserves the displayed list on failure', async () => {
  const listModels = vi.fn()
    .mockResolvedValueOnce([{ id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', supportedReasoningEfforts: [], serviceTiers: ['auto'] }])
    .mockRejectedValueOnce(new Error('network failed'))
  const store = useCodexAccountStore()
  store.setBridge(createBridge({ listModels }))

  await store.refreshModels()
  expect(listModels).toHaveBeenCalledTimes(1)
  expect(store.models[0]?.id).toBe('gpt-5.6-terra')

  await store.refreshModels()
  expect(listModels).toHaveBeenCalledTimes(2)
  expect(store.models[0]?.id).toBe('gpt-5.6-terra')
  expect(store.modelsError).toBe('network failed')
})

function createBridge(overrides: Partial<CodexAccountBridge> = {}): CodexAccountBridge {
  return {
    getStatus: async () => ({ connection: 'connected', authMode: 'chatgpt', planType: 'pro', login: 'completed' }),
    listModels: async () => [],
    startDeviceLogin: async () => ({
      loginId: 'login-1',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-EFGH',
      expiresAt: Date.now() + 900_000,
      type: 'chatgptDeviceCode',
    }),
    cancelDeviceLogin: async () => {},
    logout: async () => {},
    onStatus: () => () => {},
    ...overrides,
  }
}
```

`CodexAccountBridge`는 `./codex-account`에서 `useCodexAccountStore`와 함께 type import한다. 기존 테스트 의미는 바꾸지 않는다.

- [ ] **Step 2: store 테스트를 실행해 새 회귀 테스트의 현재 결과 확인**

Run: `cd airi; pnpm exec vitest run packages/stage-ui/src/stores/codex-account.test.ts`

Expected: 새 store 동작은 기존 구현에서도 통과할 수 있다. 통과할 경우 이는 상태 보존이 이미 구현돼 있음을 확인하는 특성화 테스트이며 제품 코드를 억지로 변경하지 않는다.

- [ ] **Step 3: 화면 진입 자동 조회 제거**

`CodexOAuthProviderSettings.vue`에서 `onMounted` import와 다음 호출만 제거한다.

```ts
onMounted(() => void account.refreshModels())
```

버튼의 `@click="account.refreshModels"`는 유지한다. 새 자동 호출, watcher, 타이머는 추가하지 않는다.

- [ ] **Step 4: 집중 테스트와 변경 파일 린트 실행**

Run: `cd airi; pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/remote-models.test.ts apps/stage-tamagotchi/src/main/services/codex/direct-client.test.ts packages/stage-ui/src/stores/codex-account.test.ts`

Expected: PASS.

Run: `cd airi; pnpm exec eslint apps/stage-tamagotchi/src/main/services/codex/remote-models.ts apps/stage-tamagotchi/src/main/services/codex/remote-models.test.ts apps/stage-tamagotchi/src/main/services/codex/direct-client.ts apps/stage-tamagotchi/src/main/services/codex/direct-client.test.ts packages/stage-ui/src/stores/codex-account.test.ts packages/stage-pages/src/components/settings/CodexOAuthProviderSettings.vue`

Expected: PASS with no warnings introduced by these files.

- [ ] **Step 5: 문서와 체크리스트에 검증 결과 기록**

`checklist.md`의 이번 작업 항목을 실제 결과에 맞게 체크한다. `context-notes.md`에는 원격 요청 횟수, 폴백 상태, 지원 추론 강도 제한과 검증 명령 결과를 기록한다. `WORKSPACE.md`의 Codex OAuth 현재 상태에 원격 버튼 조회와 수동 런타임 검증 잔여 여부를 한 문단으로 반영한다.

- [ ] **Step 6: 전체 diff 자체 검토**

Run: `rtk git diff --check`

Expected: no output.

Run: `rtk rg -n 'onMounted\(\(\) => void account\.refreshModels|setInterval|setTimeout' airi/packages/stage-pages/src/components/settings/CodexOAuthProviderSettings.vue airi/apps/stage-tamagotchi/src/main/services/codex`

Expected: 모델 자동 조회나 폴링에 해당하는 새 일치 항목이 없다. OAuth 자체의 기존 타이머가 검색되면 이번 모델 조회와 무관한 기존 코드임을 diff로 확인한다.

- [ ] **Step 7: 최종 의미 단위 커밋**

```powershell
git add -- airi/packages/stage-pages/src/components/settings/CodexOAuthProviderSettings.vue airi/packages/stage-ui/src/stores/codex-account.test.ts checklist.md context-notes.md WORKSPACE.md
git commit -m "fix: Codex 모델 조회를 수동 새로고침으로 제한"
```

- [ ] **Step 8: 수동 런타임 확인**

1. 변경된 Electron 앱을 재시작한다.
2. Codex OAuth 설정 화면 진입 직후 네트워크 모델 요청이 발생하지 않는지 로그로 확인한다.
3. `모델 새로고침`을 한 번 눌러 요청 한 번과 Terra 표시를 확인한다.
4. Terra를 선택해 짧은 요청을 보내고 실제 응답이 완료되는지 확인한다.
5. 수동 확인이 불가능하거나 서버가 계정별 오류를 반환하면 자동 검증 완료와 수동 검증 미완료를 구분해 기록한다.
