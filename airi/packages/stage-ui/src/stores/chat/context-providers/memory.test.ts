import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useMemoryStore } from '../../modules/memory'
import { createMemoryContext } from './memory'

describe('createMemoryContext', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('returns null when memory is empty', () => {
    expect(createMemoryContext()).toBeNull()
  })

  it('returns a ContextMessage with the rendered memory when present', () => {
    useMemoryStore().setMemoryText('# neru\'s memory\n\n## Identity\n- The user builds neru (2026-07-16)\n')
    const ctx = createMemoryContext()
    expect(ctx).not.toBeNull()
    expect(ctx!.contextId).toBe('system:neru-memory')
    expect(ctx!.text).toContain('What you remember about the user')
    expect(ctx!.text).toContain('- The user builds neru (2026-07-16)')
    expect(typeof ctx!.id).toBe('string')
    expect(typeof ctx!.createdAt).toBe('number')
  })
})
