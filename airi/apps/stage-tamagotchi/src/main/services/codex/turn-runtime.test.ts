// 직접 Codex Responses의 텍스트, 도구 결과 연속 처리, 취소를 검증합니다.
import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai'

import type { CodexBridgeEvent, CodexTurnRequest } from '../../../shared/eventa/codex'
import type { CodexDirectClient, CodexDirectEvent, CodexDirectRequest } from './direct-client'

import { describe, expect, it, vi } from 'vitest'

import { createCodexTurnRuntime } from './turn-runtime'

describe('createCodexTurnRuntime', () => {
  it('continues the same logical turn after a renderer tool result', async () => {
    const harness = createHarness([
      [
        { type: 'tool-call', callId: 'call-1', name: 'remember', arguments: { text: 'fact' } },
      ],
      [
        { type: 'text-delta', text: 'Done.' },
      ],
    ])
    const events: CodexBridgeEvent[] = []
    const runtime = createCodexTurnRuntime({ client: harness.client })

    const running = runtime.startTurn(request(), event => events.push(event))
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
      type: 'tool-call-request',
      callId: 'call-1',
      tool: 'remember',
    })))
    runtime.resolveToolCall('call-1', { success: true, text: 'saved' })
    await running

    expect(events).toContainEqual(expect.objectContaining({ type: 'text-delta', text: 'Done.' }))
    expect(events.at(-1)).toMatchObject({ type: 'finish' })
    expect(harness.requests).toHaveLength(2)
    expect(harness.requests[1].messages.at(-1)).toMatchObject({
      role: 'toolResult',
      toolCallId: 'call-1',
      content: [{ type: 'text', text: 'saved' }],
      isError: false,
    } satisfies Partial<ToolResultMessage>)
  })

  it('reports an ordinary abort as interrupted instead of an error', async () => {
    const client = createBaseClient()
    client.stream = vi.fn(async (_request, _sink, signal) => new Promise<AssistantMessage>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const events: CodexBridgeEvent[] = []
    const runtime = createCodexTurnRuntime({ client })

    const running = runtime.startTurn(request(), event => events.push(event))
    await runtime.interrupt('stream-1')
    await running

    expect(events.at(-1)).toMatchObject({ type: 'interrupted' })
    expect(events.some(event => event.type === 'error')).toBe(false)
  })
})

function createHarness(eventBatches: CodexDirectEvent[][]) {
  const requests: CodexDirectRequest[] = []
  const client = createBaseClient()
  client.stream = vi.fn(async (nextRequest, sink) => {
    requests.push(structuredClone(nextRequest))
    const events = eventBatches[requests.length - 1] ?? []
    for (const event of events)
      sink(event)
    return assistant(events)
  })
  return { client, requests }
}

function createBaseClient(): CodexDirectClient {
  return {
    loginDevice: vi.fn(),
    readAccount: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    listModels: vi.fn(),
    stream: vi.fn(),
  }
}

function assistant(events: CodexDirectEvent[]): AssistantMessage {
  const content: AssistantMessage['content'] = []
  for (const event of events) {
    if (event.type === 'text-delta')
      content.push({ type: 'text', text: event.text })
    else if (event.type === 'tool-call')
      content.push({ type: 'toolCall', id: event.callId, name: event.name, arguments: event.arguments })
  }
  return {
    role: 'assistant',
    content,
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    model: 'gpt-5.4',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: events.some(event => event.type === 'tool-call') ? 'toolUse' : 'stop',
    timestamp: Date.now(),
  }
}

function request(): CodexTurnRequest {
  return {
    streamId: 'stream-1',
    overrides: { model: 'gpt-5.4', effort: 'medium' },
    developerInstructions: 'Stay in character.',
    dynamicTools: [{
      type: 'function',
      name: 'remember',
      description: 'Remember a fact',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    }],
    userInput: 'Remember this.',
  }
}
