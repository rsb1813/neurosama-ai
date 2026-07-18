// neru가 웹을 검색하는 webSearch 도구 — SearXNG 결과를 LLM이 읽을 텍스트로 돌려준다.
import type { Tool } from '@xsai/shared-chat'

import type { ElectronWebSearchResult } from '../../../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'
import { tool } from '@xsai/tool'
import { z } from 'zod'

import { searchWeb } from '../../../web-search-io'

const webSearchParams = z.object({
  query: z.string().describe('The web search query, phrased as a concise search string (English is fine).'),
})

// 검색 결과를 LLM이 읽을 짧은 텍스트로 만든다. 에러/무결과도 사람이 읽을 문장으로 반환(도구는 throw 금지).
export function formatSearchResults(result: ElectronWebSearchResult): string {
  if (result.error)
    return `Web search could not run right now (${result.error}). Tell the user you can't search at the moment.`
  if (result.results.length === 0)
    return 'Web search returned no results for that query.'
  const lines = result.results.map((r, i) => `${i + 1}. ${r.title} — ${r.snippet} (${r.url})`)
  return `Web search results:\n${lines.join('\n')}`
}

// 도구 로직 본체 — 테스트가 직접 부른다(IPC 래퍼 searchWeb은 모킹).
export async function executeWebSearch(input: { query: string }): Promise<string> {
  // 도구는 절대 throw하면 안 된다(자기완결). 도구콜 인자는 zod로 검증되지 않은 채 들어오므로
  // query가 문자열이 아닐 수도 있다 — 그 경우 빈 쿼리로 취급한다(.trim() TypeError 방지).
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (query.length === 0)
    return 'error: empty search query'
  try {
    const result = await searchWeb(query)
    return formatSearchResults(result)
  }
  catch (error) {
    // IPC 자체 실패도 크래시 없이 문장으로. (SearXNG 오류는 서비스가 이미 error 필드로 처리)
    return `Web search could not run right now (${errorMessageFrom(error) ?? 'unavailable'}). Tell the user you can't search at the moment.`
  }
}

const tools: Promise<Tool>[] = [
  tool({
    name: 'webSearch',
    description: 'Search the web for current or unknown information and get back a short list of result snippets. Use when you are unsure, need up-to-date facts, or the user asks you to look something up. It is fine not to call this when you already know the answer.',
    execute: executeWebSearch,
    parameters: webSearchParams,
  }),
]

export const webSearchTools = async () => Promise.all(tools)
