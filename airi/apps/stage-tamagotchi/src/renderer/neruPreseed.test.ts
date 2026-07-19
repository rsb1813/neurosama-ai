// @vitest-environment jsdom
import { NERU_WITCH_PRESET_ID } from '@proj-airi/stage-ui/constants/neru-witch'
import { beforeEach, describe, expect, it } from 'vitest'

import { preseedNeruProviders } from './neruPreseed'

const STAGE_MODEL_KEY = 'settings/stage/model'
const SEEDED_KEY = 'neru/stage-model-seeded'

describe('preseedNeruProviders — provider opt-in', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('does not choose or configure providers on a fresh install', () => {
    preseedNeruProviders()
    expect(localStorage.getItem('settings/consciousness/active-provider')).toBeNull()
    expect(localStorage.getItem('settings/consciousness/active-model')).toBeNull()
    expect(localStorage.getItem('settings/hearing/active-provider')).toBeNull()
    expect(localStorage.getItem('settings/hearing/active-model')).toBeNull()
    expect(localStorage.getItem('settings/speech/active-provider')).toBeNull()
    expect(localStorage.getItem('settings/speech/active-model')).toBeNull()
    const credentials = JSON.parse(localStorage.getItem('settings/credentials/providers') ?? '{}')
    expect(credentials['openai-compatible']).toBeUndefined()
    expect(credentials['neru-local-proxy']).toBeUndefined()
    expect(credentials['codex-oauth']).toBeUndefined()
    expect(credentials['openai-compatible-audio-transcription']).toBeUndefined()
    expect(credentials['openai-compatible-audio-speech']).toBeUndefined()
  })

  it('lists all provider choices and preserves existing configurations', () => {
    const credentials = {
      'openai-compatible': { apiKey: 'existing-llm-key', baseUrl: 'https://llm.example/v1/', model: 'existing-llm' },
      'openai-compatible-audio-transcription': { apiKey: 'existing-stt-key', baseUrl: 'https://stt.example/v1/', model: 'existing-stt' },
      'openai-compatible-audio-speech': { apiKey: 'existing-tts-key', baseUrl: 'https://tts.example/v1/', model: 'existing-tts' },
    }
    localStorage.setItem('settings/credentials/providers', JSON.stringify(credentials))
    localStorage.setItem('settings/consciousness/active-provider', 'openai-compatible')
    localStorage.setItem('settings/consciousness/active-model', 'existing-model')
    localStorage.setItem('settings/hearing/active-provider', 'openai-compatible-audio-transcription')
    localStorage.setItem('settings/hearing/active-model', 'existing-stt')
    localStorage.setItem('settings/speech/active-provider', 'openai-compatible-audio-speech')
    localStorage.setItem('settings/speech/active-model', 'existing-tts')
    preseedNeruProviders()
    const added = JSON.parse(localStorage.getItem('settings/providers/added')!)
    expect(added).toMatchObject({
      'neru-local-proxy': true,
      'codex-oauth': true,
      'openai-compatible-audio-transcription': true,
      'openai-compatible-audio-speech': true,
    })
    expect(JSON.parse(localStorage.getItem('settings/credentials/providers')!)).toEqual(credentials)
    expect(localStorage.getItem('settings/consciousness/active-provider')).toBe('openai-compatible')
    expect(localStorage.getItem('settings/consciousness/active-model')).toBe('existing-model')
    expect(localStorage.getItem('settings/hearing/active-provider')).toBe('openai-compatible-audio-transcription')
    expect(localStorage.getItem('settings/hearing/active-model')).toBe('existing-stt')
    expect(localStorage.getItem('settings/speech/active-provider')).toBe('openai-compatible-audio-speech')
    expect(localStorage.getItem('settings/speech/active-model')).toBe('existing-tts')
  })
})

describe('preseedNeruProviders — stage model (seed once)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('seeds the witch model and marks the sentinel on first run', () => {
    preseedNeruProviders()
    expect(localStorage.getItem(STAGE_MODEL_KEY)).toBe(NERU_WITCH_PRESET_ID)
    expect(localStorage.getItem(SEEDED_KEY)).toBe('true')
  })

  it('claims the witch over a stale AIRI Hiyori default when the sentinel is unset', () => {
    // AIRI store may have written its 'preset-live2d-1' default before neru first seeds.
    localStorage.setItem(STAGE_MODEL_KEY, 'preset-live2d-1')
    preseedNeruProviders()
    expect(localStorage.getItem(STAGE_MODEL_KEY)).toBe(NERU_WITCH_PRESET_ID)
  })

  it('preserves the user\'s later avatar choice once the sentinel is set', () => {
    localStorage.setItem(SEEDED_KEY, 'true')
    localStorage.setItem(STAGE_MODEL_KEY, 'preset-live2d-2')
    preseedNeruProviders()
    expect(localStorage.getItem(STAGE_MODEL_KEY)).toBe('preset-live2d-2')
  })
})
