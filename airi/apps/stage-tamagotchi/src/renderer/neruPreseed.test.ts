// @vitest-environment jsdom
import { NERU_WITCH_PRESET_ID } from '@proj-airi/stage-ui/constants/neru-witch'
import { beforeEach, describe, expect, it } from 'vitest'

import { preseedNeruProviders } from './neruPreseed'

const STAGE_MODEL_KEY = 'settings/stage/model'
const SEEDED_KEY = 'neru/stage-model-seeded'

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
