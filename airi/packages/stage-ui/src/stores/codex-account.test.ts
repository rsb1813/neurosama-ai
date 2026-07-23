// 직접 Codex OAuth 계정 상태와 실행 옵션 정규화를 검증합니다.
import type { CodexAccountBridge } from './codex-account'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCodexAccountStore } from './codex-account'

const consciousness = vi.hoisted(() => ({ activeProvider: '', activeModel: '' }))

vi.mock('./modules/consciousness', () => ({
  useConsciousnessStore: () => consciousness,
}))

describe('codex account store', () => {
  beforeEach(() => {
    consciousness.activeProvider = ''
    consciousness.activeModel = ''
    setActivePinia(createPinia())
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
  })

  it('activates Codex only after a direct OAuth connection succeeds', async () => {
    const store = useCodexAccountStore()
    store.setBridge({
      getStatus: async () => ({ connection: 'disconnected', authMode: null, planType: null, login: 'idle' }),
      listModels: async () => [],
      startDeviceLogin: async () => ({
        loginId: 'login-1',
        verificationUrl: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD',
        expiresAt: Date.now() + 900_000,
        type: 'chatgptDeviceCode',
      }),
      cancelDeviceLogin: vi.fn(async () => {}),
      logout: vi.fn(async () => {}),
      onStatus: () => () => {},
    })

    await store.startLogin()
    expect(consciousness.activeProvider).not.toBe('codex-oauth')

    store.applyStatus({ connection: 'connected', authMode: 'chatgpt', planType: 'plus', login: 'completed' })
    await store.selectCodex()
    expect(consciousness.activeProvider).toBe('codex-oauth')
    expect(consciousness.activeModel).toBe('codex-configured')
  })

  it('reports that device login is starting before the user code arrives', async () => {
    const store = useCodexAccountStore()
    let resolveLogin!: (login: {
      loginId: string
      verificationUrl: string
      userCode: string
      expiresAt: number
      type: 'chatgptDeviceCode'
    }) => void
    store.setBridge({
      getStatus: async () => ({ connection: 'disconnected', authMode: null, planType: null, login: 'idle' }),
      listModels: async () => [],
      startDeviceLogin: () => new Promise(resolve => resolveLogin = resolve),
      cancelDeviceLogin: vi.fn(async () => {}),
      logout: vi.fn(async () => {}),
      onStatus: () => () => {},
    })

    const pending = store.startLogin()
    expect(store.loginStarting).toBe(true)

    resolveLogin({
      loginId: 'login-1',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD',
      expiresAt: Date.now() + 900_000,
      type: 'chatgptDeviceCode',
    })
    await pending
    expect(store.loginStarting).toBe(false)
  })

  it('restores the pending device code when the renderer reconnects', async () => {
    const store = useCodexAccountStore()
    const startDeviceLogin = vi.fn(async () => ({
      loginId: 'login-1',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-EFGH',
      expiresAt: Date.now() + 900_000,
      type: 'chatgptDeviceCode' as const,
    }))
    store.setBridge({
      getStatus: async () => ({ connection: 'disconnected', authMode: null, planType: null, login: 'pending' }),
      listModels: async () => [],
      startDeviceLogin,
      cancelDeviceLogin: vi.fn(async () => {}),
      logout: vi.fn(async () => {}),
      onStatus: () => () => {},
    })

    await vi.waitFor(() => expect(store.login?.userCode).toBe('ABCD-EFGH'))
    expect(startDeviceLogin).toHaveBeenCalledOnce()
  })

  it('keeps only model, effort, and service tier runtime overrides', () => {
    localStorage.setItem('neru/codex/runtime-overrides', JSON.stringify({
      model: 'gpt-5.4',
      effort: 'high',
      serviceTier: 'fast',
      cwd: 'C:/legacy',
      sandbox: 'dangerFullAccess',
      approvalPolicy: 'never',
    }))

    const store = useCodexAccountStore()

    expect(store.overrides).toEqual({ model: 'gpt-5.4', effort: 'high', serviceTier: 'fast' })
  })

  it('refreshes models once per explicit request and preserves the displayed list on failure', async () => {
    const listModels = vi.fn()
      .mockResolvedValueOnce([{
        id: 'gpt-5.6-terra',
        name: 'GPT-5.6 Terra',
        supportedReasoningEfforts: [],
        serviceTiers: ['auto'],
      }])
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
