// Codex Electron 이벤트를 AIRI 스트림과 도구 실행으로 변환하는 브리지를 검증한다.
import type { LlmTransportRequest } from '@proj-airi/stage-ui/stores/llm-transports'
import type { Tool } from '@xsai/shared-chat'

import type { CodexBridgeEvent, CodexRuntimeOverrides, CodexTurnRequest } from '../../shared/eventa/codex'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { initializeCodexBridge } from './codex'

function createHarness(runtimeOverrides: CodexRuntimeOverrides = { model: 'gpt-x', effort: 'high' }) {
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
    getRuntimeOverrides: () => runtimeOverrides,
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
    expect(JSON.parse(localStorage.getItem('neru/codex/thread-ids')!)).toEqual({
      'session-1': {
        threadId: 'thread-1',
        signature: expect.stringMatching(/^v1:[a-f0-9]{64}$/),
      },
    })
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

  it('uses the composed AIRI system message as developer instructions', async () => {
    const harness = createHarness()
    const stream = harness.bridge.transport({
      providerId: 'codex-oauth',
      sessionId: 'session-1',
      model: 'codex-configured',
      messages: [
        { role: 'system', content: 'You are the currently selected AIRI character.' },
        { role: 'user', content: 'Stay in character.' },
      ],
      tools: [],
      options: {},
    })

    await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledOnce())
    const request = harness.startTurn.mock.calls[0][0]
    expect(request.developerInstructions).toBe('You are the currently selected AIRI character.')
    await harness.emit({ type: 'finish', streamId: request.streamId, threadId: 'thread-1', turnId: 'turn-1' })
    await stream
  })

  it('resumes the same thread when the character prompt and model are unchanged', async () => {
    const harness = createHarness()
    const request = {
      providerId: 'codex-oauth',
      sessionId: 'session-1',
      model: 'codex-configured',
      messages: [
        { role: 'system', content: 'You are Neru.' },
        { role: 'user', content: 'Hello.' },
      ],
      tools: [],
      options: {},
    } satisfies LlmTransportRequest

    const firstStream = harness.bridge.transport(request)
    await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledTimes(1))
    const firstTurn = harness.startTurn.mock.calls[0][0]
    await harness.emit({ type: 'finish', streamId: firstTurn.streamId, threadId: 'thread-1', turnId: 'turn-1' })
    await firstStream

    const secondStream = harness.bridge.transport(request)
    await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledTimes(2))
    const secondTurn = harness.startTurn.mock.calls[1][0]
    expect(secondTurn.threadId).toBe('thread-1')
    await harness.emit({ type: 'finish', streamId: secondTurn.streamId, threadId: 'thread-1', turnId: 'turn-2' })
    await secondStream
  })

  it('starts a new thread when the character prompt changes', async () => {
    const harness = createHarness()
    const firstStream = harness.bridge.transport({
      providerId: 'codex-oauth',
      sessionId: 'session-1',
      model: 'codex-configured',
      messages: [{ role: 'system', content: 'You are Neru.' }, { role: 'user', content: 'Hello.' }],
      tools: [],
      options: {},
    })
    await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledTimes(1))
    const firstTurn = harness.startTurn.mock.calls[0][0]
    await harness.emit({ type: 'finish', streamId: firstTurn.streamId, threadId: 'thread-1', turnId: 'turn-1' })
    await firstStream

    const secondStream = harness.bridge.transport({
      providerId: 'codex-oauth',
      sessionId: 'session-1',
      model: 'codex-configured',
      messages: [{ role: 'system', content: 'You are a different character.' }, { role: 'user', content: 'Hello again.' }],
      tools: [],
      options: {},
    })
    await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledTimes(2))
    const secondTurn = harness.startTurn.mock.calls[1][0]
    expect(secondTurn.threadId).toBeUndefined()
    await harness.emit({ type: 'finish', streamId: secondTurn.streamId, threadId: 'thread-2', turnId: 'turn-2' })
    await secondStream
  })

  it('starts a new thread when the model override changes', async () => {
    const overrides: CodexRuntimeOverrides = { model: 'gpt-x', effort: 'high' }
    const harness = createHarness(overrides)
    const request = {
      providerId: 'codex-oauth',
      sessionId: 'session-1',
      model: 'codex-configured',
      messages: [{ role: 'system', content: 'You are Neru.' }, { role: 'user', content: 'Hello.' }],
      tools: [],
      options: {},
    } satisfies LlmTransportRequest

    const firstStream = harness.bridge.transport(request)
    await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledTimes(1))
    const firstTurn = harness.startTurn.mock.calls[0][0]
    await harness.emit({ type: 'finish', streamId: firstTurn.streamId, threadId: 'thread-1', turnId: 'turn-1' })
    await firstStream

    overrides.model = 'gpt-y'
    const secondStream = harness.bridge.transport(request)
    await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledTimes(2))
    const secondTurn = harness.startTurn.mock.calls[1][0]
    expect(secondTurn.threadId).toBeUndefined()
    await harness.emit({ type: 'finish', streamId: secondTurn.streamId, threadId: 'thread-2', turnId: 'turn-2' })
    await secondStream
  })

  it('does not resume an unsigned legacy thread and migrates it after success', async () => {
    localStorage.setItem('neru/codex/thread-ids', JSON.stringify({ 'session-1': 'legacy-thread' }))
    const harness = createHarness()
    harness.startTurn.mockResolvedValue({ threadId: 'thread-2' })
    const stream = harness.bridge.transport({
      providerId: 'codex-oauth',
      sessionId: 'session-1',
      model: 'codex-configured',
      messages: [{ role: 'system', content: 'You are Neru.' }, { role: 'user', content: 'Hello.' }],
      tools: [],
      options: {},
    })

    await vi.waitFor(() => expect(harness.startTurn).toHaveBeenCalledOnce())
    const request = harness.startTurn.mock.calls[0][0]
    expect(request.threadId).toBeUndefined()
    await harness.emit({ type: 'finish', streamId: request.streamId, threadId: 'thread-2', turnId: 'turn-1' })
    await stream

    expect(JSON.parse(localStorage.getItem('neru/codex/thread-ids')!)).toEqual({
      'session-1': {
        threadId: 'thread-2',
        signature: expect.stringMatching(/^v1:[a-f0-9]{64}$/),
      },
    })
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
