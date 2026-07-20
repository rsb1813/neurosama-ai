// Codex thread와 turn의 실행 수명주기, 도구 호출, 승인을 관리한다.
import type {
  CodexApprovalDecision,
  CodexBridgeEvent,
  CodexJsonValue,
  CodexRuntimeOverrides,
  CodexToolResult,
  CodexTurnRequest,
} from '../../../shared/eventa/codex'
// Codex thread와 turn 이벤트를 Neru 스트림, 도구, 승인 이벤트로 변환한다.
import type { CodexJsonRpcClient, JsonRpcNotification, JsonRpcServerRequest } from './types'

/** Codex app-server에 등록하는 동적 함수 도구 설명이다. */
export type {
  CodexApprovalDecision,
  CodexBridgeEvent,
  CodexDynamicToolDescriptor,
  CodexToolResult,
  CodexTurnRequest,
} from '../../../shared/eventa/codex'

/** turn 런타임이 살아 있는 RPC와 process 상태를 읽는 매니저 경계다. */
export interface CodexTurnRuntimeManager {
  ensureStarted: () => Promise<unknown>
  getRpc: () => CodexJsonRpcClient | undefined
  /** process가 중지되면 이전 RPC 세션의 stream과 보류 요청을 폐기한다. */
  onStatusChange?: (handler: (status: { process: 'stopped' | 'running' }) => void) => () => void
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

interface TurnStream {
  streamId: string
  threadId: string
  rpc: CodexJsonRpcClient
  sink: (event: CodexBridgeEvent) => void
  completion: Promise<{ threadId: string }>
  resolve: (result: { threadId: string }) => void
  reject: (error: Error) => void
  turnId?: string
}

interface PendingToolCall {
  rpc: CodexJsonRpcClient
  id: number
  streamId: string
  threadId: string
  turnId: string
}

interface PendingApproval extends PendingToolCall {
  type: 'command' | 'file' | 'permissions'
  permissions?: unknown
}

interface RpcSession {
  rpc: CodexJsonRpcClient
  removeNotificationHandler: () => void
  removeServerRequestHandler: () => void
}

const invalidServerRequest = { code: -32600, message: 'Invalid Codex server request.' }
const unsupportedServerRequest = { code: -32601, message: 'Unsupported Codex server request.' }
const dangerousPermissionKeys = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Codex의 thread·turn 프로토콜을 Neru의 스트림 경계로 연결한다.
 *
 * RPC 세션마다 구독·보류 요청·stream 소유권을 함께 유지합니다. 같은 thread에서 두 turn을
 * 동시에 시작하지 않아, app-server의 `threadId`·`turnId` 상관관계가 한 stream만 가리킵니다.
 */
export function createCodexTurnRuntime(deps: CodexTurnRuntimeDeps): CodexTurnRuntime {
  const streamsByThread = new Map<string, TurnStream>()
  const streamsByTurn = new Map<string, TurnStream>()
  const streamsById = new Map<string, TurnStream>()
  const pendingToolCalls = new Map<string, PendingToolCall>()
  const pendingApprovals = new Map<string, PendingApproval>()
  let session: RpcSession | undefined

  deps.manager.onStatusChange?.((status) => {
    if (status.process === 'stopped')
      endSession(new Error('Codex app-server stopped.'))
  })

  async function startTurn(request: CodexTurnRequest, sink: (event: CodexBridgeEvent) => void): Promise<{ threadId: string }> {
    await deps.manager.ensureStarted()
    const rpc = deps.manager.getRpc()
    if (rpc === undefined)
      throw new Error('Codex app-server is unavailable.')

    attachSession(rpc)

    const resumeThreadId = request.threadId
    let threadId: string
    try {
      const response = await rpc.request<unknown>(resumeThreadId === undefined ? 'thread/start' : 'thread/resume', createThreadParams(request))
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

    if (streamsByThread.has(threadId))
      throw new Error('Codex turn is already active for this thread.')

    const stream = createStream(request, threadId, rpc, sink)
    streamsByThread.set(threadId, stream)
    streamsById.set(request.streamId, stream)

    try {
      const response = await rpc.request<unknown>('turn/start', createTurnParams(request, threadId))
      const responseTurnId = readTurnId(response)
      if (responseTurnId === undefined) {
        failStream(stream)
        return stream.completion
      }

      if (stream.turnId !== undefined && stream.turnId !== responseTurnId) {
        failStream(stream)
        return stream.completion
      }

      bindTurn(stream, responseTurnId)
    }
    catch {
      failStream(stream)
      return stream.completion
    }

    return stream.completion
  }

  async function interrupt(streamId: string): Promise<void> {
    const stream = streamsById.get(streamId)
    if (stream === undefined || stream.turnId === undefined || stream.rpc !== session?.rpc)
      return

    await stream.rpc.request('turn/interrupt', { threadId: stream.threadId, turnId: stream.turnId })
  }

  function resolveToolCall(callId: string, result: CodexToolResult): void {
    const pending = pendingToolCalls.get(callId)
    if (pending === undefined)
      return

    // UI 응답은 한 번만 소비하고, 교체된 RPC에는 절대로 응답하지 않습니다.
    pendingToolCalls.delete(callId)
    if (pending.rpc !== session?.rpc)
      return

    pending.rpc.respond(pending.id, {
      contentItems: [{ type: 'inputText', text: result.text }],
      success: result.success,
    })
  }

  function resolveApproval(requestId: string, decision: CodexApprovalDecision): void {
    const pending = pendingApprovals.get(requestId)
    if (pending === undefined)
      return

    // UI 응답은 한 번만 소비하고, 교체된 RPC에는 절대로 응답하지 않습니다.
    pendingApprovals.delete(requestId)
    if (pending.rpc !== session?.rpc)
      return

    if (pending.type === 'permissions') {
      const permissions = decision.type === 'decline'
        ? {}
        : restrictPermissions(pending.permissions, decision.permissions)
      pending.rpc.respond(pending.id, decision.type === 'acceptForSession'
        ? { permissions, scope: 'session' }
        : { permissions })
      return
    }

    pending.rpc.respond(pending.id, { decision: decision.type })
  }

  function attachSession(rpc: CodexJsonRpcClient): void {
    if (session?.rpc === rpc)
      return

    endSession(new Error('Codex app-server connection changed.'))
    session = {
      rpc,
      removeNotificationHandler: rpc.onNotification(message => handleNotification(rpc, message)),
      removeServerRequestHandler: rpc.onServerRequest(message => handleServerRequest(rpc, message)),
    }
  }

  function endSession(error: Error): void {
    session?.removeNotificationHandler()
    session?.removeServerRequestHandler()
    session = undefined

    for (const stream of streamsById.values())
      stream.reject(error)
    streamsByThread.clear()
    streamsByTurn.clear()
    streamsById.clear()
    pendingToolCalls.clear()
    pendingApprovals.clear()
  }

  function handleNotification(rpc: CodexJsonRpcClient, message: JsonRpcNotification): void {
    if (rpc !== session?.rpc)
      return

    if (message.method === 'turn/started') {
      const owner = readTurnOwner(message.params)
      if (owner === undefined)
        return

      const stream = streamsByThread.get(owner.threadId)
      if (stream === undefined || stream.rpc !== rpc)
        return

      if (stream.turnId !== undefined && stream.turnId !== owner.turnId) {
        failStream(stream)
        return
      }

      bindTurn(stream, owner.turnId)
      return
    }

    if (message.method === 'item/agentMessage/delta') {
      const delta = readTextDelta(message.params)
      if (delta === undefined)
        return

      const stream = streamsByTurn.get(delta.turnId)
      if (stream === undefined || stream.rpc !== rpc || stream.threadId !== delta.threadId)
        return

      stream.sink({ type: 'text-delta', streamId: stream.streamId, threadId: stream.threadId, turnId: delta.turnId, text: delta.text })
      return
    }

    if (message.method === 'turn/completed')
      handleCompletion(rpc, message.params)
  }

  function handleCompletion(rpc: CodexJsonRpcClient, value: unknown): void {
    const completion = readTurnCompletion(value)
    if (completion === undefined)
      return

    const stream = streamsByTurn.get(completion.turnId)
    if (stream === undefined || stream.rpc !== rpc || stream.threadId !== completion.threadId)
      return

    if (completion.status === 'completed') {
      completeStream(stream, 'finish')
      return
    }
    if (completion.status === 'interrupted') {
      completeStream(stream, 'interrupted')
      return
    }

    // failed, 누락된 status, 알려지지 않은 status 모두 서버 세부 정보를 노출하지 않고 실패합니다.
    failStream(stream)
  }

  function handleServerRequest(rpc: CodexJsonRpcClient, message: JsonRpcServerRequest): void {
    if (rpc !== session?.rpc) {
      rpc.respondError(message.id, invalidServerRequest)
      return
    }

    const approvalType = getApprovalType(message.method)
    if (message.method !== 'item/tool/call' && approvalType === undefined) {
      rpc.respondError(message.id, unsupportedServerRequest)
      return
    }

    const owner = readTurnOwner(message.params)
    if (owner === undefined) {
      rpc.respondError(message.id, invalidServerRequest)
      return
    }

    const stream = streamsByTurn.get(owner.turnId)
    if (stream === undefined || stream.rpc !== rpc || stream.threadId !== owner.threadId) {
      rpc.respondError(message.id, invalidServerRequest)
      return
    }

    if (message.method === 'item/tool/call') {
      const toolCall = readToolCall(message.params)
      if (toolCall === undefined || pendingToolCalls.has(toolCall.callId)) {
        rpc.respondError(message.id, invalidServerRequest)
        return
      }

      pendingToolCalls.set(toolCall.callId, { rpc, id: message.id, streamId: stream.streamId, threadId: stream.threadId, turnId: stream.turnId ?? owner.turnId })
      stream.sink({ type: 'tool-call-request', streamId: stream.streamId, threadId: stream.threadId, turnId: owner.turnId, callId: toolCall.callId, tool: toolCall.tool, arguments: toolCall.arguments })
      return
    }

    if (approvalType === undefined) {
      rpc.respondError(message.id, unsupportedServerRequest)
      return
    }

    const requestId = String(message.id)
    if (pendingApprovals.has(requestId)) {
      rpc.respondError(message.id, invalidServerRequest)
      return
    }

    pendingApprovals.set(requestId, {
      rpc,
      id: message.id,
      streamId: stream.streamId,
      threadId: stream.threadId,
      turnId: stream.turnId ?? owner.turnId,
      type: approvalType,
      permissions: approvalType === 'permissions' && isRecord(message.params) ? message.params.permissions : undefined,
    })
    const request = readCodexJsonValue(message.params)
    if (request === undefined) {
      pendingApprovals.delete(requestId)
      rpc.respondError(message.id, invalidServerRequest)
      return
    }
    stream.sink({ type: 'approval-request', streamId: stream.streamId, threadId: stream.threadId, turnId: owner.turnId, requestId, approvalType, request })
  }

  function bindTurn(stream: TurnStream, turnId: string): void {
    if (stream.turnId === turnId)
      return

    stream.turnId = turnId
    streamsByTurn.set(turnId, stream)
  }

  function completeStream(stream: TurnStream, type: 'finish' | 'interrupted'): void {
    const turnId = stream.turnId
    if (turnId === undefined) {
      failStream(stream)
      return
    }

    removeStream(stream)
    stream.sink({ type, streamId: stream.streamId, threadId: stream.threadId, turnId })
    stream.resolve({ threadId: stream.threadId })
  }

  function failStream(stream: TurnStream): void {
    const turnId = stream.turnId
    removeStream(stream)
    if (turnId !== undefined)
      stream.sink({ type: 'error', streamId: stream.streamId, threadId: stream.threadId, turnId, message: 'Codex turn failed.' })
    stream.reject(new Error('Codex turn failed.'))
  }

  function removeStream(stream: TurnStream): void {
    streamsByThread.delete(stream.threadId)
    streamsById.delete(stream.streamId)
    if (stream.turnId !== undefined)
      streamsByTurn.delete(stream.turnId)
  }

  return { startTurn, interrupt, resolveToolCall, resolveApproval }
}

function createStream(
  request: CodexTurnRequest,
  threadId: string,
  rpc: CodexJsonRpcClient,
  sink: (event: CodexBridgeEvent) => void,
): TurnStream {
  let resolve: (result: { threadId: string }) => void = () => {}
  let reject: (error: Error) => void = () => {}
  const completion = new Promise<{ threadId: string }>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  // `turn/started`가 `turn/start` 응답보다 먼저 실패해도, 호출자가 응답을 기다리는 동안
  // Node가 미처리 rejection으로 취급하지 않도록 관찰자를 즉시 연결합니다.
  void completion.catch(() => {})
  return { streamId: request.streamId, threadId, rpc, sink, completion, resolve, reject }
}

function createThreadParams(request: CodexTurnRequest): Record<string, unknown> {
  const overrides = request.overrides ?? {}
  const params: Record<string, unknown> = {
    developerInstructions: request.developerInstructions,
    dynamicTools: request.dynamicTools,
  }
  if (request.threadId !== undefined)
    params.threadId = request.threadId
  if (overrides.cwd !== undefined)
    params.cwd = overrides.cwd
  if (overrides.sandbox !== undefined)
    params.sandbox = toSandboxMode(overrides.sandbox)
  if (overrides.approvalPolicy !== undefined)
    params.approvalPolicy = toApprovalPolicy(overrides.approvalPolicy)
  if (overrides.approvalsReviewer !== undefined)
    params.approvalsReviewer = overrides.approvalsReviewer
  if (overrides.model !== undefined)
    params.model = overrides.model
  return params
}

function createTurnParams(request: CodexTurnRequest, threadId: string): Record<string, unknown> {
  const overrides = request.overrides ?? {}
  const params: Record<string, unknown> = {
    threadId,
    input: [{ type: 'text', text: request.userInput }],
  }
  if (overrides.cwd !== undefined)
    params.cwd = overrides.cwd
  if (overrides.sandbox !== undefined)
    params.sandboxPolicy = { type: overrides.sandbox }
  if (overrides.approvalPolicy !== undefined)
    params.approvalPolicy = toApprovalPolicy(overrides.approvalPolicy)
  if (overrides.approvalsReviewer !== undefined)
    params.approvalsReviewer = overrides.approvalsReviewer
  if (overrides.model !== undefined)
    params.model = overrides.model
  if (overrides.effort !== undefined)
    params.effort = overrides.effort
  if (overrides.serviceTier !== undefined)
    params.serviceTier = overrides.serviceTier
  return params
}

function toSandboxMode(sandbox: NonNullable<CodexRuntimeOverrides['sandbox']>): string {
  return {
    readOnly: 'read-only',
    workspaceWrite: 'workspace-write',
    dangerFullAccess: 'danger-full-access',
  }[sandbox]
}

function toApprovalPolicy(policy: NonNullable<CodexRuntimeOverrides['approvalPolicy']>): string {
  return {
    unlessTrusted: 'untrusted',
    onRequest: 'on-request',
    never: 'never',
  }[policy]
}

function readThreadId(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.thread))
    return undefined
  return readNonEmptyText(value.thread.id)
}

function readTurnId(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.turn))
    return undefined
  return readNonEmptyText(value.turn.id)
}

function readTurnOwner(value: unknown): { threadId: string, turnId: string } | undefined {
  if (!isRecord(value))
    return undefined

  const threadId = readNonEmptyText(value.threadId)
  const turnId = readNonEmptyText(value.turnId) ?? (isRecord(value.turn) ? readNonEmptyText(value.turn.id) : undefined)
  return threadId !== undefined && turnId !== undefined ? { threadId, turnId } : undefined
}

function readTextDelta(value: unknown): { threadId: string, turnId: string, text: string } | undefined {
  const owner = readTurnOwner(value)
  if (owner === undefined || !isRecord(value) || typeof value.delta !== 'string')
    return undefined
  return { ...owner, text: value.delta }
}

function readTurnCompletion(value: unknown): { threadId: string, turnId: string, status: string | undefined } | undefined {
  const owner = readTurnOwner(value)
  if (owner === undefined || !isRecord(value))
    return undefined

  const status = isRecord(value.turn) && typeof value.turn.status === 'string'
    ? value.turn.status
    : undefined
  return { ...owner, status }
}

function readToolCall(value: unknown): { callId: string, tool: string, arguments: CodexJsonValue } | undefined {
  if (!isRecord(value) || typeof value.tool !== 'string')
    return undefined
  const callId = readNonEmptyText(value.callId)
  if (callId === undefined)
    return undefined
  const argumentsValue = value.arguments === undefined ? {} : readCodexJsonValue(value.arguments)
  if (argumentsValue === undefined)
    return undefined
  return { callId, tool: value.tool, arguments: argumentsValue }
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

function restrictPermissions(requested: unknown, selected: unknown): Record<string, unknown> {
  const permitted = restrictPermissionValue(requested, selected)
  return isRecord(permitted) ? permitted : {}
}

function restrictPermissionValue(requested: unknown, selected: unknown): unknown {
  if (Array.isArray(requested) && Array.isArray(selected)) {
    return selected.filter(selection => requested.some(request => equalJsonValue(request, selection)))
  }
  if (!isRecord(requested) || !isRecord(selected))
    return equalJsonValue(requested, selected) ? selected : undefined

  const permitted: Record<string, unknown> = {}
  for (const key of Object.keys(selected)) {
    // JSON 객체여도 __proto__ 대입은 일반 객체의 prototype을 바꿀 수 있으므로 항상 제외합니다.
    if (dangerousPermissionKeys.has(key) || !Object.hasOwn(requested, key))
      continue

    const value = restrictPermissionValue(requested[key], selected[key])
    if (hasPermissionValue(value))
      permitted[key] = value
  }
  return permitted
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
    const rightKeys = Object.keys(right)
    return leftKeys.length === rightKeys.length
      && leftKeys.every(key => Object.hasOwn(right, key) && equalJsonValue(left[key], right[key]))
  }
  return false
}

function isResumeFailure(error: unknown): boolean {
  return error instanceof Error && /not found|invalid thread/i.test(error.message)
}

function readNonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readCodexJsonValue(value: unknown): CodexJsonValue | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string')
    return value
  if (Array.isArray(value)) {
    const items: CodexJsonValue[] = []
    for (const item of value) {
      const parsed = readCodexJsonValue(item)
      if (parsed === undefined)
        return undefined
      items.push(parsed)
    }
    return items
  }
  if (!isRecord(value))
    return undefined

  const record = Object.create(null) as Record<string, CodexJsonValue>
  for (const [key, item] of Object.entries(value)) {
    const parsed = readCodexJsonValue(item)
    if (parsed === undefined)
      return undefined
    record[key] = parsed
  }
  return record
}
