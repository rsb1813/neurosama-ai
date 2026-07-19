// Codex OAuth 설정 UI가 Electron 브리지를 통해 계정 상태와 로그인을 관리한다.
import { errorMessageFrom } from '@moeru/std'
import { defineStore } from 'pinia'
import { reactive, ref, watch } from 'vue'

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
  listModels: () => Promise<CodexModel[]>
  startDeviceLogin: () => Promise<CodexDeviceLogin>
  cancelDeviceLogin: (loginId: string) => Promise<void>
  logout: () => Promise<void>
  onStatus: (handler: (status: CodexAccountStatus) => void) => () => void
}

export interface CodexModel {
  id: string
  name: string
  supportedReasoningEfforts: Array<{ value: string, label: string }>
  serviceTiers: string[]
}

export interface CodexRuntimeOverrides {
  model?: string
  effort?: string
  serviceTier?: string
  cwd?: string
  sandbox?: 'readOnly' | 'workspaceWrite' | 'dangerFullAccess'
  approvalPolicy?: 'unlessTrusted' | 'onRequest' | 'never'
  approvalsReviewer?: 'user' | 'auto_review'
}

const overridesStorageKey = 'neru/codex/runtime-overrides'

const unknownStatus: CodexAccountStatus = {
  cli: 'unknown',
  process: 'stopped',
  authMode: null,
  planType: null,
  login: 'idle',
}

export const useCodexAccountStore = defineStore('codex-account', () => {
  const status = ref<CodexAccountStatus>({ ...unknownStatus })
  const login = ref<CodexDeviceLogin | null>(null)
  const models = ref<CodexModel[]>([])
  const modelsLoading = ref(false)
  const modelsError = ref<string>()
  const overrides = reactive<CodexRuntimeOverrides>(readOverrides())
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
    void next.getStatus().then(applyStatus).catch(error => applyStatus({ ...unknownStatus, error: errorMessageFrom(error) ?? String(error) }))
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

  function applyModels(next: CodexModel[]) {
    models.value = next
    const model = next.find(item => item.id === overrides.model)
    if (overrides.model !== undefined && model === undefined) {
      overrides.model = undefined
      overrides.effort = undefined
      overrides.serviceTier = undefined
      return
    }
    if (model !== undefined) {
      if (overrides.effort !== undefined && !model.supportedReasoningEfforts.some(item => item.value === overrides.effort))
        overrides.effort = undefined
      if (overrides.serviceTier !== undefined && !model.serviceTiers.includes(overrides.serviceTier))
        overrides.serviceTier = undefined
    }
  }

  async function refreshModels() {
    if (!bridge)
      throw new Error('Codex 계정 브리지가 준비되지 않았습니다.')
    modelsLoading.value = true
    modelsError.value = undefined
    try {
      applyModels(await bridge.listModels())
    }
    catch (error) {
      modelsError.value = errorMessageFrom(error) ?? String(error)
    }
    finally {
      modelsLoading.value = false
    }
  }

  async function selectCodex() {
    if (status.value.authMode !== 'chatgpt')
      throw new Error('ChatGPT 계정 로그인이 완료된 뒤 Codex를 선택할 수 있습니다.')

    const consciousness = useConsciousnessStore()
    consciousness.activeProvider = 'codex-oauth'
    consciousness.activeModel = overrides.model ?? 'codex-configured'
  }

  watch(overrides, value => localStorage.setItem(overridesStorageKey, JSON.stringify(value)), { deep: true })

  return { status, login, models, modelsLoading, modelsError, overrides, applyStatus, applyModels, refreshModels, setBridge, startLogin, cancelLogin, logout, selectCodex }
})

function readOverrides(): CodexRuntimeOverrides {
  try {
    const value = JSON.parse(localStorage.getItem(overridesStorageKey) ?? '{}')
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  }
  catch {
    return {}
  }
}
