// Codex 계정별 원격 모델 카탈로그를 안전한 런타임 모델로 정규화합니다.
import type { Model, ModelThinkingLevel, ThinkingLevelMap } from '@earendil-works/pi-ai'

import { Buffer } from 'node:buffer'

const CODEX_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models?client_version=0.144.0'
const OPENAI_AUTH_CLAIM = 'https://api.openai.com/auth'
const supportedEfforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])

export interface RemoteCodexModel {
  id: string
  name: string
  contextWindow?: number
  reasoningEfforts: string[]
}

export interface FetchRemoteCodexModelsParams {
  accessToken: string
  fetchFn?: typeof fetch
}

/** 현재 OAuth 계정에 노출된 Codex 모델을 한 번 조회하고 검증합니다. */
export async function fetchRemoteCodexModels(params: FetchRemoteCodexModelsParams): Promise<RemoteCodexModel[]> {
  const accountId = readAccountId(params.accessToken)
  if (accountId === undefined)
    throw new Error('Codex access token does not contain an account ID.')

  const response = await (params.fetchFn ?? fetch)(CODEX_MODELS_URL, {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${params.accessToken}`,
      'chatgpt-account-id': accountId,
      'originator': 'neru',
    },
  })
  if (!response.ok)
    throw new Error(`Codex model refresh failed with HTTP ${response.status}.`)

  const value: unknown = await response.json()
  const models = parseModels(value)
  if (models.length === 0)
    throw new Error('Codex model refresh returned no selectable models.')
  return models
}

/** 원격 식별자를 유지하면서 검증된 Codex 전송 메타데이터를 적용합니다. */
export function toRuntimeModel(
  remote: RemoteCodexModel,
  template: Model<'openai-codex-responses'>,
): Model<'openai-codex-responses'> {
  return {
    ...template,
    id: remote.id,
    name: remote.name,
    contextWindow: remote.contextWindow ?? template.contextWindow,
    thinkingLevelMap: toThinkingLevelMap(remote.reasoningEfforts),
  }
}

function toThinkingLevelMap(efforts: string[]): ThinkingLevelMap {
  const levels: ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
  const enabled = new Set(efforts.map(value => value === 'none' ? 'off' : value))
  const result: ThinkingLevelMap = {}
  for (const level of levels)
    result[level] = enabled.has(level) ? level : null
  return result
}

function parseModels(value: unknown): RemoteCodexModel[] {
  if (!isRecord(value) || !Array.isArray(value.models))
    throw new Error('Codex model refresh returned an invalid response.')

  return value.models.flatMap((entry): RemoteCodexModel[] => {
    if (!isRecord(entry)
      || entry.visibility !== 'list'
      || typeof entry.slug !== 'string'
      || entry.slug.length === 0
      || typeof entry.display_name !== 'string'
      || entry.display_name.length === 0) {
      return []
    }

    const reasoningEfforts = Array.isArray(entry.supported_reasoning_levels)
      ? entry.supported_reasoning_levels.flatMap((level): string[] => {
          if (!isRecord(level) || typeof level.effort !== 'string' || !supportedEfforts.has(level.effort))
            return []
          return [level.effort]
        })
      : []
    const contextWindow = typeof entry.context_window === 'number' && entry.context_window > 0
      ? entry.context_window
      : undefined
    return [{
      id: entry.slug,
      name: entry.display_name,
      contextWindow,
      reasoningEfforts,
    }]
  })
}

function readAccountId(accessToken: string): string | undefined {
  try {
    const payload = accessToken.split('.')[1]
    if (payload === undefined)
      return undefined
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!isRecord(claims) || !isRecord(claims[OPENAI_AUTH_CLAIM]))
      return undefined
    const accountId = claims[OPENAI_AUTH_CLAIM].chatgpt_account_id
    return typeof accountId === 'string' && accountId.length > 0 ? accountId : undefined
  }
  catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
