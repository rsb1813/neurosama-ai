// neru 장기기억(MEMORY.md)을 매 턴 프롬프트에 주입하는 회상 context provider (동기).
import type { ContextMessage } from '../../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

import { renderMemoryContext } from '../../../utils/memory-md'
import { useMemoryStore } from '../../modules/memory'

const MEMORY_CONTEXT_ID = 'system:neru-memory'
// 주입 상한(문자). MEMORY.md가 커져도 프롬프트를 넘치지 않게 자른다.
const MEMORY_BUDGET_CHARS = 4000

export function createMemoryContext(): ContextMessage | null {
  const memoryStore = useMemoryStore()
  if (!memoryStore.hasMemory)
    return null

  const text = renderMemoryContext(memoryStore.memoryText, MEMORY_BUDGET_CHARS)
  if (text.length === 0)
    return null

  return {
    id: nanoid(),
    contextId: MEMORY_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text,
    createdAt: Date.now(),
  }
}
