// Codex Electron 이벤트를 AIRI 스트림과 도구 실행으로 변환하는 브리지를 검증한다.
import type { Tool } from '@xsai/shared-chat'
import type { CodexBridgeEvent, CodexTurnRequest } from '../../shared/eventa/codex'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { initializeCodexBridge } from './codex'

function createHarness() {
  let handler: ((event: CodexBridgeEvent) => void | Promise<void>) | undefined
  const startTurn = vi.fn(async (_request: CodexTurnRequest) => ({ threadId: 'thread-1' }))
  const resolveToolCall = vi.fn(async () => {})
  const onStreamEvent = vi.fn(async () => {})
  const bridge = initializeCodexBridge({
    startTurn,
    interruptTurn: vi.fn(async () => {}),
    resolveToolCall,
    onEvent: (next) => {
      handler = next
      return () => { handler = undefined }
    },
    getRuntimeOverrides: () => ({ model: 'gpt-x', effort: 'high' }),
    developerInstructions: 'You are Neru.',
  })

  return {
    bridge,
    startTurn,
    resolveToolCall,
    onStreamEvent,
    emit: async (event: CodexBridgeEvent) => await handler?.(event),
  }
}

describe('Codex renderer bridge', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
  })

  it('maps app-server deltas and persists the returned thread for the chat session', async () => {
    const harness = createHarness()
    const stream = harness.bridge.transport({
      providerId: 'codex-oauth',
      sessionId: 'session-1',
      model: 'codex-configured',
      messages: [{ role: 'user', content: 'Hello, Neru.' }],
      tools: [],
      options: { onStreamEvent: harness.onStreamEvent },
    })

    await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledOnce())
    const request = harness.startTurn.mock.calls[0][0]
    await harness.emit({ type: 'text-delta', streamId: request.streamId, threadId: 'thread-1', turnId: 'turn-1', text: 'Hi' })
    await harness.emit({ type: 'finish', streamId: request.streamId, threadId: 'thread-1', turnId: 'turn-1' })
    await stream

    expect(harness.onStreamEvent).toHaveBeenCalledWith({ type: 'text-delta', text: 'Hi' })
    expect(harness.onStreamEvent).toHaveBeenCalledWith({ type: 'finish', finishReason: 'stop' })
    expect(JSON.parse(localStorage.getItem('neru/codex/thread-ids')!)).toEqual({ 'session-1': 'thread-1' })
  })

  it('executes a named AIRI tool and returns a structured result', async () => {
    const harness = createHarness()
    const tool = {
      function: { name: 'remember', description: 'Save memory.', parameters: { type: 'object' } },
      execute: vi.fn(async () => 'saved'),
    } as unknown as Tool
    const stream = harness.bridge.transport({
      providerId: 'codex-oauth',
      sessionId: 'session-1',
      model: 'codex-configured',
      messages: [{ role: 'user', content: 'Remember this.' }],
      tools: [tool],
      options: {},
    })

    await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledOnce())
    const request = harness.startTurn.mock.calls[0][0]
    await harness.emit({ type: 'tool-call-request', streamId: request.streamId, threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1', tool: 'remember', arguments: { text: 'x' } })
    await harness.emit({ type: 'finish', streamId: request.streamId, threadId: 'thread-1', turnId: 'turn-1' })
    await stream

    expect(tool.execute).toHaveBeenCalledWith({ text: 'x' }, expect.any(Object))
    expect(harness.resolveToolCall).toHaveBeenCalledWith({ callId: 'call-1', result: { success: true, text: 'saved' } })
  })

  it('forwards the current runtime overrides with every turn', async () => {
    const harness = createHarness()
    const stream = harness.bridge.transport({
      providerId: 'codex-oauth',
      sessionId: 'session-1',
      model: 'codex-configured',
      messages: [{ role: 'user', content: 'Use my settings.' }],
      tools: [],
      options: {},
    })

    await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledOnce())
    const request = harness.startTurn.mock.calls[0][0]
    expect(request.overrides).toEqual({ model: 'gpt-x', effort: 'high' })
    await harness.emit({ type: 'finish', streamId: request.streamId, threadId: 'thread-1', turnId: 'turn-1' })
    await stream
  })

  it('sends cloneable tool schemas across the Electron IPC boundary', async () => {
    const harness = createHarness()
    harness.startTurn.mockImplementation(async (request) => {
      structuredClone(request)
      return { threadId: 'thread-1' }
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
      sessionId: 'session-1',
      model: 'codex-configured',
      messages: [{ role: 'user', content: 'Remember this.' }],
      tools: [tool],
      options: {},
    })

    await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledOnce())
    const request = harness.startTurn.mock.calls[0][0]
    await harness.emit({ type: 'finish', streamId: request.streamId, threadId: 'thread-1', turnId: 'turn-1' })

    await expect(stream).resolves.toBeUndefined()
  })
})
