// 직접 Codex Responses 스트림과 renderer 도구 결과의 연속 처리를 관리합니다.
import type { AssistantMessage, Message, Tool, ToolResultMessage, Usage } from '@earendil-works/pi-ai'

import type {
  CodexBridgeEvent,
  CodexConversationMessage,
  CodexJsonValue,
  CodexToolResult,
  CodexTurnRequest,
} from '../../../shared/eventa/codex'
import type { CodexDirectClient, CodexDirectEvent, CodexDirectRequest } from './direct-client'

import { errorMessageFrom } from '@moeru/std'

export type {
  CodexBridgeEvent,
  CodexDynamicToolDescriptor,
  CodexToolResult,
  CodexTurnRequest,
} from '../../../shared/eventa/codex'

export interface CodexTurnRuntimeDeps {
  client: CodexDirectClient
  now?: () => number
}

export interface CodexTurnRuntime {
  startTurn: (request: CodexTurnRequest, sink: (event: CodexBridgeEvent) => void) => Promise<void>
  interrupt: (streamId: string) => Promise<void>
  resolveToolCall: (callId: string, result: CodexToolResult) => void
}

interface ActiveStream {
  streamId: string
  abort: AbortController
  pendingCallIds: Set<string>
  sink: (event: CodexBridgeEvent) => void
}

interface PendingToolCall {
  callId: string
  owner: ActiveStream
  promise: Promise<CodexToolResult>
  resolve: (result: CodexToolResult) => void
  reject: (error: Error) => void
}

/** 한 stream 안에서 모델 도구 호출과 renderer 결과를 끝날 때까지 연결합니다. */
export function createCodexTurnRuntime(deps: CodexTurnRuntimeDeps): CodexTurnRuntime {
  const now = deps.now ?? Date.now
  const streams = new Map<string, ActiveStream>()
  const pendingToolCalls = new Map<string, PendingToolCall>()

  async function startTurn(
    request: CodexTurnRequest,
    sink: (event: CodexBridgeEvent) => void,
  ): Promise<void> {
    if (streams.has(request.streamId))
      throw new Error('Codex stream is already active.')

    const active: ActiveStream = {
      streamId: request.streamId,
      abort: new AbortController(),
      pendingCallIds: new Set(),
      sink,
    }
    const messages = conversationMessages(request.messages, request.overrides.model, now)
    streams.set(request.streamId, active)

    try {
      while (true) {
        const calls: PendingToolCall[] = []
        const directRequest = createDirectRequest(request, messages)
        const assistant = await deps.client.stream(directRequest, (event) => {
          handleDirectEvent(active, event, calls)
        }, active.abort.signal)
        messages.push(assistant)

        if (calls.length === 0) {
          sink({ type: 'finish', streamId: request.streamId })
          return
        }

        const results = await Promise.all(calls.map(call => call.promise))
        for (let index = 0; index < calls.length; index++) {
          const callId = calls[index]?.callId
          const result = results[index]
          if (callId === undefined || result === undefined)
            throw new Error('Codex tool result ordering failed.')
          messages.push(createToolResult(callId, result, assistant, now()))
        }
      }
    }
    catch (error) {
      if (active.abort.signal.aborted) {
        sink({ type: 'interrupted', streamId: request.streamId })
        return
      }
      const message = errorMessageFrom(error) ?? 'Codex turn failed.'
      sink({ type: 'error', streamId: request.streamId, message })
      throw new Error(message)
    }
    finally {
      cleanupStream(active)
    }
  }

  function handleDirectEvent(
    active: ActiveStream,
    event: CodexDirectEvent,
    calls: PendingToolCall[],
  ): void {
    if (event.type === 'text-delta') {
      active.sink({ type: 'text-delta', streamId: active.streamId, text: event.text })
      return
    }
    if (pendingToolCalls.has(event.callId))
      throw new Error('Codex returned a duplicate tool call ID.')

    let resolve!: (result: CodexToolResult) => void
    let reject!: (error: Error) => void
    const promise = new Promise<CodexToolResult>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    void promise.catch(() => undefined)
    const pending: PendingToolCall = { callId: event.callId, owner: active, promise, resolve, reject }
    pendingToolCalls.set(event.callId, pending)
    active.pendingCallIds.add(event.callId)
    calls.push(pending)
    active.sink({
      type: 'tool-call-request',
      streamId: active.streamId,
      callId: event.callId,
      tool: event.name,
      arguments: event.arguments,
    })
  }

  async function interrupt(streamId: string): Promise<void> {
    const active = streams.get(streamId)
    if (active === undefined)
      return
    active.abort.abort()
    rejectPending(active, new Error('Codex turn was interrupted.'))
  }

  function resolveToolCall(callId: string, result: CodexToolResult): void {
    const pending = pendingToolCalls.get(callId)
    if (pending === undefined)
      return
    pendingToolCalls.delete(callId)
    pending.owner.pendingCallIds.delete(callId)
    pending.resolve(result)
  }

  function cleanupStream(active: ActiveStream): void {
    streams.delete(active.streamId)
    rejectPending(active, new Error('Codex stream ended before the tool result arrived.'))
  }

  function rejectPending(active: ActiveStream, error: Error): void {
    for (const callId of active.pendingCallIds) {
      const pending = pendingToolCalls.get(callId)
      if (pending?.owner !== active)
        continue
      pendingToolCalls.delete(callId)
      pending.reject(error)
    }
  }

  return { startTurn, interrupt, resolveToolCall }
}

function createDirectRequest(request: CodexTurnRequest, messages: Message[]): CodexDirectRequest {
  return {
    model: request.overrides.model,
    effort: request.overrides.effort,
    serviceTier: request.overrides.serviceTier,
    sessionId: request.streamId,
    systemPrompt: request.developerInstructions,
    messages,
    tools: request.dynamicTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as Tool['parameters'],
    })),
  }
}

function conversationMessages(
  messages: CodexConversationMessage[],
  model: string | undefined,
  now: () => number,
): Message[] {
  const result: Message[] = []
  const toolNames = new Map<string, string>()
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer')
      continue
    if (message.role === 'user') {
      result.push({ role: 'user', content: contentText(message.content), timestamp: now() })
      continue
    }
    if (message.role === 'assistant') {
      const content: AssistantMessage['content'] = []
      const text = contentText(message.content)
      if (text.length > 0)
        content.push({ type: 'text', text })
      for (const call of message.toolCalls ?? []) {
        toolNames.set(call.id, call.name)
        content.push({ type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments })
      }
      result.push({
        role: 'assistant',
        content,
        api: 'openai-codex-responses',
        provider: 'openai-codex',
        model: model ?? 'gpt-5.4',
        usage: emptyUsage(),
        stopReason: message.toolCalls?.length ? 'toolUse' : 'stop',
        timestamp: now(),
      })
      continue
    }
    const callId = message.toolCallId
    const toolName = callId === undefined ? undefined : toolNames.get(callId)
    if (callId === undefined || toolName === undefined)
      continue
    result.push({
      role: 'toolResult',
      toolCallId: callId,
      toolName,
      content: [{ type: 'text', text: contentText(message.content) }],
      isError: false,
      timestamp: now(),
    })
  }
  return result
}

function contentText(content: CodexJsonValue | undefined): string {
  if (typeof content === 'string')
    return content
  if (Array.isArray(content)) {
    const text = content.flatMap((entry) => {
      if (typeof entry === 'object' && entry !== null && !Array.isArray(entry) && entry.type === 'text' && typeof entry.text === 'string')
        return [entry.text]
      return []
    }).join('\n')
    if (text.length > 0)
      return text
  }
  return content === undefined ? '' : JSON.stringify(content)
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function createToolResult(
  callId: string,
  result: CodexToolResult,
  assistant: Message,
  timestamp: number,
): ToolResultMessage {
  const content = assistant.role === 'assistant'
    ? assistant.content.find(item => item.type === 'toolCall' && item.id === callId)
    : undefined
  const toolName = content?.type === 'toolCall' ? content.name : undefined
  if (toolName === undefined)
    throw new Error('Codex tool call metadata is missing.')
  return {
    role: 'toolResult',
    toolCallId: callId,
    toolName,
    content: [{ type: 'text', text: result.text }],
    isError: !result.success,
    timestamp,
  }
}
