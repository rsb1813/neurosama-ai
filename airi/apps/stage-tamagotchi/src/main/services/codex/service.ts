// Codex Eventa 호출을 하나의 manager와 창별 Electron context에 연결하는 서비스다.
import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import type {
  CodexApprovalDecision,
  CodexBridgeEvent,
  CodexRuntimeStatus,
  CodexToolResult,
  CodexTurnRequest,
} from '../../../shared/eventa/codex'
import type { CodexManager } from './manager'

import { defineInvokeHandlers } from '@moeru/eventa'

import {
  codexBridgeEvent,
  codexCancelDeviceLogin,
  codexGetStatus,
  codexInterruptTurn,
  codexLogout,
  codexResolveApproval,
  codexResolveToolCall,
  codexStartDeviceLogin,
  codexStartTurn,
  codexStatusChanged,
} from '../../../shared/eventa/codex'
import { createCodexTurnRuntime } from './turn-runtime'

type EventaContext = ReturnType<typeof createContext>['context']

export interface CodexController {
  bind: (context: EventaContext) => () => void
  getStatus: () => CodexRuntimeStatus
  startDeviceLogin: () => ReturnType<CodexManager['startDeviceLogin']>
  cancelLogin: (loginId: string) => ReturnType<CodexManager['cancelLogin']>
  logout: () => ReturnType<CodexManager['logout']>
  startTurn: (request: CodexTurnRequest, sink: (event: CodexBridgeEvent) => void) => Promise<{ threadId: string }>
  interrupt: (streamId: string) => Promise<void>
  resolveToolCall: (callId: string, result: CodexToolResult) => void
  resolveApproval: (requestId: string, decision: CodexApprovalDecision) => void
  stop: () => Promise<void>
}

/** 하나의 app-server manager를 여러 Electron 창의 Eventa context에 안전하게 연결한다. */
export function createCodexController(params: { manager: CodexManager, workspaceRoot?: string }): CodexController {
  const contexts = new Set<EventaContext>()
  const runtime = createCodexTurnRuntime({ manager: params.manager })
  const removeStatusListener = params.manager.onStatusChange((status) => {
    for (const context of contexts)
      context.emit(codexStatusChanged, status)
  })
  let stopPromise: Promise<void> | undefined

  return {
    bind(context) {
      contexts.add(context)
      return () => contexts.delete(context)
    },
    getStatus: () => params.manager.getStatus(),
    startDeviceLogin: () => params.manager.startDeviceLogin(),
    cancelLogin: loginId => params.manager.cancelLogin(loginId),
    logout: () => params.manager.logout(),
    startTurn: (request, sink) => runtime.startTurn({
      ...request,
      cwd: request.cwd || params.workspaceRoot || process.cwd(),
    }, sink),
    interrupt: streamId => runtime.interrupt(streamId),
    resolveToolCall: (callId, result) => runtime.resolveToolCall(callId, result),
    resolveApproval: (requestId, decision) => runtime.resolveApproval(requestId, decision),
    stop: () => {
      stopPromise ??= Promise.resolve()
        .then(() => params.manager.stop())
        .finally(() => {
          contexts.clear()
          removeStatusListener()
        })
      return stopPromise
    },
  }
}

/** 하나의 Electron 창에서 Codex Eventa invoke와 상태 event를 등록한다. */
export function createCodexService(params: { context: EventaContext, controller: CodexController, window?: BrowserWindow }) {
  const activeStreamIds = new Set<string>()
  const unbind = params.controller.bind(params.context)
  let disposed = false
  const dispose = () => {
    if (disposed)
      return

    disposed = true
    unbind()
    for (const streamId of activeStreamIds)
      void params.controller.interrupt(streamId)
    activeStreamIds.clear()
  }
  params.window?.once('closed', dispose)

  defineInvokeHandlers(
    params.context,
    {
      getStatus: codexGetStatus,
      startDeviceLogin: codexStartDeviceLogin,
      cancelDeviceLogin: codexCancelDeviceLogin,
      logout: codexLogout,
      startTurn: codexStartTurn,
      interruptTurn: codexInterruptTurn,
      resolveToolCall: codexResolveToolCall,
      resolveApproval: codexResolveApproval,
    },
    {
      getStatus: () => params.controller.getStatus(),
      startDeviceLogin: () => params.controller.startDeviceLogin(),
      cancelDeviceLogin: payload => params.controller.cancelLogin(payload.loginId),
      logout: () => params.controller.logout(),
      startTurn: async (request) => {
        if (disposed)
          throw new Error('Codex window binding is unavailable.')

        activeStreamIds.add(request.streamId)
        try {
          return await params.controller.startTurn(request, event => params.context.emit(codexBridgeEvent, event))
        }
        finally {
          activeStreamIds.delete(request.streamId)
        }
      },
      interruptTurn: payload => params.controller.interrupt(payload.streamId),
      resolveToolCall: payload => params.controller.resolveToolCall(payload.callId, payload.result),
      resolveApproval: payload => params.controller.resolveApproval(payload.requestId, payload.decision),
    },
  )

  return { dispose }
}
