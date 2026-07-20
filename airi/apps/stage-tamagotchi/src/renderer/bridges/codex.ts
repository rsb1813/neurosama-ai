// Codex Electron 이벤트를 AIRI 스트림과 로컬 도구 실행으로 연결한다.
import type { LlmTransport, LlmTransportRequest } from '@proj-airi/stage-ui/stores/llm-transports'
import type { Message, Tool } from '@xsai/shared-chat'

import type {
  CodexBridgeEvent,
  CodexDynamicToolDescriptor,
  CodexJsonObject,
  CodexRuntimeOverrides,
  CodexToolCallResolution,
  CodexTurnRequest,
} from '../../shared/eventa/codex'

import { errorMessageFrom } from '@moeru/std'
import { registerLlmTransport } from '@proj-airi/stage-ui/stores/llm-transports'

const THREAD_IDS_STORAGE_KEY = 'neru/codex/thread-ids'

interface StoredThread {
  threadId: string
  signature: string
}

export interface CodexBridgeDeps {
  startTurn: (request: CodexTurnRequest) => Promise<{ threadId: string }>
  interruptTurn: (payload: { streamId: string }) => Promise<void>
  resolveToolCall: (payload: CodexToolCallResolution) => Promise<void>
  onEvent: (handler: (event: CodexBridgeEvent) => void | Promise<void>) => () => void
  getRuntimeOverrides: () => CodexRuntimeOverrides
  developerInstructions: string
}

function readThreadIds(): Record<string, unknown> {
  try {
    const value = JSON.parse(localStorage.getItem(THREAD_IDS_STORAGE_KEY) ?? '{}')
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  }
  catch {
    return {}
  }
}

function writeThreadId(sessionId: string | undefined, threadId: string, signature: string) {
  if (!sessionId)
    return

  const threadIds = readThreadIds()
  threadIds[sessionId] = { threadId, signature }
  localStorage.setItem(THREAD_IDS_STORAGE_KEY, JSON.stringify(threadIds))
}

function storedThread(value: unknown): StoredThread | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return undefined

  const candidate = value as Partial<StoredThread>
  if (typeof candidate.threadId !== 'string' || typeof candidate.signature !== 'string')
    return undefined

  return { threadId: candidate.threadId, signature: candidate.signature }
}

function developerInstructions(messages: Message[], fallback: string): string {
  const systemMessage = messages.find(message => message.role === 'system')
  return systemMessage && typeof systemMessage.content === 'string' && systemMessage.content.trim()
    ? systemMessage.content
    : fallback
}

async function threadSignature(instructions: string, model: string | undefined): Promise<string> {
  const input = new TextEncoder().encode(JSON.stringify([model ?? null, instructions]))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
  return `v1:${hex}`
}

function messageText(messages: Message[]): string {
  const lastUserMessage = messages.toReversed().find(message => message.role === 'user')
  if (!lastUserMessage)
    return ''

  return typeof lastUserMessage.content === 'string'
    ? lastUserMessage.content
    : JSON.stringify(lastUserMessage.content)
}

function jsonObject(value: unknown): CodexJsonObject {
  try {
    const parsed = JSON.parse(JSON.stringify(value))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as CodexJsonObject
      : {}
  }
  catch {
    return {}
  }
}

function dynamicTools(tools: Tool[]): CodexDynamicToolDescriptor[] {
  return tools.map(tool => ({
    type: 'function' as const,
    name: tool.function.name,
    description: tool.function.description ?? '',
    inputSchema: jsonObject(tool.function.parameters),
  }))
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
      else if (event.type === 'thread-resume-failed') {
        rejectTerminal(new Error('Codex thread could not be resumed.'))
      }
    })

    try {
      const overrides = deps.getRuntimeOverrides()
      const instructions = developerInstructions(request.messages, deps.developerInstructions)
      const signature = await threadSignature(instructions, overrides.model)
      const previousThread = request.sessionId
        ? storedThread(readThreadIds()[request.sessionId])
        : undefined
      const result = await deps.startTurn({
        streamId,
        threadId: previousThread?.signature === signature ? previousThread.threadId : undefined,
        overrides,
        developerInstructions: instructions,
        dynamicTools: dynamicTools(request.tools),
        userInput: messageText(request.messages),
      })
      writeThreadId(request.sessionId, result.threadId, signature)
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
