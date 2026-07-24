// Codex 직접 OAuth 전송과 렌더러 사이의 직렬화 가능한 Eventa 계약을 정의합니다.
import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

/** Eventa 경계를 안전하게 통과할 수 있는 JSON 값이다. */
export type CodexJsonValue = boolean | null | number | string | CodexJsonObject | CodexJsonValue[]

/** Eventa payload의 키가 문자열인 JSON 객체다. */
export interface CodexJsonObject {
  [key: string]: CodexJsonValue
}

/** Codex 계정 연결의 렌더러용 상태 스냅샷입니다. */
export interface CodexRuntimeStatus {
  /** 저장된 계정으로 직접 연결할 수 있는지 나타냅니다. */
  connection: 'disconnected' | 'connected' | 'reauthenticationRequired'
  /** 로그인된 계정의 인증 방식이며 계정이 없으면 null이다. */
  authMode: string | null
  /** 로그인된 계정의 구독 플랜이며 계정이 없으면 null이다. */
  planType: string | null
  /** Device OAuth 요청의 현재 진행 상태다. */
  login: 'idle' | 'pending' | 'completed' | 'failed'
  /** 토큰이나 원시 서버 응답을 포함하지 않는 사용자 표시용 오류다. */
  error?: string
}

/** Device OAuth 시작 후 렌더러가 표시할 사용자 확인 정보다. */
export interface CodexDeviceLogin {
  /** 완료 또는 취소 알림과 연결하는 로그인 식별자입니다. */
  loginId: string
  /** 사용자가 브라우저에서 열어야 하는 확인 URL이다. */
  verificationUrl: string
  /** 확인 화면에 입력할 짧은 Device OAuth 코드다. */
  userCode: string
  /** 현재 지원하는 Device OAuth 방식이다. */
  type: 'chatgptDeviceCode'
  /** 사용자 코드가 만료되는 Unix epoch 밀리초입니다. */
  expiresAt: number
}

/** 직접 Responses 요청에 등록할 렌더러 소유 동적 도구의 직렬화 설명입니다. */
export interface CodexDynamicToolDescriptor {
  type: 'function'
  name: string
  description: string
  inputSchema: CodexJsonObject
}

/** 모델 선택기에 표시할 정규화된 추론 강도입니다. */
export interface CodexReasoningEffort {
  value: string
  label: string
}

/** 직접 클라이언트가 렌더러에 필요한 항목만 정규화한 모델입니다. */
export interface CodexModel {
  id: string
  name: string
  supportedReasoningEfforts: CodexReasoningEffort[]
  serviceTiers: string[]
}

/** 비어 있는 필드는 사용자의 기존 Codex 설정을 상속하는 실행 덮어쓰기다. */
export interface CodexRuntimeOverrides {
  model?: string
  effort?: string
  serviceTier?: string
}

/** renderer 대화를 Electron main으로 복제 가능한 형태로 전달하는 메시지입니다. */
export interface CodexConversationMessage {
  role: 'assistant' | 'developer' | 'system' | 'tool' | 'user'
  content?: CodexJsonValue
  toolCalls?: CodexConversationToolCall[]
  toolCallId?: string
}

/** 이전 assistant 메시지에 포함된 함수 호출입니다. */
export interface CodexConversationToolCall {
  id: string
  name: string
  arguments: CodexJsonObject
}

/** 하나의 Codex 직접 응답 스트림을 시작하는 렌더러 요청입니다. */
export interface CodexTurnRequest {
  streamId: string
  overrides: CodexRuntimeOverrides
  developerInstructions: string
  dynamicTools: readonly CodexDynamicToolDescriptor[]
  messages: CodexConversationMessage[]
}

/** 렌더러가 완료한 동적 도구 호출의 직렬화 결과다. */
export interface CodexToolResult {
  success: boolean
  text: string
}

/** 직접 Codex 응답을 시작한 renderer context에만 보내는 이벤트입니다. */
export type CodexBridgeEvent
  = | { type: 'text-delta', streamId: string, text: string }
    | { type: 'finish', streamId: string }
    | { type: 'interrupted', streamId: string }
    | { type: 'error', streamId: string, message: string }
    | { type: 'tool-call-request', streamId: string, callId: string, tool: string, arguments: CodexJsonValue }

/** 동적 도구 호출 결과를 직접 전송 런타임에 전달하는 renderer 요청입니다. */
export interface CodexToolCallResolution {
  callId: string
  result: CodexToolResult
}

/** 현재 Codex 상태를 읽는다. */
export const codexGetStatus = defineInvokeEventa<CodexRuntimeStatus>('eventa:invoke:electron:codex:status')
/** 현재 계정과 설치본에서 사용할 수 있는 모델 목록을 읽는다. */
export const codexListModels = defineInvokeEventa<CodexModel[]>('eventa:invoke:electron:codex:models:list')
/** Device OAuth를 시작한다. */
export const codexStartDeviceLogin = defineInvokeEventa<CodexDeviceLogin>('eventa:invoke:electron:codex:login:start')
/** 일치하는 Device OAuth 로그인을 취소한다. */
export const codexCancelDeviceLogin = defineInvokeEventa<void, { loginId: string }>('eventa:invoke:electron:codex:login:cancel')
/** 현재 Codex 계정 로그아웃을 요청한다. */
export const codexLogout = defineInvokeEventa<void>('eventa:invoke:electron:codex:logout')
/** Codex 직접 응답 스트림을 시작합니다. */
export const codexStartTurn = defineInvokeEventa<void, CodexTurnRequest>('eventa:invoke:electron:codex:turn:start')
/** 활성 Codex turn을 중단한다. */
export const codexInterruptTurn = defineInvokeEventa<void, { streamId: string }>('eventa:invoke:electron:codex:turn:interrupt')
/** 보류 중인 동적 도구 호출 결과를 전달한다. */
export const codexResolveToolCall = defineInvokeEventa<void, CodexToolCallResolution>('eventa:invoke:electron:codex:tool:resolve')
/** 시작한 renderer context 전용 Codex turn bridge 이벤트다. */
export const codexBridgeEvent = defineEventa<CodexBridgeEvent>('eventa:event:electron:codex:bridge')
/** 활성 Codex Eventa binding 모두에 방송하는 상태 변경 이벤트다. */
export const codexStatusChanged = defineEventa<CodexRuntimeStatus>('eventa:event:electron:codex:status')
