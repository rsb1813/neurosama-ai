// Codex OAuth 설정 UI가 Electron 브리지를 통해 계정 상태와 로그인을 관리한다.
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { useConsciousnessStore } from './modules/consciousness'

export interface CodexAccountStatus {
  cli: 'unknown' | 'supported' | 'unsupported'
  process: 'stopped' | 'running'
  authMode: string | null
  planType: string | null
  login: 'idle' | 'pending' | 'completed' | 'failed'
  error?: string
}

export interface CodexDeviceLogin {
  loginId: string
  verificationUrl: string
  userCode: string
  type: 'chatgptDeviceCode'
}

export interface CodexAccountBridge {
  getStatus: () => Promise<CodexAccountStatus>
  startDeviceLogin: () => Promise<CodexDeviceLogin>
  cancelDeviceLogin: (loginId: string) => Promise<void>
  logout: () => Promise<void>
  onStatus: (handler: (status: CodexAccountStatus) => void) => () => void
}

const unknownStatus: CodexAccountStatus = {
  cli: 'unknown', process: 'stopped', authMode: null, planType: null, login: 'idle',
}

export const useCodexAccountStore = defineStore('codex-account', () => {
  const status = ref<CodexAccountStatus>({ ...unknownStatus })
  const login = ref<CodexDeviceLogin | null>(null)
  let bridge: CodexAccountBridge | undefined
  let stopStatusSubscription: (() => void) | undefined

  function applyStatus(next: CodexAccountStatus) {
    status.value = next
    if (next.login !== 'pending')
      login.value = null
  }

  function setBridge(next: CodexAccountBridge | undefined) {
    stopStatusSubscription?.()
    bridge = next
    stopStatusSubscription = next?.onStatus(applyStatus)
    if (!next) {
      applyStatus({ ...unknownStatus })
      return
    }
    void next.getStatus().then(applyStatus).catch(error => applyStatus({ ...unknownStatus, error: error instanceof Error ? error.message : String(error) }))
  }

  async function startLogin() {
    if (!bridge)
      throw new Error('Codex 계정 브리지가 준비되지 않았습니다.')

    login.value = await bridge.startDeviceLogin()
  }

  async function cancelLogin() {
    if (bridge && login.value)
      await bridge.cancelDeviceLogin(login.value.loginId)
    login.value = null
  }

  async function logout() {
    if (!bridge)
      throw new Error('Codex 계정 브리지가 준비되지 않았습니다.')
    await bridge.logout()
    login.value = null
  }

  async function selectCodex() {
    if (status.value.authMode !== 'chatgpt')
      throw new Error('ChatGPT 계정 로그인이 완료된 뒤 Codex를 선택할 수 있습니다.')

    const consciousness = useConsciousnessStore()
    consciousness.activeProvider = 'codex-oauth'
    consciousness.activeModel = 'codex-configured'
  }

  return { status, login, applyStatus, setBridge, startLogin, cancelLogin, logout, selectCodex }
})
