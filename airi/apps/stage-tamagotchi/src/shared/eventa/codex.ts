// Codex app-server와 렌더러 사이의 직렬화 가능한 Eventa 계약을 정의한다.
import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

/** Eventa 경계를 안전하게 통과할 수 있는 JSON 값이다. */
export type CodexJsonValue = boolean | null | number | string | CodexJsonObject | CodexJsonValue[]

/** Eventa payload의 키가 문자열인 JSON 객체다. */
export interface CodexJsonObject {
  [key: string]: CodexJsonValue
}

/** Codex CLI, app-server, 계정 인증의 렌더러용 상태 스냅샷이다. */
export interface CodexRuntimeStatus {
  /** 설치 검사와 기능 프로브가 지원되는 CLI를 확인했는지 나타낸다. */
  cli: 'unknown' | 'supported' | 'unsupported'
  /** 단일 manager가 소유한 app-server 프로세스 상태다. */
  process: 'stopped' | 'running'
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
  /** 완료 또는 취소 알림과 연결하는 app-server 로그인 식별자다. */
  loginId: string
  /** 사용자가 브라우저에서 열어야 하는 확인 URL이다. */
  verificationUrl: string
  /** 확인 화면에 입력할 짧은 Device OAuth 코드다. */
  userCode: string
  /** 현재 지원하는 Device OAuth 방식이다. */
  type: 'chatgptDeviceCode'
}

/** app-server에 등록할 렌더러 소유 동적 도구의 직렬화 설명이다. */
export interface CodexDynamicToolDescriptor {
  type: 'function'
  name: string
  description: string
  inputSchema: CodexJsonObject
}

/** app-server 모델 선택기에 표시할 정규화된 추론 강도다. */
export interface CodexReasoningEffort {
  value: string
  label: string
}

/** app-server `model/list`에서 렌더러에 필요한 항목만 정규화한 모델이다. */
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
  cwd?: string
  sandbox?: 'readOnly' | 'workspaceWrite' | 'dangerFullAccess'
  approvalPolicy?: 'unlessTrusted' | 'onRequest' | 'never'
  approvalsReviewer?: 'user' | 'auto_review'
}

/** 하나의 Codex thread와 turn을 시작하는 렌더러 요청이다. */
export interface CodexTurnRequest {
  streamId: string
  threadId?: string
  overrides: CodexRuntimeOverrides
  developerInstructions: string
  dynamicTools: readonly CodexDynamicToolDescriptor[]
  userInput: string
}

/** 렌더러가 완료한 동적 도구 호출의 직렬화 결과다. */
export interface CodexToolResult {
  success: boolean
  text: string
}

/** 렌더러가 하나의 app-server 승인 요청에 보낼 제한된 결정이다. */
export interface CodexApprovalDecision {
  type: 'accept' | 'acceptForSession' | 'decline'
  /** permissions 요청에서 원래 요청 범위 안에서만 선택된 권한이다. */
  permissions?: CodexJsonObject
}

/** app-server turn 진행을 시작한 renderer context에만 보내는 이벤트다. */
export type CodexBridgeEvent
  = | { type: 'text-delta', streamId: string, threadId: string, turnId: string, text: string }
    | { type: 'finish', streamId: string, threadId: string, turnId: string }
    | { type: 'interrupted', streamId: string, threadId: string, turnId: string }
    | { type: 'error', streamId: string, threadId: string, turnId: string, message: string }
    | { type: 'thread-resume-failed', streamId: string, threadId: string }
    | { type: 'tool-call-request', streamId: string, threadId: string, turnId: string, callId: string, tool: string, arguments: CodexJsonValue }
    | { type: 'approval-request', streamId: string, threadId: string, turnId: string, requestId: string, approvalType: 'command' | 'file' | 'permissions', request: CodexJsonValue }

/** 동적 도구 호출 결과를 app-server에 전달하는 renderer 요청이다. */
export interface CodexToolCallResolution {
  callId: string
  result: CodexToolResult
}

/** 승인 요청을 app-server에 전달하는 renderer 요청이다. */
export interface CodexApprovalResolution {
  requestId: string
  decision: CodexApprovalDecision
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
/** Codex thread와 turn을 시작한다. */
export const codexStartTurn = defineInvokeEventa<{ threadId: string }, CodexTurnRequest>('eventa:invoke:electron:codex:turn:start')
/** 활성 Codex turn을 중단한다. */
export const codexInterruptTurn = defineInvokeEventa<void, { streamId: string }>('eventa:invoke:electron:codex:turn:interrupt')
/** 보류 중인 동적 도구 호출 결과를 전달한다. */
export const codexResolveToolCall = defineInvokeEventa<void, CodexToolCallResolution>('eventa:invoke:electron:codex:tool:resolve')
/** 보류 중인 승인 요청의 결정을 전달한다. */
export const codexResolveApproval = defineInvokeEventa<void, CodexApprovalResolution>('eventa:invoke:electron:codex:approval:resolve')
/** 시작한 renderer context 전용 Codex turn bridge 이벤트다. */
export const codexBridgeEvent = defineEventa<CodexBridgeEvent>('eventa:event:electron:codex:bridge')
/** 활성 Codex Eventa binding 모두에 방송하는 상태 변경 이벤트다. */
export const codexStatusChanged = defineEventa<CodexRuntimeStatus>('eventa:event:electron:codex:status')
