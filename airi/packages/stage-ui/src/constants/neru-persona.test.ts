// neru 페르소나 시스템 프롬프트 상수 테스트
import { describe, expect, it } from 'vitest'
import { NERU_SYSTEM_PROMPT } from './neru-persona'

describe('NERU_SYSTEM_PROMPT', () => {
  it('instructs Korean-in English-out', () => {
    expect(NERU_SYSTEM_PROMPT).toMatch(/KOREAN/)
    expect(NERU_SYSTEM_PROMPT).toMatch(/ENGLISH/)
  })
  it('specifies the <ko> subtitle marker format', () => {
    expect(NERU_SYSTEM_PROMPT).toContain('<ko>')
    expect(NERU_SYSTEM_PROMPT).toContain('</ko>')
  })
})
