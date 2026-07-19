// 음성 입력과 barge-in이 공유하는 Silero VAD 상태와 수명주기를 관리한다.
import type { MaybeRefOrGetter } from 'vue'

import type { BaseVADConfig } from '../../../libs/audio/vad'

import { merge } from '@moeru/std'
import { errorMessageFromValue } from '@proj-airi/stage-shared'
import { ref, toRef, watch } from 'vue'

import { createVAD, createVADStates } from '../../../workers/vad'

interface UseVADOptions {
  threshold?: MaybeRefOrGetter<number>
  minSilenceDurationMs?: MaybeRefOrGetter<number>
  speechPadMs?: MaybeRefOrGetter<number>
  minSpeechDurationMs?: MaybeRefOrGetter<number>
  onSpeechStart?: () => void
  onSpeechEnd?: () => void
  onSpeechReady?: (event: { buffer: Float32Array, duration: number }) => void
}

const DEFAULT_VAD_THRESHOLD = 0.52
const DEFAULT_VAD_MIN_SILENCE_DURATION_MS = 1200
const DEFAULT_VAD_SPEECH_PAD_MS = 360
const DEFAULT_VAD_MIN_SPEECH_DURATION_MS = 300

export function resolveVADConfig(
  threshold?: number,
  minSilenceDurationMs?: number,
  speechPadMs?: number,
  minSpeechDurationMs?: number,
): Pick<BaseVADConfig, 'speechThreshold' | 'exitThreshold' | 'minSilenceDurationMs' | 'speechPadMs' | 'minSpeechDurationMs'> {
  const resolvedThreshold = threshold ?? DEFAULT_VAD_THRESHOLD
  return {
    speechThreshold: resolvedThreshold,
    exitThreshold: resolvedThreshold * 0.3,
    minSilenceDurationMs: minSilenceDurationMs ?? DEFAULT_VAD_MIN_SILENCE_DURATION_MS,
    speechPadMs: speechPadMs ?? DEFAULT_VAD_SPEECH_PAD_MS,
    minSpeechDurationMs: minSpeechDurationMs ?? DEFAULT_VAD_MIN_SPEECH_DURATION_MS,
  }
}

export function useVAD(workerUrl: string, options?: UseVADOptions) {
  const defaultOptions: UseVADOptions = {
    threshold: ref(DEFAULT_VAD_THRESHOLD),
    minSilenceDurationMs: ref(DEFAULT_VAD_MIN_SILENCE_DURATION_MS),
    speechPadMs: ref(DEFAULT_VAD_SPEECH_PAD_MS),
    minSpeechDurationMs: ref(DEFAULT_VAD_MIN_SPEECH_DURATION_MS),
  }
  options = merge(defaultOptions, options)

  const vad = ref<Awaited<ReturnType<typeof createVAD>>>()
  const manager = ref<ReturnType<typeof createVADStates>>()
  const inferenceError = ref<string>()
  const isSpeech = ref(false)
  const isSpeechProb = ref(0)
  const isSpeechHistory = ref<number[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const threshold = toRef(options.threshold)
  const minSilenceDurationMs = toRef(options.minSilenceDurationMs)
  const speechPadMs = toRef(options.speechPadMs)
  const minSpeechDurationMs = toRef(options.minSpeechDurationMs)

  async function init() {
    if (loaded.value || loading.value || manager.value)
      return

    loading.value = true
    inferenceError.value = ''
    try {
      vad.value = await createVAD({
        sampleRate: 16000,
        ...resolveVADConfig(threshold.value, minSilenceDurationMs.value, speechPadMs.value, minSpeechDurationMs.value),
      })
      vad.value.on('speech-start', () => {
        isSpeech.value = true
        options?.onSpeechStart?.()
      })
      vad.value.on('speech-end', () => {
        isSpeech.value = false
        options?.onSpeechEnd?.()
      })
      vad.value.on('speech-ready', event => options?.onSpeechReady?.(event))
      vad.value.on('debug', ({ data }) => {
        if (data?.probability === undefined)
          return
        isSpeechProb.value = data.probability
        isSpeechHistory.value.push(data.probability)
        if (isSpeechHistory.value.length > 50)
          isSpeechHistory.value.shift()
      })
      vad.value.on('status', ({ type, message }) => {
        if (type === 'error')
          inferenceError.value = message
      })

      const nextManager = createVADStates(vad.value, workerUrl, {
        minChunkSize: 512,
        audioContextOptions: { sampleRate: 16000, latencyHint: 'interactive' },
      })
      await nextManager.initialize()
      manager.value = nextManager
      loaded.value = true
    }
    catch (error) {
      inferenceError.value = errorMessageFromValue(error)
    }
    finally {
      loading.value = false
    }
  }

  async function start(stream: MediaStream) {
    if (manager.value)
      await manager.value.start(stream)
  }

  function dispose() {
    manager.value?.stop()
    manager.value?.dispose()
    manager.value = undefined
    isSpeech.value = false
    isSpeechProb.value = 0
    isSpeechHistory.value = []
    loaded.value = false
    loading.value = false
  }

  watch(threshold, (value) => {
    if (vad.value && value !== undefined)
      vad.value.updateConfig({ speechThreshold: value, exitThreshold: value * 0.3 })
  })
  watch(minSilenceDurationMs, (value) => {
    if (vad.value && value !== undefined)
      vad.value.updateConfig({ minSilenceDurationMs: value })
  })
  watch(speechPadMs, (value) => {
    if (vad.value && value !== undefined)
      vad.value.updateConfig({ speechPadMs: value })
  })
  watch(minSpeechDurationMs, (value) => {
    if (vad.value && value !== undefined)
      vad.value.updateConfig({ minSpeechDurationMs: value })
  })

  return {
    isSpeech,
    isSpeechProb,
    isSpeechHistory,
    loaded,
    loading,
    inferenceError,
    threshold,
    minSilenceDurationMs,
    speechPadMs,
    minSpeechDurationMs,
    init,
    start,
    dispose,
  }
}
