// Codex Eventa 서비스의 창별 바인딩과 단일 controller 수명을 검증한다.
import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { CodexApprovalDecision, CodexBridgeEvent, CodexRuntimeStatus, CodexToolResult, CodexTurnRequest } from '../../../shared/eventa/codex'
import type { CodexDirectClient } from './direct-client'
import type { CodexManager } from './manager'

import { readFileSync } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createCodexController, createCodexService } from './service'

const createCodexTurnRuntimeMock = vi.hoisted(() => vi.fn())
const defineInvokeHandlersMock = vi.hoisted(() => vi.fn())

vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()
  return {
    ...actual,
    defineInvokeHandlers: defineInvokeHandlersMock,
  }
})

vi.mock('./turn-runtime', () => ({
  createCodexTurnRuntime: createCodexTurnRuntimeMock,
}))

type MainContext = ReturnType<typeof createContext>['context']

interface CodexInvokeHandlers {
  getStatus: () => CodexRuntimeStatus
  listModels: () => Promise<unknown>
  startDeviceLogin: () => Promise<{ loginId: string, verificationUrl: string, userCode: string, type: 'chatgptDeviceCode', expiresAt: number }>
  cancelDeviceLogin: (payload: { loginId: string }) => Promise<void>
  logout: () => Promise<void>
  startTurn: (payload: CodexTurnRequest) => Promise<{ threadId: string }>
  interruptTurn: (payload: { streamId: string }) => Promise<void>
  resolveToolCall: (payload: { callId: string, result: CodexToolResult }) => void
  resolveApproval: (payload: { requestId: string, decision: CodexApprovalDecision }) => void
}

interface ServiceHarness {
  controller: ReturnType<typeof createCodexController>
  handlers: CodexInvokeHandlers
  manager: CodexManager
  clientSpies: {
    listModels: ReturnType<typeof vi.fn>
  }
  managerSpies: {
    cancelLogin: ReturnType<typeof vi.fn>
    getStatus: ReturnType<typeof vi.fn>
    logout: ReturnType<typeof vi.fn>
    startDeviceLogin: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  }
  runtime: {
    interrupt: ReturnType<typeof vi.fn>
    resolveApproval: ReturnType<typeof vi.fn>
    resolveToolCall: ReturnType<typeof vi.fn>
    startTurn: ReturnType<typeof vi.fn>
  }
  status: CodexRuntimeStatus
  emitStatus: (status: CodexRuntimeStatus) => void
}

function createMainContext() {
  const emit = vi.fn()
  return { context: { emit } as unknown as MainContext, emit }
}

function createHarness(): ServiceHarness {
  const statusHandlers = new Set<(status: CodexRuntimeStatus) => void>()
  const status: CodexRuntimeStatus = {
    connection: 'connected',
    authMode: 'chatgpt',
    planType: 'plus',
    login: 'idle',
  }
  const managerSpies = {
    cancelLogin: vi.fn(async () => {}),
    getStatus: vi.fn(() => status),
    logout: vi.fn(async () => {}),
    startDeviceLogin: vi.fn(async () => ({
      loginId: 'login-1',
      verificationUrl: 'https://auth.openai.com/device',
      userCode: 'ABCD',
      type: 'chatgptDeviceCode' as const,
      expiresAt: 123_000,
    })),
    stop: vi.fn(async () => {}),
  }
  const manager: CodexManager = {
    ...managerSpies,
    ensureStarted: vi.fn(async () => status),
    onStatusChange: vi.fn((handler) => {
      statusHandlers.add(handler)
      return () => statusHandlers.delete(handler)
    }),
  }
  const clientSpies = {
    listModels: vi.fn(async () => [{
      id: 'gpt-x',
      name: 'GPT X',
      supportedReasoningEfforts: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
      ],
      serviceTiers: ['default', 'fast'],
    }]),
  }
  const client = {
    ...clientSpies,
  } as unknown as CodexDirectClient
  const runtime = {
    interrupt: vi.fn(async () => {}),
    resolveApproval: vi.fn(),
    resolveToolCall: vi.fn(),
    startTurn: vi.fn(async () => ({ threadId: 'thread-1' })),
  }
  createCodexTurnRuntimeMock.mockReturnValue(runtime)
  const controller = createCodexController({ client, manager })
  let handlers: CodexInvokeHandlers | undefined
  defineInvokeHandlersMock.mockImplementation((_context, _contracts, registeredHandlers) => {
    handlers = registeredHandlers as CodexInvokeHandlers
  })
  const mainContext = createMainContext()
  createCodexService({ context: mainContext.context, controller })
  if (handlers === undefined)
    throw new Error('Codex invoke handlers were not registered.')

  return {
    controller,
    clientSpies,
    handlers,
    manager,
    managerSpies,
    runtime,
    status,
    emitStatus: nextStatus => statusHandlers.forEach(handler => handler(nextStatus)),
  }
}

const turnRequest: CodexTurnRequest = {
  streamId: 'stream-1',
  overrides: {},
  developerInstructions: 'Follow the project rules.',
  dynamicTools: [],
  messages: [{ role: 'user', content: 'Hello' }],
}

describe('codex Eventa service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes account invokes to the shared manager', async () => {
    const harness = createHarness()

    expect(harness.handlers.getStatus()).toEqual(harness.status)
    await harness.handlers.startDeviceLogin()
    await harness.handlers.cancelDeviceLogin({ loginId: 'login-1' })
    await harness.handlers.logout()

    expect(harness.managerSpies.getStatus).toHaveBeenCalledOnce()
    expect(harness.managerSpies.startDeviceLogin).toHaveBeenCalledOnce()
    expect(harness.managerSpies.cancelLogin).toHaveBeenCalledWith('login-1')
    expect(harness.managerSpies.logout).toHaveBeenCalledOnce()
  })

  it('returns the direct client model, reasoning effort and service tier order', async () => {
    const harness = createHarness()

    await expect(harness.handlers.listModels()).resolves.toEqual([{
      id: 'gpt-x',
      name: 'GPT X',
      supportedReasoningEfforts: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
      ],
      serviceTiers: ['default', 'fast'],
    }])
    expect(harness.clientSpies.listModels).toHaveBeenCalledOnce()
  })

  it('routes turn, interrupt, tool result and approval decision invokes to the shared runtime', async () => {
    const harness = createHarness()
    const toolResult: CodexToolResult = { success: true, text: 'done' }
    const approval: CodexApprovalDecision = { type: 'acceptForSession' }

    await harness.handlers.startTurn(turnRequest)
    await harness.handlers.interruptTurn({ streamId: 'stream-1' })
    harness.handlers.resolveToolCall({ callId: 'call-1', result: toolResult })
    harness.handlers.resolveApproval({ requestId: 'approval-1', decision: approval })

    expect(harness.runtime.startTurn).toHaveBeenCalledOnce()
    expect(harness.runtime.interrupt).toHaveBeenCalledWith('stream-1')
    expect(harness.runtime.resolveToolCall).toHaveBeenCalledWith('call-1', toolResult)
    expect(harness.runtime.resolveApproval).toHaveBeenCalledWith('approval-1', approval)
  })

  it('emits a turn bridge event only to the context that started the turn', async () => {
    const harness = createHarness()
    const first = createMainContext()
    const second = createMainContext()
    createCodexService({ context: first.context, controller: harness.controller })
    createCodexService({ context: second.context, controller: harness.controller })
    const firstHandlers = defineInvokeHandlersMock.mock.calls.at(-2)?.[2] as CodexInvokeHandlers
    const secondHandlers = defineInvokeHandlersMock.mock.calls.at(-1)?.[2] as CodexInvokeHandlers
    let sink: ((event: CodexBridgeEvent) => void) | undefined
    harness.runtime.startTurn.mockImplementationOnce(async (_request: CodexTurnRequest, nextSink: (event: CodexBridgeEvent) => void) => {
      sink = nextSink
      return { threadId: 'thread-1' }
    })

    await firstHandlers.startTurn(turnRequest)
    sink?.({ type: 'text-delta', streamId: 'stream-1', threadId: 'thread-1', turnId: 'turn-1', text: 'Hi' })

    expect(first.emit).toHaveBeenCalledOnce()
    expect(second.emit).not.toHaveBeenCalled()
    expect(secondHandlers).toBeDefined()
  })

  it('interrupts a turn when its window binding is disposed', async () => {
    const harness = createHarness()
    const context = createMainContext()
    const binding = createCodexService({ context: context.context, controller: harness.controller })
    const handlers = defineInvokeHandlersMock.mock.calls.at(-1)?.[2] as CodexInvokeHandlers
    harness.runtime.startTurn.mockImplementationOnce(async () => new Promise(() => {}))

    void handlers.startTurn(turnRequest)
    await Promise.resolve()
    binding.dispose()

    expect(harness.runtime.interrupt).toHaveBeenCalledWith('stream-1')
  })

  it('broadcasts status changes to active bindings but not a disposed binding', () => {
    const harness = createHarness()
    const first = createMainContext()
    const second = createMainContext()
    const firstBinding = createCodexService({ context: first.context, controller: harness.controller })
    createCodexService({ context: second.context, controller: harness.controller })

    firstBinding.dispose()
    harness.emitStatus({ ...harness.status, login: 'completed' })

    expect(first.emit).not.toHaveBeenCalled()
    expect(second.emit).toHaveBeenCalledOnce()
  })

  it('creates one runtime and one manager status listener for multiple context bindings', () => {
    const harness = createHarness()
    const second = createMainContext()
    createCodexService({ context: second.context, controller: harness.controller })

    expect(createCodexTurnRuntimeMock).toHaveBeenCalledOnce()
    expect(harness.manager.onStatusChange).toHaveBeenCalledOnce()
  })

  it('stops the shared manager exactly once when shutdown is requested repeatedly', async () => {
    const harness = createHarness()

    await Promise.all([harness.controller.stop(), harness.controller.stop()])

    expect(harness.managerSpies.stop).toHaveBeenCalledOnce()
  })

  it('passes the same controller through main, settings, chat and spotlight wiring', () => {
    const sourceFiles = [
      '../../index.ts',
      '../../windows/main/rpc/index.electron.ts',
      '../../windows/settings/rpc/index.electron.ts',
      '../../windows/chat/rpc/index.electron.ts',
      '../../windows/spotlight/index.ts',
    ]

    for (const sourceFile of sourceFiles) {
      const source = readFileSync(new URL(sourceFile, import.meta.url), 'utf8')
      expect(source).toContain('codexController')
      if (sourceFile !== '../../index.ts')
        expect(source).toContain('createCodexService')
    }
  })
})
