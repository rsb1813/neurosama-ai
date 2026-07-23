// pi-ai 기반 Codex Device OAuth와 계정 상태 정규화를 검증합니다.
import type { AssistantMessage, AssistantMessageEvent, AuthLoginCallbacks, Credential, CredentialStore, Model, OAuthCredential } from '@earendil-works/pi-ai'

import type { CodexDirectRequest, CodexPiAiRuntime } from './direct-client'

import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import { createCodexDirectClient } from './direct-client'

describe('createCodexDirectClient', () => {
  it('selects the device-code flow, publishes its public code, and stores the credential', async () => {
    const credentials = createMemoryCredentialStore()
    const notifyDeviceCode = vi.fn()
    const oauthCredential = credential(tokenWithPlan('plus'))
    const login = vi.fn(async (callbacks: AuthLoginCallbacks) => {
      expect(await callbacks.prompt({
        type: 'select',
        message: 'method',
        options: [
          { id: 'browser', label: 'Browser' },
          { id: 'device_code', label: 'Device' },
        ],
      })).toBe('device_code')
      callbacks.notify({
        type: 'device_code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://auth.openai.com/codex/device',
        intervalSeconds: 5,
        expiresInSeconds: 900,
      })
      return oauthCredential
    })
    const client = createCodexDirectClient({
      credentials,
      runtime: createRuntime(login),
    })

    const account = await client.loginDevice({ onDeviceCode: notifyDeviceCode })

    expect(notifyDeviceCode).toHaveBeenCalledWith(expect.objectContaining({
      userCode: 'ABCD-EFGH',
      verificationUrl: 'https://auth.openai.com/codex/device',
      expiresInSeconds: 900,
    }))
    expect(await credentials.read('openai-codex')).toEqual(oauthCredential)
    expect(account).toEqual({ authMode: 'chatgpt', planType: 'plus' })
  })

  it('reads, refreshes, and deletes only the openai-codex credential', async () => {
    const credentials = createMemoryCredentialStore()
    await credentials.modify('openai-codex', async () => credential(tokenWithPlan('pro')))
    const getAuth = vi.fn(async () => ({ auth: { apiKey: 'refreshed' }, source: 'OAuth' }))
    const client = createCodexDirectClient({ credentials, runtime: createRuntime(vi.fn(), getAuth) })

    expect(await client.readAccount()).toEqual({ authMode: 'chatgpt', planType: 'pro' })
    await client.refresh()
    expect(getAuth).toHaveBeenCalledOnce()

    await client.logout()
    expect(await client.readAccount()).toBeUndefined()
  })

  it('normalizes text and completed tool calls from the direct Responses stream', async () => {
    const final = assistantMessage()
    const stream = vi.fn(() => eventStream([
      { type: 'text_delta', contentIndex: 0, delta: 'Hello', partial: final },
      {
        type: 'toolcall_end',
        contentIndex: 1,
        toolCall: { type: 'toolCall', id: 'call-1', name: 'remember', arguments: { text: 'fact' } },
        partial: final,
      },
      { type: 'done', reason: 'toolUse', message: final },
    ]))
    const client = createCodexDirectClient({
      credentials: createMemoryCredentialStore(),
      runtime: createRuntime(vi.fn(), vi.fn(), stream),
    })
    const events: unknown[] = []

    await expect(client.stream({
      model: 'gpt-5.4',
      effort: 'high',
      serviceTier: 'fast',
      sessionId: 'stream-1',
      systemPrompt: 'Stay in character.',
      messages: [{ role: 'user', content: 'Hello', timestamp: 1 }],
      tools: [],
    }, event => events.push(event), new AbortController().signal)).resolves.toBe(final)

    expect(events).toEqual([
      { type: 'text-delta', text: 'Hello' },
      { type: 'tool-call', callId: 'call-1', name: 'remember', arguments: { text: 'fact' } },
    ])
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ id: 'gpt-5.4' }), expect.anything(), expect.objectContaining({
      transport: 'sse',
      reasoningEffort: 'high',
      serviceTier: 'priority',
    }))
  })

  it('refreshes remote models once and streams with the selected remote model', async () => {
    const credentials = createMemoryCredentialStore()
    await credentials.modify('openai-codex', async () => credential(tokenWithAccountAndPlan('account-1', 'pro')))
    const stream = vi.fn(() => eventStream([
      { type: 'done', reason: 'toolUse', message: assistantMessage() },
    ]))
    const fetchFn = vi.fn(async () => modelResponse('gpt-5.6-terra'))
    const client = createCodexDirectClient({
      credentials,
      runtime: createRuntime(vi.fn(), vi.fn(async () => ({})), stream),
      fetchFn,
    })

    const models = await client.listModels()

    expect(fetchFn).toHaveBeenCalledOnce()
    expect(models).toEqual([{
      id: 'gpt-5.6-terra',
      name: 'GPT-5.6 Terra',
      supportedReasoningEfforts: [{ value: 'high', label: 'high' }],
      serviceTiers: ['auto', 'fast'],
    }])

    await client.stream(request({ model: 'gpt-5.6-terra' }), vi.fn(), new AbortController().signal)
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'gpt-5.6-terra' }),
      expect.anything(),
      expect.anything(),
    )
  })

  it('keeps the last successful runtime catalog when refresh fails', async () => {
    const credentials = createMemoryCredentialStore()
    await credentials.modify('openai-codex', async () => credential(tokenWithAccountAndPlan('account-1', 'pro')))
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(modelResponse('gpt-5.6-terra'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
    const stream = vi.fn(() => eventStream([
      { type: 'done', reason: 'toolUse', message: assistantMessage() },
    ]))
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
})

function createRuntime(
  login: (callbacks: AuthLoginCallbacks) => Promise<OAuthCredential>,
  getAuth = vi.fn(),
  stream = vi.fn(),
): CodexPiAiRuntime {
  const model: Model<'openai-codex-responses'> = {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    api: 'openai-codex-responses' as const,
    provider: 'openai-codex',
    baseUrl: 'https://chatgpt.com/backend-api',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
  }
  return {
    provider: {
      id: 'openai-codex',
      auth: { oauth: { login } },
      getModels: () => [model],
    },
    models: { getAuth, stream },
  }
}

function createMemoryCredentialStore(): CredentialStore {
  const values = new Map<string, Credential>()
  return {
    async read(providerId) {
      return values.get(providerId)
    },
    async modify(providerId, update) {
      const current = values.get(providerId)
      const next = await update(current)
      if (next !== undefined)
        values.set(providerId, next)
      return next ?? current
    },
    async delete(providerId) {
      values.delete(providerId)
    },
  }
}

function credential(access: string): OAuthCredential {
  return { type: 'oauth', access, refresh: 'refresh-token', expires: Date.now() + 60_000 }
}

function tokenWithPlan(planType: string): string {
  const payload = Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_plan_type: planType },
  })).toString('base64url')
  return `header.${payload}.signature`
}

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

function assistantMessage(): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    model: 'gpt-5.4',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse',
    timestamp: 1,
  }
}

async function* eventStream(events: AssistantMessageEvent[]): AsyncIterable<AssistantMessageEvent> {
  for (const event of events)
    yield event
}
