// Codex 원격 모델 요청과 신뢰 경계 정규화를 검증합니다.
import type { Model } from '@earendil-works/pi-ai'

import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import { fetchRemoteCodexModels, toRuntimeModel } from './remote-models'

describe('codex remote models', () => {
  it('fetches the account catalog once and normalizes listed models', async () => {
    const accessToken = tokenWithAccount('account-1')
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
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

    const models = await fetchRemoteCodexModels({ accessToken, fetchFn })

    expect(fetchFn).toHaveBeenCalledOnce()
    expect(fetchFn).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/codex/models?client_version=0.144.0',
      expect.objectContaining({ method: 'GET' }),
    )
    const headers = new Headers(fetchFn.mock.calls[0]?.[1]?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${accessToken}`)
    expect(headers.get('chatgpt-account-id')).toBe('account-1')
    expect(models).toEqual([{
      id: 'gpt-5.6-terra',
      name: 'GPT-5.6 Terra',
      contextWindow: 1_050_000,
      reasoningEfforts: ['low', 'high'],
    }])

    const template = modelTemplate()
    const remote = models[0]
    if (remote === undefined)
      throw new Error('Expected one remote model.')
    expect(toRuntimeModel(remote, template)).toMatchObject({
      id: 'gpt-5.6-terra',
      name: 'GPT-5.6 Terra',
      contextWindow: 1_050_000,
      baseUrl: 'https://chatgpt.com/backend-api',
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: 'low',
        medium: null,
        high: 'high',
        xhigh: null,
      },
    })
  })

  it('rejects missing account IDs, HTTP errors, malformed payloads, and empty lists', async () => {
    await expect(fetchRemoteCodexModels({ accessToken: 'invalid' })).rejects.toThrow('account ID')

    const unauthorized = vi.fn(async () => new Response('', { status: 401 }))
    await expect(fetchRemoteCodexModels({
      accessToken: tokenWithAccount('account-1'),
      fetchFn: unauthorized,
    })).rejects.toThrow('HTTP 401')

    const malformed = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    await expect(fetchRemoteCodexModels({
      accessToken: tokenWithAccount('account-1'),
      fetchFn: malformed,
    })).rejects.toThrow('invalid response')

    const empty = vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 }))
    await expect(fetchRemoteCodexModels({
      accessToken: tokenWithAccount('account-1'),
      fetchFn: empty,
    })).rejects.toThrow('no selectable models')
  })
})

function tokenWithAccount(accountId: string): string {
  const payload = Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: accountId },
  })).toString('base64url')
  return `header.${payload}.signature`
}

function modelTemplate(): Model<'openai-codex-responses'> {
  return {
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
}
