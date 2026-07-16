import { useMemoryStore } from '@proj-airi/stage-ui/stores/modules/memory'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { executeRemember } from './memory'

// NOTICE:
// electron-vueuse의 IPC invoke는 window.electron.ipcRenderer에 의존한다.
// 유닛 테스트에서는 실제 IPC 대신 read/write invoke를 스텁으로 주입해 도구 로직만 검증한다.
const reads: string[] = []
const writes: string[] = []
vi.mock('../../../memory-io', () => ({
  readMemoryText: vi.fn(async () => reads.shift() ?? ''),
  writeMemoryText: vi.fn(async (text: string) => { writes.push(text) }),
}))

describe('remember tool', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    reads.length = 0
    writes.length = 0
  })

  it('appends a valid fact and updates the store', async () => {
    reads.push('') // current file empty
    const result = await executeRemember({ category: 'preference', text: 'Likes Factorio' })
    expect(result).toBe('Saved.')
    expect(writes[0]).toContain('## Preferences')
    expect(writes[0]).toContain('- Likes Factorio')
    expect(useMemoryStore().memoryText).toContain('- Likes Factorio')
  })

  it('rejects an unknown category without writing', async () => {
    const result = await executeRemember({ category: 'nope' as any, text: 'x' })
    expect(result.toLowerCase()).toContain('error')
    expect(writes).toHaveLength(0)
  })

  it('rejects empty text without writing', async () => {
    const result = await executeRemember({ category: 'misc', text: '   ' })
    expect(result.toLowerCase()).toContain('error')
    expect(writes).toHaveLength(0)
  })
})
