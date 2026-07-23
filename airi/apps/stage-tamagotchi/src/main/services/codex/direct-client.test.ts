// pi-ai 기반 Codex Device OAuth와 계정 상태 정규화를 검증합니다.
import type { AuthLoginCallbacks, Credential, CredentialStore, Model, OAuthCredential } from '@earendil-works/pi-ai'

import type { CodexPiAiRuntime } from './direct-client'

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
})

function createRuntime(
  login: (callbacks: AuthLoginCallbacks) => Promise<OAuthCredential>,
  getAuth = vi.fn(),
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
    models: { getAuth },
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
