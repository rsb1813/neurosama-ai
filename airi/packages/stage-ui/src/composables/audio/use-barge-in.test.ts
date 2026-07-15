// neru barge-in 컴포저블 테스트 — VAD 워커는 목으로 대체하고 게이팅만 검증한다
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

// useVAD를 목으로: onSpeechStart 콜백을 붙잡아 워커 없이 발동만 검증한다.
const vadMock = vi.hoisted(() => ({ onSpeechStart: undefined as undefined | (() => void) }))
vi.mock('../../stores/ai/models/vad', () => ({
  useVAD: (_url: string, opts: { onSpeechStart?: () => void }) => {
    vadMock.onSpeechStart = opts.onSpeechStart
    return { init: vi.fn(async () => {}), start: vi.fn(async () => {}), dispose: vi.fn() }
  },
}))
// Vite 워커 URL import를 목으로 대체(테스트에서 워커 번들 해석 회피).
vi.mock('../../workers/vad/process.worklet?worker&url', () => ({ default: 'worklet-url' }))

const { shouldBargeIn, useBargeIn } = await import('./use-barge-in')

describe('shouldBargeIn', () => {
  it('fires only when neru is busy', () => {
    expect(shouldBargeIn(true)).toBe(true)
    expect(shouldBargeIn(false)).toBe(false)
  })
})

describe('useBargeIn', () => {
  beforeEach(() => {
    vadMock.onSpeechStart = undefined
  })

  function run(isBusy: boolean) {
    const stopSpeaking = vi.fn()
    const abortStream = vi.fn()
    const scope = effectScope()
    scope.run(() => useBargeIn(() => undefined, { isBusy: () => isBusy, stopSpeaking, abortStream }))
    return { stopSpeaking, abortStream }
  }

  it('stops speech and aborts the stream on speech-start when busy', () => {
    const { stopSpeaking, abortStream } = run(true)
    vadMock.onSpeechStart!()
    expect(stopSpeaking).toHaveBeenCalledTimes(1)
    expect(abortStream).toHaveBeenCalledTimes(1)
  })

  it('does nothing on speech-start when idle', () => {
    const { stopSpeaking, abortStream } = run(false)
    vadMock.onSpeechStart!()
    expect(stopSpeaking).not.toHaveBeenCalled()
    expect(abortStream).not.toHaveBeenCalled()
  })
})
