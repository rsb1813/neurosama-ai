// Codex renderer가 전체 대화와 도구를 직접 Responses 경로로 전달하는지 검증합니다.
import type { Tool } from '@xsai/shared-chat'

import type { CodexBridgeEvent, CodexRuntimeOverrides, CodexTurnRequest } from '../../shared/eventa/codex'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { initializeCodexBridge } from './codex'

function createHarness(runtimeOverrides: CodexRuntimeOverrides = { model: 'gpt-5.4', effort: 'high' }) {
  let handler: ((event: CodexBridgeEvent) => void | Promise<void>) | undefined
  const startTurn = vi.fn(async (_request: CodexTurnRequest) => {})
  const resolveToolCall = vi.fn(async () => {})
  const onStreamEvent = vi.fn(async () => {})
  const interruptTurn = vi.fn(async () => {})
  const bridge = initializeCodexBridge({
    startTurn,
    interruptTurn,
    resolveToolCall,
    onEvent: (next) => {
      handler = next
      return () => {
        handler = undefined
      }
    },
    getRuntimeOverrides: () => runtimeOverrides,
    developerInstructions: 'You are Neru.',
  })
  return {
    bridge,
    startTurn,
    interruptTurn,
    resolveToolCall,
    onStreamEvent,
    emit: async (event: CodexBridgeEvent) => await handler?.(event),
  }
}

describe('codex renderer bridge', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
  })

  it('sends the full JSON-safe conversation without app-server thread state', async () => {
    const harness = createHarness()
    const stream = harness.bridge.transport({
      providerId: 'codex-oauth',
      sessionId: 'session-1',
      model: 'codex-configured',
      messages: [
        { role: 'system', content: 'You are Neru.' },
        { role: 'user', content: 'First question.' },
        { role: 'assistant', content: 'First answer.' },
        { role: 'user', content: 'Second question.' },
      ],
      tools: [],
      options: { onStreamEvent: harness.onStreamEvent },
    })

    await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledOnce())
    const request = harness.startTurn.mock.calls[0][0]
    expect(request.messages).toEqual([
      { role: 'system', content: 'You are Neru.' },
      { role: 'user', content: 'First question.' },
      { role: 'assistant', content: 'First answer.' },
      { role: 'user', content: 'Second question.' },
    ])
    expect(request).not.toHaveProperty('threadId')
    expect(request).not.toHaveProperty('userInput')
    expect(localStorage.getItem('neru/codex/thread-ids')).toBeNull()

    await harness.emit({ type: 'finish', streamId: request.streamId })
    await stream
    expect(harness.onStreamEvent).toHaveBeenCalledWith({ type: 'finish', finishReason: 'stop' })
  })

  it('executes a named AIRI tool and returns its result', async () => {
    const harness = createHarness()
    const tool = {
      function: { name: 'remember', description: 'Save memory.', parameters: { type: 'object' } },
      execute: vi.fn(async () => 'saved'),
    } as unknown as Tool
    const stream = harness.bridge.transport({
      providerId: 'codex-oauth',
      model: 'codex-configured',
      messages: [{ role: 'user', content: 'Remember this.' }],
      tools: [tool],
      options: {},
    })

    await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledOnce())
    const request = harness.startTurn.mock.calls[0][0]
    await harness.emit({ type: 'tool-call-request', streamId: request.streamId, callId: 'call-1', tool: 'remember', arguments: { text: 'x' } })
    await harness.emit({ type: 'finish', streamId: request.streamId })
    await stream

    expect(tool.execute).toHaveBeenCalledWith({ text: 'x' }, expect.any(Object))
    expect(harness.resolveToolCall).toHaveBeenCalledWith({ callId: 'call-1', result: { success: true, text: 'saved' } })
  })

  it('sends cloneable message content and reactive tool schemas', async () => {
    const harness = createHarness()
    harness.startTurn.mockImplementation(async (request) => {
      structuredClone(request)
    })
    const tool = {
      function: {
        name: 'remember',
        description: 'Save memory.',
        parameters: reactive({ type: 'object', properties: { text: { type: 'string' } } }),
      },
      execute: vi.fn(async () => 'saved'),
    } as unknown as Tool
    const stream = harness.bridge.transport({
      providerId: 'codex-oauth',
      model: 'codex-configured',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Remember this.' }] }],
      tools: [tool],
      options: {},
    })

    await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledOnce())
    const request = harness.startTurn.mock.calls[0][0]
    await harness.emit({ type: 'finish', streamId: request.streamId })
    await expect(stream).resolves.toBeUndefined()
  })

  it('forwards abort to the active direct stream', async () => {
    const harness = createHarness()
    const abort = new AbortController()
    abort.abort()
    const stream = harness.bridge.transport({
      providerId: 'codex-oauth',
      model: 'codex-configured',
      messages: [{ role: 'user', content: 'Stop.' }],
      tools: [],
      options: { abortSignal: abort.signal },
    })

    await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledOnce())
    expect(harness.interruptTurn).toHaveBeenCalledOnce()
    const request = harness.startTurn.mock.calls[0][0]
    await harness.emit({ type: 'interrupted', streamId: request.streamId })
    await stream
  })
})
