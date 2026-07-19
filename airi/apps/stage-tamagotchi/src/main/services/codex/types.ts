// Codex app-server 통신에 쓰는 JSON-RPC 메시지와 실행 경계를 정의한다.
/** Codex app-server가 반환하는 JSON-RPC 오류 정보다. */
export interface JsonRpcError {
  /** JSON-RPC 오류 코드다. */
  code: number
  /** 사용자에게 표시할 수 있는 오류 설명이다. */
  message: string
}

/** 클라이언트 요청에 대한 Codex app-server의 JSON-RPC 응답이다. */
export interface JsonRpcResponse {
  /** 요청과 응답을 연결하는 클라이언트 생성 ID다. */
  id: number
  result?: unknown
  error?: JsonRpcError
}

/** ID 없이 전달되는 Codex app-server JSON-RPC 알림이다. */
export interface JsonRpcNotification {
  method: string
  params?: unknown
}

/** Codex app-server가 응답을 요구하며 보내는 JSON-RPC 요청이다. */
export interface JsonRpcServerRequest extends JsonRpcNotification {
  /** 서버 요청에 응답할 때 그대로 사용해야 하는 서버 생성 ID다. */
  id: number
}

/** JSON-RPC 클라이언트가 줄 단위 전송과 프로세스 종료를 받는 경계다. */
export interface CodexLineIo {
  /** 메시지를 JSON 줄로 직렬화해 app-server 표준 입력으로 보낸다. */
  write: (message: JsonRpcNotification | JsonRpcResponse | JsonRpcServerRequest) => void
  /** 표준 출력에서 줄 끝이 제거된 JSON 문자열을 구독한다. */
  onLine: (handler: (line: string) => void) => () => void
  /** app-server 종료를 구독한다. 이후 새 요청은 전송되지 않는다. */
  onExit: (handler: (code: number | null) => void) => () => void
}

/** Codex app-server와의 요청, 응답, 알림 흐름을 제공하는 클라이언트다. */
export interface CodexJsonRpcClient {
  /** 응답이 올 때까지 요청 ID로 상관관계를 유지한 뒤 결과를 반환한다. */
  request: <T>(method: string, params: unknown) => Promise<T>
  /** 서버 요청에 같은 ID로 결과를 반환한다. */
  respond: (id: number, result: unknown) => void
  /** ID 없는 JSON-RPC 알림을 전송한다. */
  notify: (method: string, params: unknown) => void
  /** 서버가 보낸 ID 없는 알림을 구독하고 구독 해제 함수를 반환한다. */
  onNotification: (handler: (message: JsonRpcNotification) => void) => () => void
  /** 서버가 응답을 요구하는 요청을 구독하고 구독 해제 함수를 반환한다. */
  onServerRequest: (handler: (message: JsonRpcServerRequest) => void) => () => void
}

/** 테스트와 런타임에서 Codex 버전 문자열을 얻는 실행 경계다. */
export type CodexCliExecutor = () => Promise<string>

/** 설치된 Codex CLI의 호환성 검사 결과다. */
export interface CodexCliInspection {
  /** 버전 명령을 실행할 수 있어 Codex CLI가 현재 PATH에서 발견됐는지 여부다. */
  installed: boolean
  /** CLI 출력에서 추출한 세 부분 버전이며 추출하지 못하면 없다. */
  version?: string
  /** 최소 지원 버전 이상인지 여부다. */
  supported: boolean
  /** CLI를 실행하지 못했을 때 반환하는 오류 설명이다. */
  error?: string
}

/** app-server 프로토콜을 지원하는 최소 Codex CLI 버전이다. */
export const MIN_CODEX_VERSION = '0.144.4'
