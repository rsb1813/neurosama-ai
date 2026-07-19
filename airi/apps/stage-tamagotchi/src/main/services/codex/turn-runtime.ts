// Codex thread와 turn 이벤트를 Neru 스트림, 도구, 승인 이벤트로 변환한다.
import type { CodexJsonRpcClient, JsonRpcNotification, JsonRpcServerRequest } from './types'

/** Codex app-server에 등록하는 동적 함수 도구 설명이다. */
export interface CodexDynamicToolDescriptor {
  type: 'function'
  name: string
  description: string
  inputSchema: Readonly<Record<string, unknown>>
}

/** Codex thread와 turn을 시작하는 데 필요한 Neru 요청이다. */
export interface CodexTurnRequest {
  streamId: string
  threadId?: string
  cwd: string
  model: string
  developerInstructions: string
  dynamicTools: readonly CodexDynamicToolDescriptor[]
  userInput: string
}

/** 동적 도구 실행 결과를 app-server에 돌려보내는 값이다. */
export interface CodexToolResult {
  success: boolean
  text: string
}

/** 승인 UI가 선택한 제한된 Codex 권한 응답이다. */
export interface CodexApprovalDecision {
  type: 'accept' | 'acceptForSession' | 'decline'
  /** permissions 승인일 때 요청 범위 안에서만 허용할 권한이다. */
  permissions?: Readonly<Record<string, unknown>>
}

/** turn 런타임이 렌더러 bridge로 보내는 이벤트다. */
export type CodexBridgeEvent
  = | { type: 'text-delta', streamId: string, text: string }
    | { type: 'finish', streamId: string, threadId: string }
    | { type: 'interrupted', streamId: string, threadId: string }
    | { type: 'thread-resume-failed', streamId: string, threadId: string }
    | { type: 'tool-call-request', callId: string, tool: string, arguments: unknown }
    | { type: 'approval-request', requestId: string, approvalType: 'command' | 'file' | 'permissions', request: unknown }

/** turn 런타임이 살아 있는 RPC만 읽는 매니저 경계다. */
export interface CodexTurnRuntimeManager {
  ensureStarted: () => Promise<unknown>
  getRpc: () => CodexJsonRpcClient | undefined
}

/** turn 런타임을 생성하는 의존성이다. */
export interface CodexTurnRuntimeDeps {
  manager: CodexTurnRuntimeManager
}

/** Codex thread, turn, 도구, 승인 요청을 하나의 app-server 연결에서 조정한다. */
export interface CodexTurnRuntime {
  startTurn: (request: CodexTurnRequest, sink: (event: CodexBridgeEvent) => void) => Promise<{ threadId: string }>
  interrupt: (streamId: string) => Promise<void>
  resolveToolCall: (callId: string, result: CodexToolResult) => void
  resolveApproval: (requestId: string, decision: CodexApprovalDecision) => void
}

interface ActiveStream {
  streamId: string
  threadId: string
  turnId: string
  sink: (event: CodexBridgeEvent) => void
  resolve: (result: { threadId: string }) => void
}

interface StartingStream {
  streamId: string
  threadId: string
  sink: (event: CodexBridgeEvent) => void
}

interface PendingApproval {
  id: number
  type: 'command' | 'file' | 'permissions'
  permissions?: unknown
}

/**
 * Codex의 thread·turn 프로토콜을 Neru의 스트림 경계로 연결한다.
 *
 * 단일 runtime 인스턴스가 RPC 구독과 보류 중인 도구·승인 응답을 소유합니다. 저장된
 * thread의 resume은 절대로 새 thread 생성으로 대체하지 않습니다.
 */
export function createCodexTurnRuntime(deps: CodexTurnRuntimeDeps): CodexTurnRuntime {
  const activeStreams = new Map<string, ActiveStream>()
  const startingStreams = new Map<string, StartingStream>()
  const pendingToolCalls = new Map<string, number>()
  const pendingApprovals = new Map<string, PendingApproval>()
  let subscribedClient: CodexJsonRpcClient | undefined

  async function startTurn(request: CodexTurnRequest, sink: (event: CodexBridgeEvent) => void): Promise<{ threadId: string }> {
    await deps.manager.ensureStarted()
    const client = deps.manager.getRpc()
    if (client === undefined)
      throw new Error('Codex app-server is unavailable.')

    subscribe(client)
    const resumeThreadId = request.threadId
    const isResume = resumeThreadId !== undefined
    let threadId: string
    try {
      const response = await client.request<unknown>(isResume ? 'thread/resume' : 'thread/start', createThreadParams(request))
      const receivedThreadId = readThreadId(response)
      if (receivedThreadId === undefined)
        throw new Error('Codex returned an invalid thread response.')
      threadId = receivedThreadId
    }
    catch (error) {
      if (resumeThreadId !== undefined && isResumeFailure(error))
        sink({ type: 'thread-resume-failed', streamId: request.streamId, threadId: resumeThreadId })
      throw error
    }

    const starting = { streamId: request.streamId, threadId, sink }
    startingStreams.set(threadId, starting)
    let turnId: string
    try {
      const response = await client.request<unknown>('turn/start', {
        threadId,
        input: [{ type: 'text', text: request.userInput }],
      })
      const receivedTurnId = readTurnId(response)
      if (receivedTurnId === undefined)
        throw new Error('Codex returned an invalid turn response.')
      turnId = receivedTurnId
    }
    finally {
      if (startingStreams.get(threadId) === starting)
        startingStreams.delete(threadId)
    }

    return new Promise((resolve) => {
      activeStreams.set(turnId, { ...starting, turnId, resolve })
    })
  }

  async function interrupt(streamId: string): Promise<void> {
    const activeStream = [...activeStreams.values()].find(stream => stream.streamId === streamId)
    if (activeStream === undefined)
      return

    const client = deps.manager.getRpc()
    if (client === undefined)
      return

    await client.request('turn/interrupt', { threadId: activeStream.threadId, turnId: activeStream.turnId })
  }

  function resolveToolCall(callId: string, result: CodexToolResult): void {
    const requestId = pendingToolCalls.get(callId)
    if (requestId === undefined)
      return

    pendingToolCalls.delete(callId)
    const client = deps.manager.getRpc()
    if (client === undefined)
      return

    client.respond(requestId, {
      contentItems: [{ type: 'inputText', text: result.text }],
      success: result.success,
    })
  }

  function resolveApproval(requestId: string, decision: CodexApprovalDecision): void {
    const pendingApproval = pendingApprovals.get(requestId)
    if (pendingApproval === undefined)
      return

    pendingApprovals.delete(requestId)
    const client = deps.manager.getRpc()
    if (client === undefined)
      return

    if (pendingApproval.type === 'permissions') {
      const permissions = decision.type === 'decline'
        ? {}
        : restrictPermissions(pendingApproval.permissions, decision.permissions)
      client.respond(pendingApproval.id, decision.type === 'acceptForSession'
        ? { permissions, scope: 'session' }
        : { permissions })
      return
    }

    client.respond(pendingApproval.id, { decision: decision.type })
  }

  function subscribe(client: CodexJsonRpcClient): void {
    if (subscribedClient === client)
      return

    subscribedClient = client
    client.onNotification(handleNotification)
    client.onServerRequest(handleServerRequest)
  }

  function handleNotification(message: JsonRpcNotification): void {
    if (message.method === 'item/agentMessage/delta') {
      const delta = readTextDelta(message.params)
      if (delta === undefined)
        return

      const activeStream = activeStreams.get(delta.turnId)
      if (activeStream === undefined || activeStream.threadId !== delta.threadId)
        return

      activeStream.sink({ type: 'text-delta', streamId: activeStream.streamId, text: delta.text })
      return
    }

    if (message.method !== 'turn/completed')
      return

    const completion = readTurnCompletion(message.params)
    if (completion === undefined)
      return

    const activeStream = activeStreams.get(completion.turnId)
    if (activeStream === undefined || activeStream.threadId !== completion.threadId)
      return

    activeStreams.delete(completion.turnId)
    activeStream.sink(completion.status === 'interrupted'
      ? { type: 'interrupted', streamId: activeStream.streamId, threadId: activeStream.threadId }
      : { type: 'finish', streamId: activeStream.streamId, threadId: activeStream.threadId })
    activeStream.resolve({ threadId: activeStream.threadId })
  }

  function handleServerRequest(message: JsonRpcServerRequest): void {
    if (message.method === 'item/tool/call') {
      const toolCall = readToolCall(message.params)
      if (toolCall === undefined) {
        subscribedClient?.respond(message.id, { contentItems: [], success: false })
        return
      }

      pendingToolCalls.set(toolCall.callId, message.id)
      emitToActiveStreams({
        type: 'tool-call-request',
        callId: toolCall.callId,
        tool: toolCall.tool,
        arguments: toolCall.arguments,
      })
      return
    }

    const approvalType = getApprovalType(message.method)
    if (approvalType === undefined) {
      subscribedClient?.respond(message.id, { decision: 'decline' })
      return
    }

    const requestId = String(message.id)
    const permissions = approvalType === 'permissions' ? readPermissions(message.params) : undefined
    pendingApprovals.set(requestId, { id: message.id, type: approvalType, permissions })
    emitToActiveStreams({ type: 'approval-request', requestId, approvalType, request: message.params })
  }

  function emitToActiveStreams(event: CodexBridgeEvent): void {
    for (const activeStream of activeStreams.values())
      activeStream.sink(event)
    for (const startingStream of startingStreams.values())
      startingStream.sink(event)
  }

  return { startTurn, interrupt, resolveToolCall, resolveApproval }
}

function createThreadParams(request: CodexTurnRequest): Record<string, unknown> {
  const params: Record<string, unknown> = {
    cwd: request.cwd,
    sandbox: 'workspaceWrite',
    approvalPolicy: 'unlessTrusted',
    developerInstructions: request.developerInstructions,
    dynamicTools: request.dynamicTools,
  }
  if (request.threadId !== undefined)
    params.threadId = request.threadId
  if (request.model !== 'codex-configured')
    params.model = request.model
  return params
}

function readThreadId(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.thread) || typeof value.thread.id !== 'string')
    return undefined
  return value.thread.id
}

function readTurnId(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.turn) || typeof value.turn.id !== 'string')
    return undefined
  return value.turn.id
}

function readTextDelta(value: unknown): { threadId: string, turnId: string, text: string } | undefined {
  if (!isRecord(value)
    || typeof value.threadId !== 'string'
    || typeof value.turnId !== 'string'
    || typeof value.delta !== 'string') {
    return undefined
  }
  return { threadId: value.threadId, turnId: value.turnId, text: value.delta }
}

function readTurnCompletion(value: unknown): { threadId: string, turnId: string, status: string } | undefined {
  if (!isRecord(value)
    || typeof value.threadId !== 'string'
    || !isRecord(value.turn)
    || typeof value.turn.id !== 'string'
    || typeof value.turn.status !== 'string') {
    return undefined
  }
  return { threadId: value.threadId, turnId: value.turn.id, status: value.turn.status }
}

function readToolCall(value: unknown): { callId: string, tool: string, arguments: unknown } | undefined {
  if (!isRecord(value) || typeof value.callId !== 'string' || typeof value.tool !== 'string')
    return undefined
  return { callId: value.callId, tool: value.tool, arguments: value.arguments }
}

function getApprovalType(method: string): PendingApproval['type'] | undefined {
  if (method === 'item/commandExecution/requestApproval')
    return 'command'
  if (method === 'item/fileChange/requestApproval')
    return 'file'
  if (method === 'item/permissions/requestApproval')
    return 'permissions'
  return undefined
}

function readPermissions(value: unknown): unknown {
  return isRecord(value) ? value.permissions : undefined
}

function restrictPermissions(requested: unknown, selected: unknown): Record<string, unknown> {
  const permitted = restrictPermissionValue(requested, selected)
  return isRecord(permitted) ? permitted : {}
}

function restrictPermissionValue(requested: unknown, selected: unknown): unknown {
  if (Array.isArray(requested) && Array.isArray(selected)) {
    return selected.filter(selection => requested.some(request => equalJsonValue(request, selection)))
  }
  if (isRecord(requested) && isRecord(selected)) {
    const permitted: Record<string, unknown> = {}
    for (const [key, selection] of Object.entries(selected)) {
      const value = restrictPermissionValue(requested[key], selection)
      if (hasPermissionValue(value))
        permitted[key] = value
    }
    return permitted
  }
  return equalJsonValue(requested, selected) ? selected : undefined
}

function hasPermissionValue(value: unknown): boolean {
  return Array.isArray(value)
    ? value.length > 0
    : isRecord(value)
      ? Object.keys(value).length > 0
      : value !== undefined
}

function equalJsonValue(left: unknown, right: unknown): boolean {
  if (left === right)
    return true
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((value, index) => equalJsonValue(value, right[index]))
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left)
    return leftKeys.length === Object.keys(right).length
      && leftKeys.every(key => equalJsonValue(left[key], right[key]))
  }
  return false
}

function isResumeFailure(error: unknown): boolean {
  return error instanceof Error && /not found|invalid thread/i.test(error.message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
