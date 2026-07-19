// @vitest-environment jsdom
import { NERU_WITCH_PRESET_ID } from '@proj-airi/stage-ui/constants/neru-witch'
import { beforeEach, describe, expect, it } from 'vitest'

import { preseedNeruProviders } from './neruPreseed'

const STAGE_MODEL_KEY = 'settings/stage/model'
const SEEDED_KEY = 'neru/stage-model-seeded'

describe('preseedNeruProviders — LLM opt-in', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('does not choose or configure an LLM on a fresh install', () => {
    preseedNeruProviders()
    expect(localStorage.getItem('settings/consciousness/active-provider')).toBeNull()
    expect(localStorage.getItem('settings/consciousness/active-model')).toBeNull()
    const credentials = JSON.parse(localStorage.getItem('settings/credentials/providers')!)
    expect(credentials['neru-local-proxy']).toBeUndefined()
    expect(credentials['codex-oauth']).toBeUndefined()
  })

  it('lists both LLM choices and preserves an existing selection', () => {
    localStorage.setItem('settings/consciousness/active-provider', 'openai-compatible')
    localStorage.setItem('settings/consciousness/active-model', 'existing-model')
    preseedNeruProviders()
    const added = JSON.parse(localStorage.getItem('settings/providers/added')!)
    expect(added).toMatchObject({ 'neru-local-proxy': true, 'codex-oauth': true })
    expect(localStorage.getItem('settings/consciousness/active-provider')).toBe('openai-compatible')
    expect(localStorage.getItem('settings/consciousness/active-model')).toBe('existing-model')
  })

  it('keeps the local STT and TTS preseed', () => {
    preseedNeruProviders()
    expect(localStorage.getItem('settings/hearing/active-provider')).toBe('openai-compatible-audio-transcription')
    expect(localStorage.getItem('settings/speech/active-provider')).toBe('openai-compatible-audio-speech')
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
