// pi-ai의 Codex OAuth와 모델 API를 Neru 내부 계약으로 정규화합니다.
import type { Api, AuthLoginCallbacks, CredentialStore, Model, OAuthCredential } from '@earendil-works/pi-ai'

import type { CodexModel } from '../../../shared/eventa/codex'

import { Buffer } from 'node:buffer'

import { createModels, getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'

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
}

interface CodexOAuth {
  login: (callbacks: AuthLoginCallbacks) => Promise<OAuthCredential>
}

export interface CodexPiAiRuntime {
  provider: {
    id: string
    auth: { oauth?: CodexOAuth }
    getModels: () => readonly Model<Api>[]
  }
  models: {
    getAuth: (model: Model<Api>) => Promise<unknown>
  }
}

export interface CodexDirectClientDeps {
  credentials: CredentialStore
  runtime?: CodexPiAiRuntime
}

/** 공식 Codex Device OAuth를 사용하고 토큰은 주입된 저장소에만 기록합니다. */
export function createCodexDirectClient(deps: CodexDirectClientDeps): CodexDirectClient {
  const runtime = deps.runtime ?? createPiAiRuntime(deps.credentials)
  const oauth = runtime.provider.auth.oauth
  if (oauth === undefined)
    throw new Error('Codex Device OAuth is unavailable.')

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
      const model = runtime.provider.getModels()[0]
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
      return runtime.provider.getModels().map(model => ({
        id: model.id,
        name: model.name,
        supportedReasoningEfforts: getSupportedThinkingLevels(model).map(value => ({ value, label: value })),
        serviceTiers: [],
      }))
    },
  }
}

function createPiAiRuntime(credentials: CredentialStore): CodexPiAiRuntime {
  const models = createModels({ credentials })
  const provider = openaiCodexProvider()
  models.setProvider(provider)
  return { models, provider }
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
