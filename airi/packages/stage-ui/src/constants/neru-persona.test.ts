// neru 페르소나 시스템 프롬프트 상수 테스트
import { describe, expect, it } from 'vitest'

import { EMOTION_VALUES } from './emotions'
import { NERU_SYSTEM_PROMPT } from './neru-persona'

describe('neru system prompt', () => {
  it('instructs Korean-in English-out', () => {
    expect(NERU_SYSTEM_PROMPT).toMatch(/KOREAN/)
    expect(NERU_SYSTEM_PROMPT).toMatch(/ENGLISH/)
  })
  // ROOT CAUSE:
  // 긴 한국어 대화에서 neru가 자기 과거 한국어 답변을 따라 순수 한국어로 드리프트했고, 그 한국어가
  // 영어 전용 TTS(Chatterbox)로 가서 발음이 외계어처럼 뭉개졌다. 프롬프트의 영어-강제가 약해
  // conversation momentum에 밀린 게 원인. "항상 영어" 강제와 발화 위치 한국어 금지 하드룰을
  // 넣어 고쳤다. 그 강화 문구가 실수로 약화/삭제되지 않도록 회귀 가드로 고정한다.
  it('enforces English speech strongly enough to resist Korean drift', () => {
    expect(NERU_SYSTEM_PROMPT).toMatch(/ALWAYS[\s\S]{0,80}ENGLISH/i)
    expect(NERU_SYSTEM_PROMPT).toMatch(/never put Korean in the spoken position/i)
  })
  it('specifies the <ko> subtitle marker format', () => {
    expect(NERU_SYSTEM_PROMPT).toContain('<ko>')
    expect(NERU_SYSTEM_PROMPT).toContain('</ko>')
  })
  // ROOT CAUSE:
  // 표정은 LLM이 뱉는 `<|ACT {"emotion":...}|>` 토큰이 구동하는데, 초기 페르소나엔 이 규약이
  // 없어 모델이 감정 토큰을 아예 안 뱉었고 그래서 표정 배선이 무반응이었다. 규약을 프롬프트에
  // 포함하도록 고쳤다. 정확한 예시 문구가 아니라 규약의 존재만 회귀 가드로 고정한다(untyped 문자열이라).
  it('includes the ACT emotion-token protocol', () => {
    expect(NERU_SYSTEM_PROMPT).toContain('<|ACT ')
    expect(NERU_SYSTEM_PROMPT).toContain('"emotion"')
  })
  it('lists every available emotion so ACT payloads stay valid', () => {
    for (const emotion of EMOTION_VALUES)
      expect(NERU_SYSTEM_PROMPT).toContain(`- ${emotion} (Emotion for feeling `)
  })
  it('includes web-search guidance', () => {
    expect(NERU_SYSTEM_PROMPT).toMatch(/webSearch/)
    expect(NERU_SYSTEM_PROMPT).toMatch(/search the web|look .* up/i)
  })
})
