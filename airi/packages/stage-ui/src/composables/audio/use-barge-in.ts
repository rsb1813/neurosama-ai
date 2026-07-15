// 사용자가 말하기 시작하면 neru의 발화·생성을 즉시 중단시키는 barge-in 컴포저블
import type { MaybeRefOrGetter } from 'vue'

import { onScopeDispose, toValue, watch } from 'vue'

import workletUrl from '../../workers/vad/process.worklet?worker&url'

import { useVAD } from '../../stores/ai/models/vad'

export interface BargeInActions {
  /** neru가 지금 말하거나(생성 포함) 있는지 — barge-in은 이 때만 발동한다. */
  isBusy: () => boolean
  /** TTS 재생 중단 요청(reason 'barge-in'). */
  stopSpeaking: () => void
  /** 진행 중 LLM 스트림 취소. */
  abortStream: () => void
}

/**
 * 발동 판정: neru가 바쁠 때만 끼어들기. 유휴 상태의 사용자 발화는 평소 입력이므로 무시한다.
 */
export function shouldBargeIn(isBusy: boolean): boolean {
  return isBusy
}

/**
 * 마이크 스트림에 Silero VAD를 물려, 사용자 발화 시작 시 neru가 바쁘면 TTS 중단 + LLM 취소를 발동한다.
 * 스트림이 없으면(음성 입력 off) VAD를 시작하지 않아 barge-in은 비활성이다.
 */
export function useBargeIn(micStream: MaybeRefOrGetter<MediaStream | undefined>, actions: BargeInActions): void {
  const { init, start, dispose } = useVAD(workletUrl, {
    onSpeechStart: () => {
      if (shouldBargeIn(actions.isBusy())) {
        actions.stopSpeaking()
        actions.abortStream()
      }
    },
  })

  // 마이크 스트림이 준비되면 VAD 모델을 로드하고 그 스트림으로 시작한다.
  watch(() => toValue(micStream), async (stream) => {
    if (!stream)
      return
    await init()
    await start(stream)
  }, { immediate: true })

  onScopeDispose(() => dispose())
}
