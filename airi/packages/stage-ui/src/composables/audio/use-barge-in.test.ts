// neru barge-in 컴포저블 테스트 — VAD 워커는 목으로 대체하고 게이팅·수명주기를 검증한다
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

// useVAD를 목으로: onSpeechStart 콜백과 init/start/dispose 스파이를 붙잡아 워커 없이 검증한다.
// 스파이를 목 팩토리 밖(hoisted)에 두어야 테스트에서 호출을 단언할 수 있다.
const vadMock = vi.hoisted(() => ({
  onSpeechStart: undefined as undefined | (() => void),
  init: vi.fn(async () => {}),
  start: vi.fn(async (_stream: MediaStream) => {}),
  dispose: vi.fn(),
}))
vi.mock('../../stores/ai/models/vad', () => ({
  useVAD: (_url: string, opts: { onSpeechStart?: () => void }) => {
    vadMock.onSpeechStart = opts.onSpeechStart
    return { init: vadMock.init, start: vadMock.start, dispose: vadMock.dispose }
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
    vadMock.init.mockClear()
    vadMock.start.mockClear()
    vadMock.dispose.mockClear()
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

  it('initializes and starts VAD once a mic stream becomes available', async () => {
    const micStream = ref<MediaStream | undefined>(undefined)
    const actions = { isBusy: () => false, stopSpeaking: vi.fn(), abortStream: vi.fn() }
    const scope = effectScope()
    scope.run(() => useBargeIn(micStream, actions))

    // 스트림이 없을 때(음성 입력 off)는 VAD를 시작하지 않는다.
    await nextTick()
    expect(vadMock.init).not.toHaveBeenCalled()
    expect(vadMock.start).not.toHaveBeenCalled()

    // 스트림이 준비되면 init 후 그 스트림으로 start를 호출한다. start는 목이라 스트림 형태를 검사하지 않는다.
    const stream = {} as MediaStream
    micStream.value = stream
    await vi.waitFor(() => expect(vadMock.start).toHaveBeenCalledTimes(1))
    expect(vadMock.init).toHaveBeenCalledTimes(1)
    expect(vadMock.start).toHaveBeenCalledWith(stream)
  })

  it('disposes VAD when the effect scope stops', () => {
    const actions = { isBusy: () => false, stopSpeaking: vi.fn(), abortStream: vi.fn() }
    const scope = effectScope()
    scope.run(() => useBargeIn(() => undefined, actions))

    expect(vadMock.dispose).not.toHaveBeenCalled()
    scope.stop()
    expect(vadMock.dispose).toHaveBeenCalledTimes(1)
  })
})
