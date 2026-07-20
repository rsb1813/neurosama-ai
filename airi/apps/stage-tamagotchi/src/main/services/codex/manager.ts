// Codex app-server와 Device OAuth 계정의 런타임 수명주기를 관리한다.
import type { CodexDeviceLogin, CodexRuntimeStatus } from '../../../shared/eventa/codex'
import type { CodexCliInspection, CodexJsonRpcClient, CodexLineIo, JsonRpcNotification } from './types'

import { inspectCodexCli, startCodexAppServer } from './cli'
import { createCodexJsonRpcClient } from './json-rpc-client'

/** Codex CLI와 app-server의 현재 런타임 상태를 UI에 전달하는 스냅샷이다. */
export type { CodexDeviceLogin, CodexRuntimeStatus } from '../../../shared/eventa/codex'

/** manager가 실제 child process에서 사용하는 최소 app-server 프로세스 표면이다. */
export interface CodexAppServerProcess {
  /** JSON-RPC JSONL 요청을 기록하고 종료 시 닫는 표준 입력이다. */
  stdin: {
    write: (chunk: string) => boolean
    end: () => void
  }
  /** JSONL 응답과 알림을 읽는 표준 출력이다. */
  stdout: {
    on: (event: 'data', handler: (chunk: string) => void) => void
  }
  /** 이미 종료된 프로세스는 `null`이 아닌 종료 코드를 갖는다. */
  exitCode: number | null
  /** 정상 종료가 지연될 때 남은 프로세스를 정리한다. */
  kill: () => boolean
  /** RPC 대기 요청을 해제할 app-server 종료 이벤트를 구독한다. */
  on: (event: 'exit', handler: (code: number | null) => void) => void
}

/** Codex manager가 외부 시스템에 닿는 경계다. */
export interface CodexManagerDeps {
  /** 표시할 Neru 애플리케이션 버전이다. */
  appVersion: string
  /** ephemeral capability probe가 읽기 전용으로 실행될 작업 공간 루트다. */
  workspaceRoot: string
  /** @default {@link inspectCodexCli}. 설치와 최소 지원 버전을 검사한다. */
  inspect?: () => Promise<CodexCliInspection>
  /** @default {@link startCodexAppServer}. 매니저가 소유할 app-server 한 개를 시작한다. */
  spawn?: () => CodexAppServerProcess
  /** @default {@link createCodexJsonRpcClient}. private JSONL 어댑터 위에 RPC를 생성한다. */
  createRpc?: (io: CodexLineIo) => CodexJsonRpcClient
}

/**
 * 단일 Codex app-server와 Device OAuth의 런타임 수명주기를 소유한다.
 *
 * 계정이나 토큰을 저장하지 않고, `account/read`와 `account/updated`에서 얻은 최소 상태만
 * 메모리 스냅샷으로 유지한다. `account/*` 알림은 이 매니저가 소유해 상태 구독자에게만
 * 전파하며, {@link CodexManager.stop}은 stdin을 닫고 남은 프로세스를 종료한다.
 */
export interface CodexManager {
  /** CLI를 검사하고, 초기화·기능 프로브·계정 읽기를 마친 최신 런타임 스냅샷을 반환한다. */
  ensureStarted: () => Promise<CodexRuntimeStatus>
  /** 외부에서 변경할 수 없는 현재 런타임 스냅샷을 반환한다. */
  getStatus: () => CodexRuntimeStatus
  /** 실행 중인 app-server의 RPC만 반환하며, 중지 상태에서는 `undefined`를 반환한다. */
  getRpc: () => CodexJsonRpcClient | undefined
  /** 상태 변경을 구독하며, 반환 함수로 구독을 해제한다. */
  onStatusChange: (handler: (status: CodexRuntimeStatus) => void) => () => void
  /** app-server가 관리하는 ChatGPT Device OAuth를 시작한다. */
  startDeviceLogin: () => Promise<CodexDeviceLogin>
  /** 일치하는 pending Device OAuth 요청을 app-server에 취소한다. */
  cancelLogin: (loginId: string) => Promise<void>
  /** app-server에 Codex 계정 로그아웃을 요청한다. 계정 상태는 이후 알림이 확정한다. */
  logout: () => Promise<void>
  /** pending 로그인도 취소하고 app-server stdin과 프로세스를 정리한다. */
  stop: () => Promise<void>
}

/**
 * Codex app-server 매니저를 만든다.
 *
 * `ensureStarted()`는 동시에 여러 번 호출되어도 app-server 하나만 시작한다. CLI 또는
 * capability 문제는 throw 대신 UI가 구분 가능한 `unsupported` 스냅샷으로 반환하며,
 * 다른 초기화 실패도 원문 응답을 보관하지 않는 런타임 오류 스냅샷으로 반환한다.
 */
export function createCodexManager(deps: CodexManagerDeps): CodexManager {
  const inspect = deps.inspect ?? inspectCodexCli
  const spawn = deps.spawn ?? startCodexAppServer
  const createRpc = deps.createRpc ?? createCodexJsonRpcClient
  const statusHandlers = new Set<(status: CodexRuntimeStatus) => void>()
  let status: CodexRuntimeStatus = {
    cli: 'unknown',
    process: 'stopped',
    authMode: null,
    planType: null,
    login: 'idle',
  }
  let process: CodexAppServerProcess | undefined
  let rpc: CodexJsonRpcClient | undefined
  let removeNotificationHandler: (() => void) | undefined
  let pendingLoginId: string | undefined
  let pendingAccountStatus: Pick<CodexRuntimeStatus, 'authMode' | 'planType'> | undefined
  let isDeviceLoginStarting = false
  let starting: Promise<CodexRuntimeStatus> | undefined
  let lifecycleId = 0

  function getStatus(): CodexRuntimeStatus {
    // 외부 호출자가 내부 runtime snapshot을 바꾸지 못하도록 매번 복사본을 준다.
    return { ...status }
  }

  function getRpc(): CodexJsonRpcClient | undefined {
    return rpc
  }

  function updateStatus(next: CodexRuntimeStatus): void {
    status = next
    const snapshot = getStatus()
    for (const handler of statusHandlers)
      handler(snapshot)
  }

  function onStatusChange(handler: (nextStatus: CodexRuntimeStatus) => void): () => void {
    statusHandlers.add(handler)
    return () => statusHandlers.delete(handler)
  }

  async function ensureStarted(): Promise<CodexRuntimeStatus> {
    if (rpc !== undefined)
      return getStatus()
    if (starting !== undefined)
      return starting

    const startId = ++lifecycleId
    const startPromise = startProcess(startId)
    starting = startPromise
    void startPromise.finally(() => {
      if (starting === startPromise)
        starting = undefined
    })
    return startPromise
  }

  async function startProcess(startId: number): Promise<CodexRuntimeStatus> {
    let requiresExperimentalCapability = false
    try {
      const inspection = await inspect()
      if (startId !== lifecycleId)
        return getStatus()

      if (!inspection.installed || !inspection.supported) {
        updateStatus({
          ...status,
          cli: 'unsupported',
          process: 'stopped',
          error: 'Codex CLI must be updated before it can be used.',
        })
        return getStatus()
      }

      const startedProcess = spawn()
      if (startId !== lifecycleId) {
        stopProcess(startedProcess)
        return getStatus()
      }

      process = startedProcess
      const client = createRpc(createChildProcessLineIo(startedProcess))
      rpc = client
      removeNotificationHandler = client.onNotification(handleNotification)
      startedProcess.on('exit', () => {
        if (process !== startedProcess)
          return

        process = undefined
        rpc = undefined
        removeNotificationHandler?.()
        removeNotificationHandler = undefined
        const hadPendingLogin = pendingLoginId !== undefined || isDeviceLoginStarting
        pendingLoginId = undefined
        pendingAccountStatus = undefined
        isDeviceLoginStarting = false
        updateStatus({
          ...status,
          process: 'stopped',
          login: hadPendingLogin ? 'failed' : status.login,
          error: hadPendingLogin ? 'Device sign-in was interrupted.' : status.error,
        })
      })
      updateStatus({ ...status, cli: 'supported', process: 'running', error: undefined })

      await client.request('initialize', {
        clientInfo: { name: 'neru', title: 'Neru', version: deps.appVersion },
        capabilities: { experimentalApi: true },
      })
      if (startId !== lifecycleId)
        return getStatus()

      // 공식 handshake는 initialize 성공 직후 이 ID 없는 알림을 요구한다.
      client.notify('initialized', {})
      requiresExperimentalCapability = true
      const probe = await client.request<unknown>('thread/start', {
        cwd: deps.workspaceRoot,
        ephemeral: true,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        dynamicTools: [{
          type: 'function',
          name: 'neru_capability_probe',
          description: 'Neru capability probe',
          inputSchema: { type: 'object', properties: {} },
        }],
      })
      if (startId !== lifecycleId)
        return getStatus()

      const threadId = getProbeThreadId(probe)
      if (threadId === undefined)
        throw new CapabilityProbeError()

      await client.request('thread/unsubscribe', { threadId })
      requiresExperimentalCapability = false
      const account = await client.request<unknown>('account/read', { refreshToken: true })
      if (startId !== lifecycleId)
        return getStatus()

      const accountStatus = readAccountStatus(account)
      updateStatus({
        ...status,
        authMode: accountStatus.authMode,
        planType: accountStatus.planType,
        error: undefined,
      })
      return getStatus()
    }
    catch (error) {
      if (startId !== lifecycleId)
        return getStatus()

      const capabilityFailure = error instanceof CapabilityProbeError || requiresExperimentalCapability
      disposeProcess()
      updateStatus({
        ...status,
        cli: capabilityFailure ? 'unsupported' : 'supported',
        process: 'stopped',
        error: capabilityFailure
          ? 'Codex CLI must be updated before it can be used.'
          : 'Codex app-server could not be started.',
      })
      return getStatus()
    }
  }

  async function startDeviceLogin(): Promise<CodexDeviceLogin> {
    const currentStatus = await ensureStarted()
    const client = rpc
    const loginLifecycleId = lifecycleId
    if (client === undefined || currentStatus.cli === 'unsupported')
      throw new Error('Codex CLI is unavailable.')
    if (pendingLoginId !== undefined || isDeviceLoginStarting)
      throw new Error('Device sign-in is already in progress.')

    isDeviceLoginStarting = true
    pendingAccountStatus = undefined
    updateStatus({ ...status, login: 'pending', error: undefined })
    try {
      const response = await client.request<unknown>('account/login/start', { type: 'chatgptDeviceCode' })
      if (rpc !== client || lifecycleId !== loginLifecycleId)
        throw new DeviceLoginStoppedError()

      const login = readDeviceLogin(response)
      if (login === undefined)
        throw new Error('Invalid Device OAuth response.')

      pendingLoginId = login.loginId
      isDeviceLoginStarting = false
      return login
    }
    catch (error) {
      if (error instanceof DeviceLoginStoppedError || rpc !== client || lifecycleId !== loginLifecycleId)
        throw new Error('Device sign-in was stopped.')

      isDeviceLoginStarting = false
      pendingAccountStatus = undefined
      updateStatus({ ...status, login: 'failed', error: 'Device sign-in could not be started.' })
      throw new Error('Device sign-in could not be started.')
    }
  }

  async function cancelLogin(loginId: string): Promise<void> {
    const client = rpc
    if (client === undefined || pendingLoginId !== loginId)
      return

    try {
      await client.request('account/login/cancel', { loginId })
    }
    catch {
      throw new Error('Device sign-in could not be cancelled.')
    }

    pendingLoginId = undefined
    pendingAccountStatus = undefined
    isDeviceLoginStarting = false
    updateStatus({ ...status, login: 'idle', error: undefined })
  }

  async function logout(): Promise<void> {
    await ensureStarted()
    const client = rpc
    if (client === undefined)
      return

    try {
      await client.request('account/logout', {})
    }
    catch {
      throw new Error('Codex sign-out failed.')
    }
  }

  async function stop(): Promise<void> {
    lifecycleId++
    const client = rpc
    const loginId = pendingLoginId
    const activeProcess = process
    if (client !== undefined && loginId !== undefined && activeProcess !== undefined) {
      // 취소 JSONL 요청이 stdin에 기록된 뒤 짧게 기다리되, 무응답이면 반드시 종료로 진행한다.
      await Promise.race([
        client.request('account/login/cancel', { loginId }).then(() => undefined).catch(() => undefined),
        waitForProcessExit(activeProcess),
        waitForDelay(100),
      ])
    }

    pendingLoginId = undefined
    pendingAccountStatus = undefined
    isDeviceLoginStarting = false
    disposeProcess()
    updateStatus({ ...status, process: 'stopped', login: 'idle' })
  }

  function disposeProcess(): void {
    const activeProcess = process
    process = undefined
    rpc = undefined
    removeNotificationHandler?.()
    removeNotificationHandler = undefined
    if (activeProcess !== undefined)
      stopProcess(activeProcess)
  }

  function handleNotification(message: JsonRpcNotification): void {
    if (message.method === 'account/updated') {
      const accountStatus = readAccountStatus(message.params)
      if (pendingLoginId !== undefined || isDeviceLoginStarting) {
        pendingAccountStatus = accountStatus
        return
      }

      updateStatus({
        ...status,
        authMode: accountStatus.authMode,
        planType: accountStatus.planType,
        error: undefined,
      })
      return
    }

    if (message.method !== 'account/login/completed')
      return

    const completion = readLoginCompletion(message.params)
    if (completion === undefined || completion.loginId !== pendingLoginId)
      return

    pendingLoginId = undefined
    const bufferedAccountStatus = pendingAccountStatus
    pendingAccountStatus = undefined
    updateStatus(completion.success
      ? { ...status, ...bufferedAccountStatus, login: 'completed', error: undefined }
      : { ...status, login: 'failed', error: 'Device sign-in failed.' })
  }

  return {
    ensureStarted,
    getStatus,
    getRpc,
    onStatusChange,
    startDeviceLogin,
    cancelLogin,
    logout,
    stop,
  }
}

function stopProcess(process: CodexAppServerProcess): void {
  process.stdin.end()
  if (process.exitCode === null)
    process.kill()
}

function waitForProcessExit(process: CodexAppServerProcess): Promise<void> {
  return new Promise((resolve) => {
    process.on('exit', () => resolve())
  })
}

function waitForDelay(delay: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delay))
}

/** spawned child process의 stdout JSONL, stdin JSONL, exit를 Task 2 경계에 연결한다. */
function createChildProcessLineIo(process: CodexAppServerProcess): CodexLineIo {
  const lineHandlers = new Set<(line: string) => void>()
  const exitHandlers = new Set<(code: number | null) => void>()
  let bufferedOutput = ''

  process.stdout.on('data', (chunk) => {
    bufferedOutput += String(chunk)
    const lines = bufferedOutput.split(/\r?\n/)
    bufferedOutput = lines.pop() ?? ''
    for (const line of lines) {
      for (const handler of lineHandlers)
        handler(line)
    }
  })
  process.on('exit', (code) => {
    for (const handler of exitHandlers)
      handler(code)
  })

  return {
    write(message) {
      process.stdin.write(`${JSON.stringify(message)}\n`)
    },
    onLine(handler) {
      lineHandlers.add(handler)
      return () => lineHandlers.delete(handler)
    },
    onExit(handler) {
      exitHandlers.add(handler)
      return () => exitHandlers.delete(handler)
    },
  }
}

function readAccountStatus(value: unknown): Pick<CodexRuntimeStatus, 'authMode' | 'planType'> {
  if (!isRecord(value))
    return { authMode: null, planType: null }
  if (value.account === null)
    return { authMode: null, planType: null }

  const account = isRecord(value.account) ? value.account : value
  return {
    authMode: readNullableText(account.authMode),
    planType: readNullableText(account.planType),
  }
}

function readDeviceLogin(value: unknown): CodexDeviceLogin | undefined {
  if (!isRecord(value)
    || value.type !== 'chatgptDeviceCode'
    || typeof value.loginId !== 'string'
    || typeof value.verificationUrl !== 'string'
    || typeof value.userCode !== 'string') {
    return undefined
  }

  return {
    type: value.type,
    loginId: value.loginId,
    verificationUrl: value.verificationUrl,
    userCode: value.userCode,
  }
}

function readLoginCompletion(value: unknown): { loginId: string, success: boolean } | undefined {
  if (!isRecord(value) || typeof value.loginId !== 'string' || typeof value.success !== 'boolean')
    return undefined

  return { loginId: value.loginId, success: value.success }
}

function getProbeThreadId(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.thread) || typeof value.thread.id !== 'string')
    return undefined

  return value.thread.id
}

function readNullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class CapabilityProbeError extends Error {}

class DeviceLoginStoppedError extends Error {}
