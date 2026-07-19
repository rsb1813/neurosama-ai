// Codex Device OAuth 매니저의 프로세스와 계정 수명주기를 검증한다.
import type { CodexCliInspection, CodexJsonRpcClient, JsonRpcNotification, JsonRpcServerRequest } from './types'

import { describe, expect, it, vi } from 'vitest'

import { createCodexManager } from './manager'

interface RpcCall {
  method: string
  params: unknown
}

interface FakeProcess {
  stdin: {
    end: () => void
    write: (chunk: string) => boolean
  }
  stdout: {
    on: (event: 'data', handler: (chunk: string) => void) => void
  }
  exitCode: number | null
  ended: boolean
  killed: boolean
  exit: (code: number | null) => void
  kill: () => boolean
  on: (event: 'exit', handler: (code: number | null) => void) => void
}

interface ManagerHarness {
  calls: RpcCall[]
  manager: ReturnType<typeof createCodexManager>
  notify: (method: string, params: unknown) => void
  process: FakeProcess
  resolveRequest: (method: string, result: unknown) => void
  spawnCalls: number
}

interface HarnessOptions {
  inspection?: CodexCliInspection
  deferredMethods?: readonly string[]
  loginStart?: unknown
  pendingMethods?: readonly string[]
  requestErrors?: Readonly<Record<string, Error>>
  spawnError?: Error
}

function createManagerHarness(options: HarnessOptions = {}): ManagerHarness {
  const calls: RpcCall[] = []
  const notificationHandlers = new Set<(message: JsonRpcNotification) => void>()
  const deferredRequests = new Map<string, (result: unknown) => void>()
  const process = createFakeProcess()
  let spawnCalls = 0
  const inspection = options.inspection ?? { installed: true, supported: true, version: '0.144.4' }
  const requestErrors = options.requestErrors ?? {}
  const rpc: CodexJsonRpcClient = {
    async request<T>(method: string, params: unknown): Promise<T> {
      calls.push({ method, params })
      if (options.deferredMethods?.includes(method) === true) {
        return new Promise<T>((resolve) => {
          deferredRequests.set(method, result => resolve(result as T))
        })
      }
      if (options.pendingMethods?.includes(method) === true)
        return new Promise<T>(() => {})
      const error = requestErrors[method]
      if (error !== undefined)
        throw error

      if (method === 'thread/start')
        return { thread: { id: 'probe-thread' } } as T
      if (method === 'account/read')
        return { account: null } as T
      if (method === 'account/login/start') {
        return (options.loginStart ?? {
          type: 'chatgptDeviceCode',
          loginId: 'login-1',
          verificationUrl: 'https://auth.openai.com/codex/device',
          userCode: 'ABCD-1234',
        }) as T
      }

      return {} as T
    },
    respond() {},
    notify(method: string, params: unknown) {
      calls.push({ method, params })
    },
    onNotification(handler: (message: JsonRpcNotification) => void) {
      notificationHandlers.add(handler)
      return () => notificationHandlers.delete(handler)
    },
    onServerRequest(_handler: (message: JsonRpcServerRequest) => void) {
      return () => false
    },
  }
  const manager = createCodexManager({
    appVersion: '1.2.3',
    createRpc: () => rpc,
    inspect: async () => inspection,
    spawn: () => {
      spawnCalls++
      if (options.spawnError !== undefined)
        throw options.spawnError
      return process
    },
    workspaceRoot: '/workspace/neru',
  })

  return {
    calls,
    manager,
    notify(method, params) {
      for (const handler of notificationHandlers)
        handler({ method, params })
    },
    process,
    resolveRequest(method, result) {
      const resolve = deferredRequests.get(method)
      if (resolve === undefined)
        throw new Error(`No deferred request for ${method}.`)

      deferredRequests.delete(method)
      resolve(result)
    },
    get spawnCalls() {
      return spawnCalls
    },
  }
}

function createFakeProcess(): FakeProcess {
  const exitHandlers = new Set<(code: number | null) => void>()
  const process: FakeProcess = {
    stdin: {
      end() {
        process.ended = true
      },
      write() {
        return true
      },
    },
    stdout: {
      on() {},
    },
    exitCode: null,
    ended: false,
    killed: false,
    exit(code) {
      process.exitCode = code
      for (const handler of exitHandlers)
        handler(code)
    },
    kill() {
      process.killed = true
      process.exit(1)
      return true
    },
    on(_event, handler) {
      exitHandlers.add(handler)
    },
  }

  return process
}

describe('createCodexManager', () => {
  it('shares one in-flight start across concurrent ensureStarted calls', async () => {
    const harness = createManagerHarness()

    await Promise.all([harness.manager.ensureStarted(), harness.manager.ensureStarted()])

    expect(harness.spawnCalls).toBe(1)
  })

  it('initializes once, acknowledges initialization, probes capabilities, and reads the account', async () => {
    const harness = createManagerHarness()

    await harness.manager.ensureStarted()

    expect(harness.calls).toEqual([
      {
        method: 'initialize',
        params: {
          clientInfo: { name: 'neru', title: 'Neru', version: '1.2.3' },
          capabilities: { experimentalApi: true },
        },
      },
      { method: 'initialized', params: {} },
      {
        method: 'thread/start',
        params: {
          cwd: '/workspace/neru',
          ephemeral: true,
          sandbox: 'readOnly',
          approvalPolicy: 'never',
          dynamicTools: [{
            type: 'function',
            name: 'neru_capability_probe',
            description: 'Neru capability probe',
            inputSchema: { type: 'object', properties: {} },
          }],
        },
      },
      { method: 'thread/unsubscribe', params: { threadId: 'probe-thread' } },
      { method: 'account/read', params: { refreshToken: true } },
    ])
  })

  it('keeps authentication inactive until the completed and account notifications arrive', async () => {
    const harness = createManagerHarness()

    const login = await harness.manager.startDeviceLogin()

    expect(login).toMatchObject({
      loginId: 'login-1',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
    })
    expect(harness.manager.getStatus()).toMatchObject({ authMode: null, planType: null, login: 'pending' })

    harness.notify('account/updated', { authMode: 'chatgpt', planType: 'plus' })
    expect(harness.manager.getStatus()).toMatchObject({ authMode: null, planType: null, login: 'pending' })

    harness.notify('account/login/completed', { loginId: 'login-1', success: true, error: null })
    expect(harness.manager.getStatus()).toMatchObject({ authMode: 'chatgpt', planType: 'plus', login: 'completed' })
  })

  it('records a safe failed-login state from the completion notification', async () => {
    const harness = createManagerHarness()

    await harness.manager.startDeviceLogin()
    harness.notify('account/login/completed', { loginId: 'login-1', success: false, error: 'details must not be retained' })

    expect(harness.manager.getStatus()).toMatchObject({
      authMode: null,
      login: 'failed',
      error: 'Device sign-in failed.',
    })
  })

  it('discards a pending account update when Device OAuth is cancelled', async () => {
    const harness = createManagerHarness()

    await harness.manager.startDeviceLogin()
    harness.notify('account/updated', { authMode: 'chatgpt', planType: 'plus' })
    await harness.manager.cancelLogin('login-1')

    expect(harness.manager.getStatus()).toMatchObject({ authMode: null, planType: null, login: 'idle' })
  })

  it('cancels a pending login, clears account state on logout, and terminates the process', async () => {
    const harness = createManagerHarness()

    await harness.manager.startDeviceLogin()
    await harness.manager.cancelLogin('login-1')
    harness.notify('account/updated', { authMode: 'chatgpt', planType: 'plus' })
    await harness.manager.logout()
    harness.notify('account/updated', { authMode: null, planType: null })
    await harness.manager.stop()

    expect(harness.calls).toContainEqual({ method: 'account/login/cancel', params: { loginId: 'login-1' } })
    expect(harness.calls).toContainEqual({ method: 'account/logout', params: {} })
    expect(harness.manager.getStatus()).toMatchObject({ authMode: null, planType: null, process: 'stopped' })
    expect(harness.process).toMatchObject({ ended: true, killed: true })
  })

  it('returns a distinct unsupported status without spawning an unsupported CLI', async () => {
    const harness = createManagerHarness({
      inspection: { installed: true, supported: false, version: '0.144.3' },
    })

    await expect(harness.manager.ensureStarted()).resolves.toMatchObject({
      cli: 'unsupported',
      process: 'stopped',
      error: 'Codex CLI must be updated before it can be used.',
    })
    expect(harness.spawnCalls).toBe(0)
  })

  it('terminates a process and returns an update status when the capability probe fails', async () => {
    const harness = createManagerHarness({
      requestErrors: { 'thread/start': new Error('dynamicTools unavailable') },
    })

    await expect(harness.manager.ensureStarted()).resolves.toMatchObject({
      cli: 'unsupported',
      process: 'stopped',
      error: 'Codex CLI must be updated before it can be used.',
    })
    expect(harness.process).toMatchObject({ ended: true, killed: true })
  })

  it('keeps a supported CLI status when initialize fails before the dynamic-tools probe', async () => {
    const harness = createManagerHarness({
      requestErrors: { initialize: new Error('initialization failed') },
    })

    await expect(harness.manager.ensureStarted()).resolves.toMatchObject({
      cli: 'supported',
      process: 'stopped',
      error: 'Codex app-server could not be started.',
    })
  })

  it('keeps a supported CLI distinct from an app-server spawn failure', async () => {
    const harness = createManagerHarness({ spawnError: new Error('spawn failed') })

    await expect(harness.manager.ensureStarted()).resolves.toMatchObject({
      cli: 'supported',
      process: 'stopped',
      error: 'Codex app-server could not be started.',
    })
  })

  it('marks a pending login as failed and discards buffered account state when the process exits', async () => {
    const harness = createManagerHarness()

    await harness.manager.startDeviceLogin()
    harness.notify('account/updated', { authMode: 'chatgpt', planType: 'plus' })
    harness.process.exit(1)

    expect(harness.manager.getStatus()).toMatchObject({
      authMode: null,
      planType: null,
      process: 'stopped',
      login: 'failed',
      error: 'Device sign-in was interrupted.',
    })
  })

  it('does not revive a stopped manager when a late Device OAuth response arrives', async () => {
    const harness = createManagerHarness({ deferredMethods: ['account/login/start'] })

    await harness.manager.ensureStarted()
    const login = harness.manager.startDeviceLogin()
    await Promise.resolve()
    await harness.manager.stop()
    harness.resolveRequest('account/login/start', {
      type: 'chatgptDeviceCode',
      loginId: 'login-1',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
    })

    await expect(login).rejects.toThrow('Device sign-in was stopped.')
    expect(harness.manager.getStatus()).toMatchObject({ process: 'stopped', login: 'idle' })
  })

  it('rejects a duplicate Device OAuth start before it reaches the app-server', async () => {
    const harness = createManagerHarness({ deferredMethods: ['account/login/start'] })

    await harness.manager.ensureStarted()
    const firstLogin = harness.manager.startDeviceLogin()
    await Promise.resolve()

    const secondLogin = harness.manager.startDeviceLogin().then(
      () => 'resolved',
      error => String(error),
    )
    const timeout = new Promise<'timed out'>(resolve => setTimeout(resolve, 0, 'timed out'))

    await expect(Promise.race([secondLogin, timeout])).resolves.toBe('Error: Device sign-in is already in progress.')
    expect(harness.calls.filter(call => call.method === 'account/login/start')).toHaveLength(1)

    harness.resolveRequest('account/login/start', {
      type: 'chatgptDeviceCode',
      loginId: 'login-1',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
    })
    await firstLogin
  })

  it('buffers account updates that arrive before a Device OAuth start response', async () => {
    const harness = createManagerHarness({ deferredMethods: ['account/login/start'] })

    await harness.manager.ensureStarted()
    const login = harness.manager.startDeviceLogin()
    await Promise.resolve()
    harness.notify('account/updated', { authMode: 'chatgpt', planType: 'plus' })

    expect(harness.manager.getStatus()).toMatchObject({ authMode: null, planType: null, login: 'pending' })

    harness.resolveRequest('account/login/start', {
      type: 'chatgptDeviceCode',
      loginId: 'login-1',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
    })
    await login
    expect(harness.manager.getStatus()).toMatchObject({ authMode: null, planType: null, login: 'pending' })

    harness.notify('account/login/completed', { loginId: 'login-1', success: true, error: null })
    expect(harness.manager.getStatus()).toMatchObject({ authMode: 'chatgpt', planType: 'plus', login: 'completed' })
  })

  it('gives a pending cancel request a bounded grace period before killing the process', async () => {
    const harness = createManagerHarness({ deferredMethods: ['account/login/cancel'] })

    await harness.manager.startDeviceLogin()
    vi.useFakeTimers()
    try {
      const stop = harness.manager.stop()

      expect(harness.process).toMatchObject({ ended: false, killed: false })
      await vi.advanceTimersByTimeAsync(100)
      await stop
      expect(harness.process).toMatchObject({ ended: true, killed: true })
    }
    finally {
      vi.useRealTimers()
    }
  })
})
