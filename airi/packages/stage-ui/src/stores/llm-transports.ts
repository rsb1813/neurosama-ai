// OpenAI 호환 경로 밖 LLM 제공자의 스트림 전송기를 provider ID로 등록한다.
import type { StreamOptions } from '@proj-airi/core-agent'
import type { Message, Tool } from '@xsai/shared-chat'

export interface LlmTransportRequest {
  providerId: string
  sessionId?: string
  model: string
  messages: Message[]
  tools: Tool[]
  options: StreamOptions
}

export type LlmTransport = (request: LlmTransportRequest) => Promise<void>

const transports = new Map<string, LlmTransport>()

export function registerLlmTransport(providerId: string, transport: LlmTransport): () => void {
  transports.set(providerId, transport)

  return () => {
    if (transports.get(providerId) === transport)
      transports.delete(providerId)
  }
}

export function getLlmTransport(providerId: string | undefined): LlmTransport | undefined {
  if (!providerId)
    return undefined

  return transports.get(providerId)
}
