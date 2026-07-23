// 직접 Codex OAuth 계정과 Device 로그인 수명주기를 관리합니다.
import type { CodexDeviceLogin, CodexRuntimeStatus } from '../../../shared/eventa/codex'
import type { CodexDirectClient, DeviceCodeInfo } from './direct-client'

import { randomUUID } from 'node:crypto'

export type { CodexDeviceLogin, CodexRuntimeStatus } from '../../../shared/eventa/codex'

export interface CodexManagerDeps {
  client: CodexDirectClient
  createLoginId?: () => string
  now?: () => number
}

export interface CodexManager {
  ensureStarted: () => Promise<CodexRuntimeStatus>
  getStatus: () => CodexRuntimeStatus
  onStatusChange: (handler: (status: CodexRuntimeStatus) => void) => () => void
  startDeviceLogin: () => Promise<CodexDeviceLogin>
  cancelLogin: (loginId: string) => Promise<void>
  logout: () => Promise<void>
  stop: () => Promise<void>
}

interface ActiveLogin {
  id: string
  abort: AbortController
  codePublished: boolean
  resolveCode: (login: CodexDeviceLogin) => void
  rejectCode: (error: Error) => void
}

/** 직접 OAuth 클라이언트 한 개에 대한 직렬 로그인 상태 머신을 만듭니다. */
export function createCodexManager(deps: CodexManagerDeps): CodexManager {
  const createLoginId = deps.createLoginId ?? randomUUID
  const now = deps.now ?? Date.now
  const handlers = new Set<(status: CodexRuntimeStatus) => void>()
  let status: CodexRuntimeStatus = {
    connection: 'disconnected',
    authMode: null,
    planType: null,
    login: 'idle',
  }
  let starting: Promise<CodexRuntimeStatus> | undefined
  let activeLogin: ActiveLogin | undefined

  function getStatus(): CodexRuntimeStatus {
    return { ...status }
  }

  function updateStatus(next: CodexRuntimeStatus): void {
    status = next
    const snapshot = getStatus()
    for (const handler of handlers)
      handler(snapshot)
  }

  function onStatusChange(handler: (nextStatus: CodexRuntimeStatus) => void): () => void {
    handlers.add(handler)
    return () => handlers.delete(handler)
  }

  async function ensureStarted(): Promise<CodexRuntimeStatus> {
    if (starting !== undefined)
      return starting
    starting = loadAccount().finally(() => {
      starting = undefined
    })
    return starting
  }

  async function loadAccount(): Promise<CodexRuntimeStatus> {
    try {
      const account = await deps.client.readAccount()
      updateStatus(account === undefined
        ? { ...status, connection: 'disconnected', authMode: null, planType: null, error: undefined }
        : { ...status, connection: 'connected', ...account, error: undefined })
    }
    catch {
      updateStatus({
        ...status,
        connection: 'reauthenticationRequired',
        authMode: null,
        planType: null,
        error: 'Codex sign-in must be renewed.',
      })
    }
    return getStatus()
  }

  function startDeviceLogin(): Promise<CodexDeviceLogin> {
    if (activeLogin !== undefined)
      throw new Error('Device sign-in is already in progress.')

    const id = createLoginId()
    const abort = new AbortController()
    let resolveCode!: (login: CodexDeviceLogin) => void
    let rejectCode!: (error: Error) => void
    const code = new Promise<CodexDeviceLogin>((resolve, reject) => {
      resolveCode = resolve
      rejectCode = reject
    })
    const login: ActiveLogin = { id, abort, codePublished: false, resolveCode, rejectCode }
    activeLogin = login
    updateStatus({ ...status, login: 'pending', error: undefined })

    void deps.client.loginDevice({
      signal: abort.signal,
      onDeviceCode: info => publishDeviceCode(login, info),
    }).then((account) => {
      if (activeLogin !== login)
        return
      activeLogin = undefined
      if (!login.codePublished)
        login.rejectCode(new Error('Device sign-in did not provide a user code.'))
      updateStatus({ ...status, connection: 'connected', ...account, login: 'completed', error: undefined })
    }).catch(() => {
      if (activeLogin !== login)
        return
      activeLogin = undefined
      const error = new Error('Device sign-in failed.')
      if (!login.codePublished)
        login.rejectCode(error)
      updateStatus({ ...status, login: 'failed', error: error.message })
    })

    return code
  }

  function publishDeviceCode(login: ActiveLogin, info: DeviceCodeInfo): void {
    if (activeLogin !== login || login.codePublished)
      return
    login.codePublished = true
    login.resolveCode({
      type: 'chatgptDeviceCode',
      loginId: login.id,
      verificationUrl: info.verificationUrl,
      userCode: info.userCode,
      expiresAt: now() + (info.expiresInSeconds ?? 900) * 1_000,
    })
  }

  async function cancelLogin(loginId: string): Promise<void> {
    const login = activeLogin
    if (login === undefined || login.id !== loginId)
      return
    activeLogin = undefined
    login.abort.abort()
    if (!login.codePublished)
      login.rejectCode(new Error('Device sign-in was cancelled.'))
    updateStatus({ ...status, login: 'idle', error: undefined })
  }

  async function logout(): Promise<void> {
    cancelActiveLogin()
    try {
      await deps.client.logout()
      updateStatus({
        ...status,
        connection: 'disconnected',
        authMode: null,
        planType: null,
        login: 'idle',
        error: undefined,
      })
    }
    catch {
      updateStatus({ ...status, error: 'Codex sign-out failed.' })
      throw new Error('Codex sign-out failed.')
    }
  }

  async function stop(): Promise<void> {
    cancelActiveLogin()
    updateStatus({ ...status, login: 'idle' })
  }

  function cancelActiveLogin(): void {
    const login = activeLogin
    activeLogin = undefined
    if (login === undefined)
      return
    login.abort.abort()
    if (!login.codePublished)
      login.rejectCode(new Error('Device sign-in was stopped.'))
  }

  return {
    ensureStarted,
    getStatus,
    onStatusChange,
    startDeviceLogin,
    cancelLogin,
    logout,
    stop,
  }
}
