// Codex app-server 줄 단위 JSON-RPC 요청과 응답의 수명주기를 관리한다.
import type {
  CodexJsonRpcClient,
  CodexLineIo,
  JsonRpcNotification,
  JsonRpcResponse,
  JsonRpcServerRequest,
} from './types'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * Codex app-server의 요청 ID 상관관계와 종료 수명주기를 관리한다.
 *
 * 요청 ID는 이 클라이언트 인스턴스 안에서만 고유하며, 프로세스가 종료되면
 * 모든 대기 요청과 이후 요청은 같은 종료 오류로 거부된다.
 */
export function createCodexJsonRpcClient(io: CodexLineIo): CodexJsonRpcClient {
  let nextRequestId = 1
  let hasExited = false
  const pendingRequests = new Map<number, PendingRequest>()
  const notificationHandlers = new Set<(message: JsonRpcNotification) => void>()
  const serverRequestHandlers = new Set<(message: JsonRpcServerRequest) => void>()

  io.onLine((line) => {
    const message = parseJsonRpcMessage(line)
    if (message === undefined)
      return

    if (isJsonRpcResponse(message)) {
      // 응답 ID는 이 인스턴스의 요청 ID와만 연결된다. 이전 세션 등의 알 수 없는 ID는 무시한다.
      const pendingRequest = pendingRequests.get(message.id)
      if (pendingRequest === undefined)
        return

      pendingRequests.delete(message.id)
      if (message.error !== undefined) {
        pendingRequest.reject(new Error(message.error.message))
        return
      }

      pendingRequest.resolve(message.result)
      return
    }

    if (isJsonRpcServerRequest(message)) {
      for (const handler of serverRequestHandlers)
        handler(message)
      return
    }

    if (isJsonRpcNotification(message)) {
      for (const handler of notificationHandlers)
        handler(message)
    }
  })

  io.onExit(() => {
    if (hasExited)
      return

    hasExited = true
    for (const pendingRequest of pendingRequests.values())
      pendingRequest.reject(createExitError())
    pendingRequests.clear()
  })

  return {
    request<T>(method: string, params: unknown) {
      if (hasExited)
        return Promise.reject(createExitError())

      const id = nextRequestId++
      return new Promise<T>((resolve, reject) => {
        // 동기 테스트 IO도 응답할 수 있으므로 write 전에 ID를 등록한다.
        pendingRequests.set(id, {
          resolve: value => resolve(value as T),
          reject,
        })
        io.write({ id, method, params })
      })
    },
    respond(id, result) {
      io.write({ id, result })
    },
    notify(method, params) {
      io.write({ method, params })
    },
    onNotification(handler) {
      notificationHandlers.add(handler)
      return () => notificationHandlers.delete(handler)
    },
    onServerRequest(handler) {
      serverRequestHandlers.add(handler)
      return () => serverRequestHandlers.delete(handler)
    },
  }
}

function createExitError(): Error {
  return new Error('Codex app-server exited')
}

function parseJsonRpcMessage(line: string): unknown | undefined {
  try {
    return JSON.parse(line) as unknown
  }
  catch {
    // app-server 표준 출력에 섞인 비 JSON 줄은 현재 연결의 프로토콜 상태를 바꾸지 않는다.
    return undefined
  }
}

function isJsonRpcResponse(message: unknown): message is JsonRpcResponse {
  if (!isRecord(message) || typeof message.id !== 'number')
    return false

  if ('result' in message)
    return true

  return isRecord(message.error)
    && typeof message.error.code === 'number'
    && typeof message.error.message === 'string'
}

function isJsonRpcServerRequest(message: unknown): message is JsonRpcServerRequest {
  return isRecord(message)
    && typeof message.id === 'number'
    && typeof message.method === 'string'
}

function isJsonRpcNotification(message: unknown): message is JsonRpcNotification {
  return isRecord(message)
    && !('id' in message)
    && typeof message.method === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
