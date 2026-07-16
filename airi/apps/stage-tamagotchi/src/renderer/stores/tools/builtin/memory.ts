// neru가 대화 중 기억할 만한 사실을 MEMORY.md에 기록하는 remember 도구.
import type { MemoryCategory } from '@proj-airi/stage-ui/utils/memory-md'
import type { Tool } from '@xsai/shared-chat'

import { errorMessageFrom } from '@moeru/std'
import { useMemoryStore } from '@proj-airi/stage-ui/stores/modules/memory'
import { appendMemoryToMarkdown } from '@proj-airi/stage-ui/utils/memory-md'
import { tool } from '@xsai/tool'
import { z } from 'zod'

import { readMemoryText, writeMemoryText } from '../../../memory-io'

const CATEGORIES = ['identity', 'preference', 'context', 'misc'] as const

const rememberParams = z.object({
  category: z.enum(CATEGORIES).describe('identity = who the user is; preference = likes/how they want things; context = ongoing work/situation; misc = anything else durable'),
  text: z.string().describe('The durable fact to remember, phrased as a short standalone sentence.'),
})

// 도구 로직 본체 — 테스트가 직접 부른다(IPC 래퍼는 memory-io에서 모킹).
export async function executeRemember(input: { category: MemoryCategory, text: string }): Promise<string> {
  if (!CATEGORIES.includes(input.category))
    return `error: unknown category "${input.category}"`
  if (!input.text || input.text.trim().length === 0)
    return 'error: empty memory text'

  try {
    const existing = await readMemoryText()
    const date = new Date().toISOString().slice(0, 10)
    const next = appendMemoryToMarkdown(existing, { category: input.category, text: input.text }, date)
    await writeMemoryText(next)
    useMemoryStore().setMemoryText(next)
    return 'Saved.'
  }
  catch (error) {
    return `error: ${errorMessageFrom(error) ?? 'failed to save memory'}`
  }
}

const tools: Promise<Tool>[] = [
  tool({
    name: 'remember',
    description: 'Save a durable, significant fact about the user or the ongoing world to long-term memory so you recall it in future sessions. Use ONLY for lasting facts (identity, preferences, ongoing context) — never for small talk or transient state. It is fine to not call this at all in a turn.',
    execute: executeRemember,
    parameters: rememberParams,
  }),
]

export const memoryTools = async () => Promise.all(tools)
