// Codex Electron 이벤트를 AIRI 스트림과 로컬 도구 실행으로 연결한다.
import type { LlmTransport, LlmTransportRequest } from '@proj-airi/stage-ui/stores/llm-transports'
import type { Message, Tool } from '@xsai/shared-chat'

import type {
  CodexBridgeEvent,
  CodexConversationMessage,
  CodexDynamicToolDescriptor,
  CodexJsonObject,
  CodexJsonValue,
  CodexRuntimeOverrides,
  CodexToolCallResolution,
  CodexTurnRequest,
} from '../../shared/eventa/codex'

import { errorMessageFrom } from '@moeru/std'
import { registerLlmTransport } from '@proj-airi/stage-ui/stores/llm-transports'

export interface CodexBridgeDeps {
  startTurn: (request: CodexTurnRequest) => Promise<void>
  interruptTurn: (payload: { streamId: string }) => Promise<void>
  resolveToolCall: (payload: CodexToolCallResolution) => Promise<void>
  onEvent: (handler: (event: CodexBridgeEvent) => void | Promise<void>) => () => void
  getRuntimeOverrides: () => CodexRuntimeOverrides
  developerInstructions: string
}

function developerInstructions(messages: Message[], fallback: string): string {
  const systemMessage = messages.find(message => message.role === 'system')
  return systemMessage && typeof systemMessage.content === 'string' && systemMessage.content.trim()
    ? systemMessage.content
    : fallback
}

function jsonObject(value: unknown): CodexJsonObject {
  const parsed = jsonValue(value)
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
}

function dynamicTools(tools: Tool[]): CodexDynamicToolDescriptor[] {
  return tools.map(tool => ({
    type: 'function' as const,
    name: tool.function.name,
    description: tool.function.description ?? '',
    inputSchema: jsonObject(tool.function.parameters),
  }))
}

function jsonMessages(messages: Message[]): CodexConversationMessage[] {
  return messages.flatMap<CodexConversationMessage>((message): CodexConversationMessage[] => {
    const content = jsonValue(message.content)
    if (message.role === 'assistant') {
      return [{
        role: message.role,
        content,
        toolCalls: message.tool_calls?.flatMap((call) => {
          if (typeof call.id !== 'string' || typeof call.function?.name !== 'string')
            return []
          return [{
            id: call.id,
            name: call.function.name,
            arguments: parseArguments(call.function.arguments),
          }]
        }),
      }]
    }
    if (message.role === 'tool')
      return [{ role: message.role, content, toolCallId: message.tool_call_id }]
    return [{ role: message.role, content }]
  })
}

function jsonValue(value: unknown): CodexJsonValue | undefined {
  try {
    if (value === undefined)
      return undefined
    const parsed: unknown = JSON.parse(JSON.stringify(value))
    return readJsonValue(parsed)
  }
  catch {
    return undefined
  }
}

function readJsonValue(value: unknown): CodexJsonValue | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string')
    return value
  if (Array.isArray(value)) {
    const entries = value.map(readJsonValue)
    return entries.every(entry => entry !== undefined) ? entries as CodexJsonValue[] : undefined
  }
  if (typeof value !== 'object')
    return undefined
  const result: CodexJsonObject = {}
  for (const [key, entry] of Object.entries(value)) {
    const jsonEntry = readJsonValue(entry)
    if (jsonEntry === undefined)
      return undefined
    result[key] = jsonEntry
  }
  return result
}

function parseArguments(value: string | undefined): CodexJsonObject {
  if (value === undefined)
    return {}
  try {
    return jsonObject(JSON.parse(value))
  }
  catch {
    return {}
  }
}

function toolResultText(result: unknown): string {
  if (typeof result === 'string')
    return result

  try {
    return JSON.stringify(result)
  }
  catch {
    return String(result)
  }
}

async function executeToolCall(event: Extract<CodexBridgeEvent, { type: 'tool-call-request' }>, tools: Map<string, Tool>, resolveToolCall: CodexBridgeDeps['resolveToolCall']) {
  const tool = tools.get(event.tool)
  if (!tool) {
    await resolveToolCall({ callId: event.callId, result: { success: false, text: `Unknown AIRI tool: ${event.tool}` } })
    return
  }

  if (event.arguments === null || typeof event.arguments !== 'object' || Array.isArray(event.arguments)) {
    await resolveToolCall({ callId: event.callId, result: { success: false, text: 'Tool arguments must be a JSON object.' } })
    return
  }

  try {
    const result = await tool.execute(event.arguments as CodexJsonObject, {} as never)
    await resolveToolCall({ callId: event.callId, result: { success: true, text: toolResultText(result) } })
  }
  catch (error) {
    await resolveToolCall({ callId: event.callId, result: { success: false, text: errorMessageFrom(error) ?? String(error) } })
  }
}

export function initializeCodexBridge(deps: CodexBridgeDeps): { transport: LlmTransport, dispose: () => void } {
  const transport: LlmTransport = async (request: LlmTransportRequest) => {
    const streamId = crypto.randomUUID()
    const tools = new Map(request.tools.map(tool => [tool.function.name, tool]))
    let resolveTerminal!: () => void
    let rejectTerminal!: (error: Error) => void
    const terminal = new Promise<void>((resolve, reject) => {
      resolveTerminal = resolve
      rejectTerminal = reject
    })
    const interrupt = () => {
      void deps.interruptTurn({ streamId }).catch(() => {})
    }
    if (request.options.abortSignal?.aborted)
      interrupt()
    else
      request.options.abortSignal?.addEventListener('abort', interrupt, { once: true })
    const stopListening = deps.onEvent(async (event) => {
      if (event.streamId !== streamId)
        return

      if (event.type === 'text-delta') {
        await request.options.onStreamEvent?.({ type: 'text-delta', text: event.text })
      }
      else if (event.type === 'tool-call-request') {
        await executeToolCall(event, tools, deps.resolveToolCall)
      }
      else if (event.type === 'finish') {
        await request.options.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
        resolveTerminal()
      }
      else if (event.type === 'interrupted') {
        await request.options.onStreamEvent?.({ type: 'finish', finishReason: 'abort' })
        resolveTerminal()
      }
      else if (event.type === 'error') {
        await request.options.onStreamEvent?.({ type: 'error', error: new Error(event.message) })
        rejectTerminal(new Error(event.message))
      }
    })

    try {
      const overrides = deps.getRuntimeOverrides()
      const instructions = developerInstructions(request.messages, deps.developerInstructions)
      await deps.startTurn({
        streamId,
        overrides,
        developerInstructions: instructions,
        dynamicTools: dynamicTools(request.tools),
        messages: jsonMessages(request.messages),
      })
      await terminal
    }
    finally {
      stopListening()
      request.options.abortSignal?.removeEventListener('abort', interrupt)
    }
  }
  const unregister = registerLlmTransport('codex-oauth', transport)

  return {
    transport,
    dispose: unregister,
  }
}
