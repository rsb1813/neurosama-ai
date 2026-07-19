// LLM 제공자별 사용자 정의 전송기 등록과 해제를 검증한다.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getLlmTransport, registerLlmTransport } from './llm-transports'

describe('LLM transport registry', () => {
  const unregisters: Array<() => void> = []

  afterEach(() => {
    unregisters.splice(0).forEach(unregister => unregister())
  })

  it('registers a custom transport only for its provider', () => {
    const transport = vi.fn(async () => {})
    unregisters.push(registerLlmTransport('codex-oauth', transport))

    expect(getLlmTransport('codex-oauth')).toBe(transport)
    expect(getLlmTransport('neru-local-proxy')).toBeUndefined()
  })

  it('does not remove a replacement transport when an older registration is disposed', () => {
    const first = vi.fn(async () => {})
    const second = vi.fn(async () => {})
    const unregisterFirst = registerLlmTransport('codex-oauth', first)
    unregisters.push(unregisterFirst)
    unregisters.push(registerLlmTransport('codex-oauth', second))

    unregisterFirst()

    expect(getLlmTransport('codex-oauth')).toBe(second)
  })
})
