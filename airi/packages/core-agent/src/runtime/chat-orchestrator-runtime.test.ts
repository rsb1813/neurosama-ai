import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { Message } from '@xsai/shared-chat'

import type { ChatHistoryItem, ContextMessage, StreamingAssistantMessage } from '../types/chat'
import type { StreamEvent } from '../types/llm'

import { ContextUpdateStrategy } from '@proj-airi/server-shared/types'
import { describe, expect, it, vi } from 'vitest'

import { createChatOrchestratorRuntime } from './chat-orchestrator-runtime'

const provider = {
  chat: () => ({ baseURL: 'https://example.com/' }),
} as unknown as ChatProvider

function createHarness() {
  const sessionMessages: Record<string, ChatHistoryItem[]> = {
    'session-1': [
      {
        role: 'system',
        content: 'system prompt',
        createdAt: new Date(2026, 3, 25, 18, 0).getTime(),
        id: 'system',
      },
    ],
  }
  const contextSnapshot: Record<string, ContextMessage[]> = {}
  const foregroundPatches: StreamingAssistantMessage[] = []
  const foregroundResets: StreamingAssistantMessage[] = []
  const lifecycleRecords: unknown[] = []
  const promptProjections: unknown[] = []
  const userAppended: unknown[] = []
  const assistantAppended: unknown[] = []
  const userTurns: unknown[] = []
  const assistantTurns: unknown[] = []
  const stateChanges: unknown[] = []
  const telemetry = {
    chatActivationStarted: [] as unknown[],
    chatActivationSucceeded: [] as unknown[],
    chatActivationFailed: [] as unknown[],
    messageSendStarted: [] as unknown[],
    llmRequestStarted: [] as unknown[],
    llmFirstToken: [] as unknown[],
    assistantResponseRendered: [] as unknown[],
    messageRound: [] as unknown[],
  }
  const stream = vi.fn(async (_model: string, _chatProvider: ChatProvider, _messages: Message[], options?: {
    abortSignal?: AbortSignal
    onStreamEvent?: (event: StreamEvent) => Promise<void> | void
    providerId?: string
  }) => {
    await options?.onStreamEvent?.({ type: 'text-delta', text: 'assistant reply' })
    await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
  })
  const ids = ['stream-context', 'assistant-id', 'user-id', 'fallback-id']
  let systemPromptSupplement: string | undefined
  let nowValue = new Date(2026, 3, 25, 18, 47).getTime()
  let monotonicNowValues = [1000]
  let generation = 1

  const runtime = createChatOrchestratorRuntime({
    session: {
      ensureSession: (sessionId) => {
        sessionMessages[sessionId] ??= []
      },
      getSessionMessages: sessionId => sessionMessages[sessionId] ?? [],
      appendSessionMessage: (sessionId, message) => {
        sessionMessages[sessionId] ??= []
        sessionMessages[sessionId].push(message)
      },
      getSessionGeneration: () => generation,
    },
    context: {
      ingest: vi.fn(),
      snapshot: () => structuredClone(contextSnapshot),
    },
    foregroundStream: {
      patch: message => foregroundPatches.push(message),
      reset: () => foregroundResets.push({ role: 'assistant', content: '', slices: [], tool_results: [] }),
    },
    llm: {
      stream,
    },
    getActiveSessionId: () => 'session-1',
    getActiveProvider: () => 'mock-provider',
    getSystemPromptSupplement: () => systemPromptSupplement,
    now: () => nowValue,
    monotonicNow: () => monotonicNowValues.shift() ?? 1000,
    createId: () => ids.shift() ?? 'generated-id',
    onLifecycle: record => lifecycleRecords.push(record),
    onPromptProjection: payload => promptProjections.push(payload),
    onUserMessageAppended: event => userAppended.push(event),
    onAssistantMessageAppended: event => assistantAppended.push(event),
    onUserTurnReady: event => userTurns.push(event),
    onAssistantTurnReady: event => assistantTurns.push(event),
    onStateChange: state => stateChanges.push(state),
    onChatActivationStarted: event => telemetry.chatActivationStarted.push(event),
    onChatActivationSucceeded: event => telemetry.chatActivationSucceeded.push(event),
    onChatActivationFailed: event => telemetry.chatActivationFailed.push(event),
    onMessageSendStarted: event => telemetry.messageSendStarted.push(event),
    onLlmRequestStarted: event => telemetry.llmRequestStarted.push(event),
    onLlmFirstToken: event => telemetry.llmFirstToken.push(event),
    onAssistantResponseRendered: event => telemetry.assistantResponseRendered.push(event),
    onMessageRound: event => telemetry.messageRound.push(event),
  })

  return {
    assistantAppended,
    assistantTurns,
    contextSnapshot,
    foregroundPatches,
    foregroundResets,
    generation: {
      set: (next: number) => {
        generation = next
      },
    },
    lifecycleRecords,
    now: {
      set: (next: number) => {
        nowValue = next
      },
    },
    monotonicNow: {
      set: (next: number[]) => {
        monotonicNowValues = [...next]
      },
    },
    promptProjections,
    runtime,
    sessionMessages,
    stateChanges,
    stream,
    systemPromptSupplement: {
      set: (next: string | undefined) => {
        systemPromptSupplement = next
      },
    },
    telemetry,
    userAppended,
    userTurns,
  }
}

/**
 * @example
 * const runtime = createChatOrchestratorRuntime(deps)
 * await runtime.ingest('hello', { model, chatProvider })
 */
describe('createChatOrchestratorRuntime', () => {
  /**
   * @example
   * Hook order and prompt composition stay compatible with the stage-ui facade.
   */
  it('keeps hook order and appends context prompt to the latest user message', async () => {
    const harness = createHarness()
    harness.contextSnapshot['system:weather'] = [
      {
        id: 'weather',
        contextId: 'system:weather',
        strategy: ContextUpdateStrategy.ReplaceSelf,
        text: 'sunny',
        createdAt: 1,
      },
    ]
    const hookOrder: string[] = []
    let composedMessages: Message[] = []

    harness.runtime.hooks.onBeforeMessageComposed(async () => {
      hookOrder.push('before-compose')
    })
    harness.runtime.hooks.onAfterMessageComposed(async () => {
      hookOrder.push('after-compose')
    })
    harness.runtime.hooks.onBeforeSend(async () => {
      hookOrder.push('before-send')
    })
    harness.runtime.hooks.onTokenLiteral(async () => {
      hookOrder.push('token-literal')
    })
    harness.runtime.hooks.onStreamEnd(async () => {
      hookOrder.push('stream-end')
    })
    harness.runtime.hooks.onAssistantResponseEnd(async () => {
      hookOrder.push('assistant-end')
    })
    harness.runtime.hooks.onAfterSend(async () => {
      hookOrder.push('after-send')
    })
    harness.runtime.hooks.onAssistantMessage(async () => {
      hookOrder.push('assistant-message')
    })
    harness.runtime.hooks.onChatTurnComplete(async () => {
      hookOrder.push('turn-complete')
    })
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      composedMessages = messages
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'hello' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })

    await harness.runtime.ingest('hello from user', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(hookOrder).toEqual([
      'before-compose',
      'after-compose',
      'before-send',
      'token-literal',
      'stream-end',
      'assistant-end',
      'after-send',
      'assistant-message',
      'turn-complete',
    ])
    expect(composedMessages).toHaveLength(2)
    expect(composedMessages[0]).toMatchObject({ role: 'system', content: 'system prompt' })
    expect(composedMessages[1]).toMatchObject({ role: 'user' })
    expect(composedMessages[1]?.content).toEqual([
      {
        type: 'text',
        text: '[2026-04-25 18:47] hello from user',
      },
      {
        type: 'text',
        text: '\n[Context]\n- system:weather: sunny',
      },
    ])
    expect(harness.lifecycleRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'before-compose' }),
      expect.objectContaining({ phase: 'prompt-context-built' }),
      expect.objectContaining({ phase: 'after-compose' }),
    ]))
    expect(harness.promptProjections).toHaveLength(1)
  })

  /**
   * @example
   * deps.getSystemPromptSupplement() returns tool guidance.
   * The runtime appends it to the existing provider system message.
   */
  it('appends system prompt supplement to the provider system message', async () => {
    const harness = createHarness()
    let composedMessages: Message[] = []
    harness.systemPromptSupplement.set('Plugin toolset guidance.')
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      composedMessages = messages
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'hello' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })

    await harness.runtime.ingest('hello from user', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(composedMessages[0]).toMatchObject({
      role: 'system',
      content: 'system prompt\n\nPlugin toolset guidance.',
    })
  })

  /**
   * @example
   * A session has only user history.
   * The runtime creates a provider system message for supplemental guidance.
   */
  it('creates a system message when only a system prompt supplement is available', async () => {
    const harness = createHarness()
    let composedMessages: Message[] = []
    harness.sessionMessages['session-1'] = []
    harness.systemPromptSupplement.set('Plugin toolset guidance.')
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      composedMessages = messages
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'hello' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })

    await harness.runtime.ingest('hello from user', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(composedMessages[0]).toMatchObject({
      role: 'system',
      content: 'Plugin toolset guidance.',
    })
    expect(composedMessages[1]).toMatchObject({ role: 'user' })
  })

  /**
   * @example
   * Runtime telemetry callbacks expose client-visible latency milestones.
   */
  it('emits telemetry milestones for a successful voice-backed message round', async () => {
    const harness = createHarness()
    harness.monotonicNow.set([100, 150, 250, 400, 460])

    await harness.runtime.ingest('hello from voice', {
      model: 'gpt-test',
      chatProvider: provider,
      input: {
        type: 'input:text',
        data: {
          text: 'hello from voice',
        },
      },
    })

    expect(harness.telemetry.messageSendStarted).toEqual([{
      source: 'voice',
      model: 'gpt-test',
    }])
    expect(harness.telemetry.llmRequestStarted).toEqual([{
      model: 'gpt-test',
      provider: 'mock-provider',
      hasVoice: true,
    }])
    expect(harness.telemetry.llmFirstToken).toEqual([{
      model: 'gpt-test',
      ttfbMs: 100,
    }])
    expect(harness.telemetry.assistantResponseRendered).toEqual([{
      model: 'gpt-test',
      latencyMs: 250,
    }])
    expect(harness.telemetry.messageRound).toEqual([{
      durationMs: 360,
      hasVoice: true,
      model: 'gpt-test',
    }])
    expect(harness.telemetry.chatActivationStarted).toEqual([{
      model: 'gpt-test',
      provider: 'mock-provider',
      sessionId: 'session-1',
      source: 'voice',
    }])
    expect(harness.telemetry.chatActivationSucceeded).toEqual([{
      durationMs: 360,
      model: 'gpt-test',
      provider: 'mock-provider',
      source: 'voice',
    }])
    expect(harness.telemetry.chatActivationFailed).toEqual([])
  })

  /**
   * @example
   * await expect(runtime.ingest('hello', { model, chatProvider })).rejects.toThrow('provider rejected')
   */
  it('emits chat activation failure telemetry without raw provider messages', async () => {
    const harness = createHarness()
    harness.stream.mockRejectedValueOnce(new Error('provider rejected with sensitive details'))

    await expect(harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('provider rejected')

    expect(harness.telemetry.chatActivationStarted).toEqual([{
      model: 'gpt-test',
      provider: 'mock-provider',
      sessionId: 'session-1',
      source: 'text',
    }])
    expect(harness.telemetry.chatActivationSucceeded).toEqual([])
    expect(harness.telemetry.chatActivationFailed).toEqual([{
      errorCode: 'llm_response_failed',
      failureStage: 'llm_response',
      model: 'gpt-test',
      provider: 'mock-provider',
      source: 'text',
    }])
  })

  /**
   * @example
   * Cancelling a queued send rejects only pending work that has not started.
   */
  it('rejects cancelled queued sends before they start', async () => {
    const harness = createHarness()
    let releaseFirstSend: (() => void) | undefined
    harness.stream.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstSend = resolve
      })
    })

    const firstSend = harness.runtime.ingest('hold queue', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    const secondSend = harness.runtime.ingest('cancel me', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    await vi.waitFor(() => {
      expect(harness.stream).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(harness.runtime.getPendingQueuedSendCount()).toBe(1)
    })
    harness.runtime.cancelPendingSends('session-1')
    releaseFirstSend?.()

    await expect(secondSend).rejects.toThrow('Chat session was reset before send could start')
    await firstSend
  })

  /**
   * @example
   * A queued send rejects if its captured session generation becomes stale.
   */
  it('rejects stale generation sends before they start', async () => {
    const harness = createHarness()
    let releaseFirstSend: (() => void) | undefined
    harness.stream.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstSend = resolve
      })
    })

    const firstSend = harness.runtime.ingest('hold queue', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    const secondSend = harness.runtime.ingest('stale request', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    await vi.waitFor(() => {
      expect(harness.stream).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(harness.runtime.getPendingQueuedSendCount()).toBe(1)
    })
    harness.generation.set(2)
    releaseFirstSend?.()

    await firstSend
    await expect(secondSend).rejects.toThrow('Chat session was reset before send could start')
    expect(harness.stream).toHaveBeenCalledTimes(1)
  })

  /**
   * @example
   * runtime.setSending(true)
   * expect(runtime.getSending()).toBe(true)
   */
  it('keeps sending externally writable for UI facades', () => {
    const harness = createHarness()

    harness.runtime.setSending(true)
    expect(harness.runtime.getSending()).toBe(true)
    expect(harness.stateChanges.at(-1)).toEqual({
      sending: true,
      pendingQueuedSendCount: 0,
    })

    harness.runtime.setSending(false)
    expect(harness.runtime.getSending()).toBe(false)
    expect(harness.stateChanges.at(-1)).toEqual({
      sending: false,
      pendingQueuedSendCount: 0,
    })
  })

  /**
   * @example
   * const snapshot = runtime.getPendingQueuedSendSnapshot()
   * expect(snapshot[0].inputType).toBe('input:text')
   */
  it('returns pending queued send snapshots with public fields', async () => {
    const harness = createHarness()
    let releaseFirstSend: (() => void) | undefined
    harness.stream.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstSend = resolve
      })
    })

    const queuedMessage = 'queued-message-'.repeat(12)
    const firstSend = harness.runtime.ingest('hold queue', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    const secondSend = harness.runtime.ingest(queuedMessage, {
      model: 'gpt-test',
      chatProvider: provider,
      attachments: [
        {
          type: 'image',
          data: 'aW1hZ2U=',
          mimeType: 'image/png',
        },
      ],
      input: {
        type: 'input:text',
        data: {
          text: 'queued input',
        },
      },
    })

    await vi.waitFor(() => {
      expect(harness.stream).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(harness.runtime.getPendingQueuedSendCount()).toBe(1)
    })

    expect(harness.runtime.getPendingQueuedSendSnapshot()).toEqual([
      {
        sessionId: 'session-1',
        generation: 1,
        cancelled: false,
        messagePreview: queuedMessage.slice(0, 120),
        hasAttachments: true,
        inputType: 'input:text',
      },
    ])

    harness.runtime.cancelPendingSends('session-1')
    releaseFirstSend?.()

    await expect(secondSend).rejects.toThrow('Chat session was reset before send could start')
    await firstSend
  })

  /**
   * @example
   * Attachments, reasoning deltas, and tool events update the assistant builder.
   */
  it('handles attachments, reasoning deltas, tool events, and assistant finalization', async () => {
    const harness = createHarness()
    let composedMessages: Message[] = []
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      composedMessages = messages
      await options?.onStreamEvent?.({ type: 'reasoning-delta', text: 'thinking' })
      await options?.onStreamEvent?.({
        type: 'tool-call',
        toolCallId: 'tool-1',
        toolName: 'weather',
        args: {},
      } as StreamEvent)
      await options?.onStreamEvent?.({
        type: 'tool-result',
        toolCallId: 'tool-1',
        result: 'sunny',
      } as StreamEvent)
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'visible reply' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })

    await harness.runtime.ingest('see image', {
      model: 'gpt-test',
      chatProvider: provider,
      attachments: [
        {
          type: 'image',
          data: 'aW1hZ2U=',
          mimeType: 'image/png',
        },
      ],
    })

    expect(composedMessages[1]?.content).toEqual([
      {
        type: 'text',
        text: '[2026-04-25 18:47] see image',
      },
      {
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,aW1hZ2U=',
        },
      },
    ])
    // "visible reply" carries no <ko> tag, so per the English-to-TTS-only routing
    // it never lands in buildingMessage.content/slices (display stays Korean-only).
    const assistant = harness.sessionMessages['session-1']?.at(-1)
    expect(assistant).toMatchObject({
      role: 'assistant',
      content: '',
      categorization: {
        reasoning: 'thinking',
      },
    })
    expect((assistant as StreamingAssistantMessage).slices).toEqual([
      expect.objectContaining({
        type: 'tool-call',
        toolCall: expect.objectContaining({
          toolCallId: 'tool-1',
        }),
      }),
    ])
    expect((assistant as StreamingAssistantMessage).tool_results).toEqual([
      {
        type: 'tool-call-result',
        id: 'tool-1',
        result: 'sunny',
      },
    ])
    expect(harness.assistantAppended).toHaveLength(1)
    expect(harness.foregroundResets).toHaveLength(1)
  })

  /**
   * @example
   * A streamed reply mixes English speech with a `<ko>` subtitle tag.
   * English goes to TTS only; Korean fills the chat panel and subtitle hook.
   */
  it('routes English to TTS only and Korean subtitle content to the display', async () => {
    const harness = createHarness()
    const literalHookCalls: string[] = []
    const subtitleHookCalls: string[] = []
    harness.runtime.hooks.onTokenLiteral(async (literal) => {
      literalHookCalls.push(literal)
    })
    harness.runtime.hooks.onSubtitle(async (koText) => {
      subtitleHookCalls.push(koText)
    })
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'Hello. <ko>안녕.</ko>' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })

    await harness.runtime.ingest('hi', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(literalHookCalls.join('')).toContain('Hello')
    expect(literalHookCalls.join('')).not.toContain('안녕')
    expect(subtitleHookCalls).toEqual(['안녕.'])

    const assistant = harness.sessionMessages['session-1']?.at(-1) as StreamingAssistantMessage
    expect(assistant.content).toContain('안녕.')
    expect(assistant.content).not.toContain('Hello')
  })

  /**
   * @example
   * A two-sentence bilingual reply streams across deltas, so the marker parser
   * (24-char emit threshold, 5-char holdback) emits a literal ending on the '<'
   * of the first `</ko>`. Regression guard for the chunk-boundary categorizer
   * desync that silently dropped every Korean subtitle and the later English,
   * and left `slices` empty so the turn was never persisted.
   * See response-categoriser.test.ts ROOT CAUSE.
   */
  it('routes both sentences of a multi-delta bilingual reply and persists the turn', async () => {
    const harness = createHarness()
    const literalHookCalls: string[] = []
    const subtitleHookCalls: string[] = []
    harness.runtime.hooks.onTokenLiteral(async (literal) => {
      literalHookCalls.push(literal)
    })
    harness.runtime.hooks.onSubtitle(async (koText) => {
      subtitleHookCalls.push(koText)
    })
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'Hello everyone welcome back to the stream!! <ko>안녕 여러분 스트림 복귀 환영!</ko> ' })
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'How is your day going so far today? <ko>오늘 하루 어때?</ko>' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })

    await harness.runtime.ingest('hi', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    // Both English sentences reach TTS; no Korean or tag fragments leak into speech.
    const spokenEnglish = literalHookCalls.join('')
    expect(spokenEnglish).toContain('welcome back to the stream')
    expect(spokenEnglish).toContain('How is your day going so far today')
    expect(spokenEnglish).not.toContain('안녕')
    expect(spokenEnglish).not.toContain('<ko>')

    // Both Korean subtitles land, in order.
    expect(subtitleHookCalls).toEqual(['안녕 여러분 스트림 복귀 환영!', '오늘 하루 어때?'])

    // The turn persists: Korean fills content/slices (empty slices → persistence guard skips saving).
    const assistant = harness.sessionMessages['session-1']?.at(-1) as StreamingAssistantMessage
    expect(assistant.content).toContain('안녕 여러분 스트림 복귀 환영!')
    expect(assistant.content).toContain('오늘 하루 어때?')
    expect(assistant.slices.length).toBeGreaterThan(0)
  })

  /**
   * @example
   * Barge-in relies on the runtime forwarding an AbortSignal to the LLM stream call.
   */
  it('passes an AbortSignal to the LLM stream', async () => {
    const harness = createHarness()
    let capturedSignal: AbortSignal | undefined
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      capturedSignal = options?.abortSignal
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'hi' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })

    await harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(capturedSignal).toBeInstanceOf(AbortSignal)
  })

  it('preserves an explicitly selected provider for the LLM stream', async () => {
    const harness = createHarness()
    let capturedProviderId: string | undefined
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      capturedProviderId = options?.providerId
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })

    await harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
      providerId: 'codex-oauth',
    })

    expect(capturedProviderId).toBe('codex-oauth')
  })

  /**
   * @example
   * runtime.abortActiveStream() aborts the signal handed to the in-flight LLM stream call.
   */
  it('abortActiveStream() aborts the in-flight stream', async () => {
    const harness = createHarness()
    let capturedSignal: AbortSignal | undefined
    let releaseStream: () => void = () => {}
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve
    })
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      capturedSignal = options?.abortSignal
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'partial' })
      await streamGate // hang mid-stream until the test releases it
    })

    const sendPromise = harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    await vi.waitFor(() => expect(capturedSignal).toBeInstanceOf(AbortSignal))
    harness.runtime.abortActiveStream()
    expect(capturedSignal!.aborted).toBe(true)
    releaseStream()
    await sendPromise.catch(() => {}) // may reject with AbortError; Task 2 makes it graceful
  })

  /**
   * @example
   * A barge-in abort should not be treated as a failure: the reply streamed so
   * far is kept in history, and no failure telemetry fires.
   *
   * NOTICE:
   * The brief's placeholder text ('half a sentence') has no `<ko>` tag, so it
   * would never reach `buildingMessage.content`/`slices` — only closed `<ko>`
   * segments do (see response-categoriser.ts mapTagNameToCategory + the
   * onSegment wiring at chat-orchestrator-runtime.ts ~527-537, and the existing
   * regression tests around line 582-591 showing untagged text persists as
   * content: ''). Using a closed `<ko>` segment here exercises the same
   * `slices.length > 0` persistence guard the normal finalize path uses,
   * while preserving the brief's fixed assertion intent (partial persisted,
   * no failure event).
   *
   * The delta also pads past the marker-parser's 24-char emit threshold
   * (llm-marker-parser.ts minLiteralEmitLength, chat-orchestrator-runtime.ts
   * STREAMING_UI_FLUSH_CHUNK_SIZE): `onLiteral` (and thus the categorizer)
   * only fires once buffered text crosses that threshold, since `parser.end()`
   * — which would flush a short remainder — never runs on this abort path.
   */
  it('keeps the partial reply and does not fail when barge-in aborts the stream', async () => {
    const harness = createHarness()
    let releaseStream: () => void = () => {}
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve
    })
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: '<ko>half a sentence</ko> more padding text here' })
      await streamGate
      // @xsai's fetch wrapper throws this shape when the AbortSignal fires mid-stream.
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    })

    const sendPromise = harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    await vi.waitFor(() => expect(harness.runtime.getSending()).toBe(true))
    harness.runtime.abortActiveStream()
    releaseStream()
    await sendPromise

    // The partial assistant message is persisted to session history.
    const assistant = harness.sessionMessages['session-1']?.at(-1) as StreamingAssistantMessage
    expect(assistant.role).toBe('assistant')
    expect(assistant.content).toContain('half a sentence')
    expect(harness.assistantAppended).toHaveLength(1)

    // And no failure was reported.
    expect(harness.telemetry.chatActivationFailed).toHaveLength(0)
  })

  /**
   * @example
   * The stream resolves normally, then a barge-in flips `signal.aborted` to
   * true while a post-stream success-path hook is still running. A throw from
   * that hook must NOT be misclassified as the barge-in itself.
   *
   * ROOT CAUSE:
   *
   * The catch branch used to discriminate "was this a barge-in?" via the
   * sticky `activeAbortController?.signal.aborted` flag instead of the caught
   * error's identity. That flag stays true for the rest of the send once
   * `abortActiveStream()` fires, so it answers "was abort ever pressed during
   * this send?" — not "is THIS caught error the abort?".
   *
   * If the LLM stream already resolved (success-path append at line ~763
   * already ran once) and the user barges in while the reply's last TTS
   * sentence is still playing, `signal.aborted` flips to true before the
   * post-stream hooks (onStreamEnd / onAssistantResponseEnd / ...) finish.
   * A plain (non-abort) throw from one of those hooks then landed in the old
   * catch, which saw `signal.aborted === true` and treated it as a barge-in:
   * it appended `buildingMessage` a SECOND time (session-store has no
   * id-based dedup) and swallowed the real error (no `onChatActivationFailed`,
   * no rethrow).
   *
   * We fixed this by discriminating on the caught error's identity
   * (`isAbortError`, mirroring llm-service.ts's file-local helper) instead of
   * the sticky flag. A genuine barge-in still rejects the in-flight stream
   * with an AbortError, so that path is unaffected; a hook throw after a
   * successfully-resolved stream is no longer misclassified.
   */
  it('does not double-append or swallow a post-stream hook error when a barge-in flips signal.aborted after the stream resolves', async () => {
    const harness = createHarness()
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: '<ko>closed reply</ko> padding text past the flush threshold' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
      // The stream resolves normally (no throw) — this simulates the user
      // barging in while the already-finished reply's tail TTS sentence is
      // still playing: abort() fires, but it's too late to reject the stream.
      harness.runtime.abortActiveStream()
    })
    harness.runtime.hooks.onStreamEnd(async () => {
      throw new Error('hook boom')
    })

    await expect(harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('hook boom')

    // The partial was appended exactly once by the success path (line ~763);
    // the catch branch must not have appended it again as a barge-in.
    expect(harness.assistantAppended).toHaveLength(1)

    // The hook failure was reported as a real failure, not swallowed.
    expect(harness.telemetry.chatActivationFailed).toHaveLength(1)
  })

  /**
   * @example
   * 능동 발화(proactive nudge): seedRole:'system'으로 ingest하면 사용자 발화가 아니라
   * '조용히 말 걸어' 씨앗 메시지로 취급되어 렌더/동기화에서 자동 제외되고
   * user-turn 훅/분석을 타지 않는다. 씨앗은 이번 턴의 LLM 요청에만 실려가고 세션
   * 이력에는 영속되지 않는다 — 영속하면 이후 모든 정상 턴에 재전송돼 페르소나
   * 오염/프록시 에러를 일으킨다(아래 no-pollution 회귀 테스트가 그 케이스를 검증한다).
   */
  it('seedRole:"system" reaches the LLM this turn but is not persisted to session history', async () => {
    const harness = createHarness()

    await harness.runtime.ingest('(proactive nudge)', {
      model: 'gpt-test',
      chatProvider: provider,
      seedRole: 'system',
    })

    // 영속 이력(getSessionMessages가 읽는 것과 동일한 소스)에는 씨앗이 없어야 한다.
    const persistedSeed = harness.sessionMessages['session-1']?.find(message => message.content === '(proactive nudge)')
    expect(persistedSeed).toBeUndefined()

    // 그래도 이번 턴에 LLM(stream)으로 전송된 메시지 배열에는 씨앗이 실려 있어야 한다.
    const sentMessages = harness.stream.mock.calls[0]?.[2] as Message[]
    expect(sentMessages.some(message => message.role === 'system' && message.content === '(proactive nudge)')).toBe(true)

    expect(harness.userAppended).toHaveLength(0)
    expect(harness.userTurns).toHaveLength(0)
  })

  /**
   * @example
   * 회귀 테스트: system 씨앗 턴 바로 다음에 정상 user 턴을 보내면, 두 번째 턴이
   * LLM으로 보내는 메시지 배열에는 첫 턴의 넛지 텍스트가 섞여 있으면 안 된다.
   * 씨앗이 영속됐다면(수정 전 버그) getSessionMessages가 이를 포함해 반환하므로
   * 이 테스트는 수정 전에는 실패하고 수정 후에는 통과한다.
   */
  it('does not leak the system seed into a later normal user turn', async () => {
    const harness = createHarness()

    await harness.runtime.ingest('(proactive nudge)', {
      model: 'gpt-test',
      chatProvider: provider,
      seedRole: 'system',
    })

    await harness.runtime.ingest('hello again', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    const secondTurnMessages = harness.stream.mock.calls[1]?.[2] as Message[]
    expect(secondTurnMessages.some(message =>
      typeof message.content === 'string' && message.content.includes('(proactive nudge)'),
    )).toBe(false)
  })

  /**
   * @example
   * seedRole을 생략하면 기존 사용자 발화 동작(role:'user' + user-turn 훅 호출)이 그대로 유지된다.
   */
  it('default seedRole keeps user-turn behavior', async () => {
    const harness = createHarness()

    await harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    const seed = harness.sessionMessages['session-1']?.find(message => message.content === 'hello')
    expect(seed?.role).toBe('user')
    expect(harness.userAppended).toHaveLength(1)
  })
})
