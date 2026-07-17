// neru가 대화 중 기억할 만한 사실을 MEMORY.md에 기록하는 remember 도구.
import type { MemoryCategory } from '@proj-airi/stage-ui/utils/memory-md'
import type { Tool } from '@xsai/shared-chat'

import { errorMessageFrom } from '@moeru/std'
import { useMemoryStore } from '@proj-airi/stage-ui/stores/modules/memory'
import { appendMemoryToMarkdown, MEMORY_CATEGORIES } from '@proj-airi/stage-ui/utils/memory-md'
import { tool } from '@xsai/tool'
import { z } from 'zod'

import { readMemoryText, writeMemoryText } from '../../../memory-io'

const rememberParams = z.object({
  category: z.enum(MEMORY_CATEGORIES).describe('identity = who the user is; preference = likes/how they want things; context = ongoing work/situation; misc = anything else durable'),
  text: z.string().describe('The durable fact to remember, phrased as a short standalone sentence.'),
})

// 한 턴에 remember가 여러 번 호출되면 xsai stream-text가 tool call을 Promise.all로 동시 실행한다
// (node_modules/@xsai/stream-text dist/index.js:138). 각 호출의 read-append-write가 겹치면 lost update가
// 나므로, 모듈 레벨 프로미스 체인으로 read-modify-write를 직렬화한다. (chat 창이 유일한 writer.)
let writeChain: Promise<unknown> = Promise.resolve()

// 도구 로직 본체 — 테스트가 직접 부른다(IPC 래퍼는 memory-io에서 모킹).
export async function executeRemember(input: { category: MemoryCategory, text: string }): Promise<string> {
  if (!MEMORY_CATEGORIES.includes(input.category))
    return `error: unknown category "${input.category}"`
  if (!input.text || input.text.trim().length === 0)
    return 'error: empty memory text'

  const run = async () => {
    const existing = await readMemoryText()
    const date = new Date().toISOString().slice(0, 10)
    const next = appendMemoryToMarkdown(existing, { category: input.category, text: input.text }, date)
    await writeMemoryText(next)
    useMemoryStore().setMemoryText(next)
    return 'Saved.'
  }

  // 이전 append가 settle된 뒤 실행되도록 체인에 잇는다. 실패해도 다음 호출이 막히지 않게 체인은 settle만 기다린다.
  const result = writeChain.then(run, run)
  writeChain = result.then(() => undefined, () => undefined)
  try {
    return await result
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
