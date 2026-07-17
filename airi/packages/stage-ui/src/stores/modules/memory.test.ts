import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useMemoryStore } from './memory'

describe('useMemoryStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('starts empty', () => {
    const store = useMemoryStore()
    expect(store.memoryText).toBe('')
    expect(store.hasMemory).toBe(false)
  })

  it('setMemoryText updates text and hasMemory', () => {
    const store = useMemoryStore()
    store.setMemoryText('# neru\'s memory\n\n## Misc\n- x (2026-07-16)\n')
    expect(store.memoryText).toContain('- x (2026-07-16)')
    expect(store.hasMemory).toBe(true)
  })

  it('hasMemory is false for whitespace-only text', () => {
    const store = useMemoryStore()
    store.setMemoryText('   \n ')
    expect(store.hasMemory).toBe(false)
  })
})
