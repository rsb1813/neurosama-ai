// 직접 Codex OAuth 로그인의 상태 전이와 취소 경계를 검증합니다.
import type { CodexAccount, CodexDirectClient, DeviceLoginHandlers } from './direct-client'

import { describe, expect, it, vi } from 'vitest'

import { createCodexManager } from './manager'

describe('createCodexManager', () => {
  it('returns the device code before login completes and never exposes tokens', async () => {
    const harness = createHarness()
    const openExternal = vi.fn(async () => {})
    const manager = createCodexManager({ client: harness.client, createLoginId: () => 'login-1', now: () => 1_000, openExternal })

    expect(await manager.ensureStarted()).toMatchObject({ connection: 'disconnected', login: 'idle' })
    const login = manager.startDeviceLogin()
    harness.publishDeviceCode()

    await expect(login).resolves.toEqual({
      type: 'chatgptDeviceCode',
      loginId: 'login-1',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-EFGH',
      expiresAt: 901_000,
    })
    expect(openExternal).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledWith('https://auth.openai.com/codex/device')
    expect(manager.getStatus()).toMatchObject({ connection: 'disconnected', login: 'pending' })
    expect(JSON.stringify(manager.getStatus())).not.toContain('access-token')

    harness.completeLogin({ authMode: 'chatgpt', planType: 'plus' })
    await Promise.resolve()
    expect(manager.getStatus()).toMatchObject({ connection: 'connected', authMode: 'chatgpt', planType: 'plus', login: 'completed' })
  })

  it('cancels only the matching login and logs out the stored account', async () => {
    const harness = createHarness({ authMode: 'chatgpt', planType: 'plus' })
    const manager = createCodexManager({ client: harness.client, createLoginId: () => 'login-1', openExternal: vi.fn(async () => {}) })
    await manager.ensureStarted()
    const login = manager.startDeviceLogin()
    harness.publishDeviceCode()
    await login

    await manager.cancelLogin('another-login')
    expect(harness.signal?.aborted).toBe(false)
    await manager.cancelLogin('login-1')
    expect(harness.signal?.aborted).toBe(true)
    expect(manager.getStatus().login).toBe('idle')

    await manager.logout()
    expect(harness.client.logout).toHaveBeenCalledOnce()
    expect(manager.getStatus()).toMatchObject({ connection: 'disconnected', authMode: null, planType: null })
  })
})

function createHarness(initialAccount?: CodexAccount) {
  let handlers: DeviceLoginHandlers | undefined
  let resolveLogin: ((account: CodexAccount) => void) | undefined
  const client: CodexDirectClient = {
    loginDevice: vi.fn((nextHandlers) => {
      handlers = nextHandlers
      return new Promise<CodexAccount>((resolve) => {
        resolveLogin = resolve
      })
    }),
    readAccount: vi.fn(async () => initialAccount),
    refresh: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    listModels: vi.fn(async () => []),
    stream: vi.fn(),
  }

  return {
    client,
    get signal() {
      return handlers?.signal
    },
    publishDeviceCode() {
      handlers?.onDeviceCode({
        userCode: 'ABCD-EFGH',
        verificationUrl: 'https://auth.openai.com/codex/device',
        intervalSeconds: 5,
        expiresInSeconds: 900,
      })
    },
    completeLogin(account: CodexAccount) {
      resolveLogin?.(account)
    },
  }
}
