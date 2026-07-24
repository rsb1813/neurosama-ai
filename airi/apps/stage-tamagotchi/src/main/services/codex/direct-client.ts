// pi-ai의 Codex OAuth와 모델 API를 Neru 내부 계약으로 정규화합니다.
import type {
  AssistantMessage,
  AssistantMessageEvent,
  AuthLoginCallbacks,
  Context,
  CredentialStore,
  Message,
  Model,
  OAuthCredential,
  Tool,
} from '@earendil-works/pi-ai'
import type { OpenAICodexResponsesOptions } from '@earendil-works/pi-ai/api/openai-codex-responses'

import type { CodexJsonObject, CodexJsonValue, CodexModel } from '../../../shared/eventa/codex'

import { Buffer } from 'node:buffer'

import { createModels } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'

import { fetchRemoteCodexModels, toRuntimeModel } from './remote-models'

const CODEX_PROVIDER_ID = 'openai-codex'
const DEVICE_CODE_METHOD = 'device_code'
const PLAN_CLAIM = 'https://api.openai.com/auth'

export interface CodexAccount {
  authMode: 'chatgpt'
  planType: string | null
}

export interface DeviceCodeInfo {
  userCode: string
  verificationUrl: string
  intervalSeconds?: number
  expiresInSeconds?: number
}

export interface DeviceLoginHandlers {
  signal?: AbortSignal
  onDeviceCode: (info: DeviceCodeInfo) => void
}

export interface CodexDirectClient {
  loginDevice: (handlers: DeviceLoginHandlers) => Promise<CodexAccount>
  readAccount: () => Promise<CodexAccount | undefined>
  refresh: () => Promise<void>
  logout: () => Promise<void>
  listModels: () => Promise<CodexModel[]>
  stream: (request: CodexDirectRequest, sink: (event: CodexDirectEvent) => void, signal: AbortSignal) => Promise<AssistantMessage>
}

export interface CodexDirectRequest {
  model?: string
  effort?: string
  serviceTier?: string
  sessionId: string
  systemPrompt: string
  messages: Message[]
  tools: Tool[]
}

export type CodexDirectEvent
  = | { type: 'text-delta', text: string }
    | { type: 'tool-call', callId: string, name: string, arguments: CodexJsonObject }

interface CodexOAuth {
  login: (callbacks: AuthLoginCallbacks) => Promise<OAuthCredential>
}

export interface CodexPiAiRuntime {
  provider: {
    id: string
    auth: { oauth?: CodexOAuth }
    getModels: () => readonly Model<'openai-codex-responses'>[]
  }
  models: {
    getAuth: (model: Model<'openai-codex-responses'>) => Promise<unknown>
    stream: (
      model: Model<'openai-codex-responses'>,
      context: Context,
      options: OpenAICodexResponsesOptions,
    ) => AsyncIterable<AssistantMessageEvent>
  }
}

export interface CodexDirectClientDeps {
  credentials: CredentialStore
  runtime?: CodexPiAiRuntime
  fetchFn?: typeof fetch
}

/** 공식 Codex Device OAuth를 사용하고 토큰은 주입된 저장소에만 기록합니다. */
export function createCodexDirectClient(deps: CodexDirectClientDeps): CodexDirectClient {
  const runtime = deps.runtime ?? createPiAiRuntime(deps.credentials)
  const oauth = runtime.provider.auth.oauth
  if (oauth === undefined)
    throw new Error('Codex Device OAuth is unavailable.')
  const bundledModels = [...runtime.provider.getModels()]
  let activeModels = bundledModels

  return {
    async loginDevice(handlers) {
      const credential = await oauth.login({
        signal: handlers.signal,
        prompt: async (prompt) => {
          if (prompt.type === 'select' && prompt.options.some(option => option.id === DEVICE_CODE_METHOD))
            return DEVICE_CODE_METHOD
          throw new Error('Codex Device OAuth requested unsupported user input.')
        },
        notify: (event) => {
          if (event.type !== 'device_code')
            return
          handlers.onDeviceCode({
            userCode: event.userCode,
            verificationUrl: event.verificationUri,
            intervalSeconds: event.intervalSeconds,
            expiresInSeconds: event.expiresInSeconds,
          })
        },
      })
      await deps.credentials.modify(CODEX_PROVIDER_ID, async () => credential)
      return accountFromCredential(credential)
    },
    async readAccount() {
      const credential = await deps.credentials.read(CODEX_PROVIDER_ID)
      return credential?.type === 'oauth' ? accountFromCredential(credential) : undefined
    },
    async refresh() {
      const model = activeModels[0]
      if (model === undefined)
        throw new Error('No Codex model is available for token refresh.')
      const auth = await runtime.models.getAuth(model)
      if (auth === undefined)
        throw new Error('Codex OAuth credentials are unavailable.')
    },
    async logout() {
      await deps.credentials.delete(CODEX_PROVIDER_ID)
    },
    async listModels() {
      const refreshModel = activeModels[0]
      if (refreshModel === undefined)
        throw new Error('No Codex model is available for token refresh.')
      const auth = await runtime.models.getAuth(refreshModel)
      if (auth === undefined)
        throw new Error('Codex OAuth credentials are unavailable.')

      const credential = await deps.credentials.read(CODEX_PROVIDER_ID)
      if (credential?.type !== 'oauth')
        throw new Error('Codex OAuth credentials are unavailable.')
      const remoteModels = await fetchRemoteCodexModels({
        accessToken: credential.access,
        fetchFn: deps.fetchFn,
      })
      const template = bundledModels.find(model => model.id === 'gpt-5.5') ?? bundledModels[0]
      if (template === undefined)
        throw new Error('No Codex model template is available.')

      const nextModels = remoteModels.map(model => toRuntimeModel(model, template))
      const nextViews = remoteModels.map(model => ({
        id: model.id,
        name: model.name,
        supportedReasoningEfforts: model.reasoningEfforts.map(value => ({ value, label: value })),
        serviceTiers: ['auto', 'fast'],
      }))
      activeModels = nextModels
      return nextViews
    },
    async stream(request, sink, signal) {
      const model = selectModel(activeModels, request.model)
      let finalMessage: AssistantMessage | undefined
      const events = runtime.models.stream(model, {
        systemPrompt: request.systemPrompt,
        messages: request.messages,
        tools: request.tools,
      }, {
        signal,
        transport: 'sse',
        sessionId: request.sessionId,
        reasoningEffort: toReasoningEffort(request.effort),
        serviceTier: toServiceTier(request.serviceTier),
      })
      for await (const event of events) {
        if (event.type === 'text_delta') {
          sink({ type: 'text-delta', text: event.delta })
        }
        else if (event.type === 'toolcall_end') {
          sink({
            type: 'tool-call',
            callId: event.toolCall.id,
            name: event.toolCall.name,
            arguments: toJsonObject(event.toolCall.arguments) ?? {},
          })
        }
        else if (event.type === 'done') {
          finalMessage = event.message
        }
        else if (event.type === 'error') {
          throw new Error(event.error.errorMessage ?? 'Codex response failed.')
        }
      }
      if (finalMessage === undefined)
        throw new Error('Codex response ended without a completion.')
      return finalMessage
    },
  }
}

function createPiAiRuntime(credentials: CredentialStore): CodexPiAiRuntime {
  const models = createModels({ credentials })
  const provider = openaiCodexProvider()
  models.setProvider(provider)
  return {
    provider,
    models: {
      getAuth: model => models.getAuth(model),
      stream: (model, context, options) => models.stream(model, context, options),
    },
  }
}

function selectModel(
  models: readonly Model<'openai-codex-responses'>[],
  requestedId: string | undefined,
): Model<'openai-codex-responses'> {
  const model = models.find(candidate => candidate.id === requestedId)
    ?? models.find(candidate => candidate.id === 'gpt-5.4')
    ?? models[0]
  if (model === undefined)
    throw new Error('No Codex model is available.')
  return model
}

function toReasoningEffort(value: string | undefined): OpenAICodexResponsesOptions['reasoningEffort'] {
  if (value === 'off')
    return 'none'
  if (value === 'none' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh')
    return value
  return undefined
}

function toServiceTier(value: string | undefined): OpenAICodexResponsesOptions['serviceTier'] {
  if (value === 'fast')
    return 'priority'
  if (value === 'auto')
    return undefined
  if (value === 'default' || value === 'flex' || value === 'priority')
    return value
  return undefined
}

function toJsonValue(value: unknown): CodexJsonValue | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string')
    return value
  if (Array.isArray(value)) {
    const entries = value.map(toJsonValue)
    return entries.every(entry => entry !== undefined) ? entries as CodexJsonValue[] : undefined
  }
  if (!isRecord(value))
    return undefined
  const result: Record<string, CodexJsonValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    const jsonEntry = toJsonValue(entry)
    if (jsonEntry === undefined)
      return undefined
    result[key] = jsonEntry
  }
  return result
}

function toJsonObject(value: unknown): CodexJsonObject | undefined {
  const json = toJsonValue(value)
  return isRecord(json) ? json as CodexJsonObject : undefined
}

function accountFromCredential(credential: OAuthCredential): CodexAccount {
  return { authMode: 'chatgpt', planType: readPlanType(credential.access) }
}

function readPlanType(accessToken: string): string | null {
  try {
    const payload = accessToken.split('.')[1]
    if (payload === undefined)
      return null
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!isRecord(claims) || !isRecord(claims[PLAN_CLAIM]))
      return null
    const planType = claims[PLAN_CLAIM].chatgpt_plan_type
    return typeof planType === 'string' ? planType : null
  }
  catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
