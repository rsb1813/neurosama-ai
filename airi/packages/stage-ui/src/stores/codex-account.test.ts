// Codex 계정 브리지가 로그인 완료 뒤에만 제공자를 선택하는지 검증한다.
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCodexAccountStore } from './codex-account'

const consciousness = vi.hoisted(() => ({ activeProvider: '', activeModel: '' }))

vi.mock('./modules/consciousness', () => ({
  useConsciousnessStore: () => consciousness,
}))

describe('Codex account store', () => {
  beforeEach(() => {
    consciousness.activeProvider = ''
    consciousness.activeModel = ''
    setActivePinia(createPinia())
  })

  it('does not activate Codex before login completion', async () => {
    const store = useCodexAccountStore()
    const startDeviceLogin = vi.fn(async () => ({ loginId: 'login-1', verificationUrl: 'https://example.com', userCode: 'ABCD', type: 'chatgptDeviceCode' as const }))
    store.setBridge({
      getStatus: async () => ({ cli: 'supported', process: 'running', authMode: null, planType: null, login: 'idle' }),
      startDeviceLogin,
      cancelDeviceLogin: vi.fn(async () => {}),
      logout: vi.fn(async () => {}),
      onStatus: () => () => {},
    })

    await store.startLogin()
    expect(consciousness.activeProvider).not.toBe('codex-oauth')

    store.applyStatus({ cli: 'supported', process: 'running', authMode: 'chatgpt', planType: 'plus', login: 'completed' })
    await store.selectCodex()
    expect(consciousness.activeProvider).toBe('codex-oauth')
    expect(consciousness.activeModel).toBe('codex-configured')
  })
})
