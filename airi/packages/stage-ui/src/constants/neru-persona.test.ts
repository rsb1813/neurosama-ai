// neru 페르소나 시스템 프롬프트 상수 테스트
import { describe, expect, it } from 'vitest'

import { EMOTION_VALUES } from './emotions'
import { NERU_SYSTEM_PROMPT } from './neru-persona'

describe('neru system prompt', () => {
  it('instructs Korean-in English-out', () => {
    expect(NERU_SYSTEM_PROMPT).toMatch(/KOREAN/)
    expect(NERU_SYSTEM_PROMPT).toMatch(/ENGLISH/)
  })
  it('specifies the <ko> subtitle marker format', () => {
    expect(NERU_SYSTEM_PROMPT).toContain('<ko>')
    expect(NERU_SYSTEM_PROMPT).toContain('</ko>')
  })
  // ROOT CAUSE:
  // 표정은 LLM이 뱉는 `<|ACT {"emotion":...}|>` 토큰이 구동하는데, 초기 페르소나엔 이 규약이
  // 없어 모델이 감정 토큰을 아예 안 뱉었고 그래서 표정 배선이 무반응이었다. 규약과 예시를
  // 프롬프트에 포함하도록 고쳤다. 이 테스트가 ACT 규약과 예시 존재를 고정한다.
  it('includes the ACT emotion-token protocol and an example', () => {
    expect(NERU_SYSTEM_PROMPT).toContain('<|ACT ')
    expect(NERU_SYSTEM_PROMPT).toContain('"emotion"')
    expect(NERU_SYSTEM_PROMPT).toMatch(/<\|ACT \{"emotion":"happy"\}\|>/)
  })
  it('lists every available emotion so ACT payloads stay valid', () => {
    for (const emotion of EMOTION_VALUES)
      expect(NERU_SYSTEM_PROMPT).toContain(`- ${emotion} `)
  })
  it('gives neru a witch backstory', () => {
    expect(NERU_SYSTEM_PROMPT).toMatch(/witch/i)
  })
})
