import { useMemoryStore } from '@proj-airi/stage-ui/stores/modules/memory'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { executeRemember } from './memory'

// NOTICE:
// electron-vueuse의 IPC invoke는 window.electron.ipcRenderer에 의존한다.
// 유닛 테스트에서는 실제 IPC 대신 read/write invoke를 스텁으로 주입해 도구 로직만 검증한다.
//
// remember의 read-modify-write 직렬화를 검증하려면 2번째 read가 1번째 write를 봐야 한다.
// 큐 기반 목으로는 표현할 수 없어 파일을 stateful 하게 흉내낸다.
let fileState = ''
const writes: string[] = []
vi.mock('../../../memory-io', () => ({
  readMemoryText: vi.fn(async () => fileState),
  writeMemoryText: vi.fn(async (text: string) => {
    fileState = text
    writes.push(text)
  }),
}))

describe('remember tool', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fileState = ''
    writes.length = 0
  })

  it('appends a valid fact and updates the store', async () => {
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

  // ROOT CAUSE: xsai stream-text runs a round's tool calls via Promise.all (dist/index.js:138),
  // so two remember() calls in one turn ran read-append-write concurrently against the same base
  // text and the later write clobbered the earlier bullet (lost update). Serializing the RMW on a
  // module-level chain fixes it. This test fails on the pre-fix (un-serialized) code.
  it('serializes concurrent remember calls so both facts persist', async () => {
    const [r1, r2] = await Promise.all([
      executeRemember({ category: 'preference', text: 'likes factorio' }),
      executeRemember({ category: 'context', text: 'streams tuesdays' }),
    ])
    expect(r1).toBe('Saved.')
    expect(r2).toBe('Saved.')
    expect(fileState).toContain('likes factorio')
    expect(fileState).toContain('streams tuesdays')
  })
})
