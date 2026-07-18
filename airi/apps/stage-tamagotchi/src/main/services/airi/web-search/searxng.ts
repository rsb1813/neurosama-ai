// SearXNG JSON 검색 응답을 다루는 순수 헬퍼 — neru가 쓸 상위 N개 스니펫으로 정규화한다.
import type { ElectronWebSearchResult, SearchResultItem } from '../../../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'

interface SearxngRawResult {
  title?: string
  url?: string
  content?: string
}

// SearXNG 응답에서 유효한 결과만 골라 상위 maxResults개를 {title,url,snippet}로 정규화한다.
// title/url이 비면 버린다. snippet은 content(없으면 '')를 snippetMaxChars 상한으로 자른다.
export function mapSearxngResults(json: unknown, maxResults: number, snippetMaxChars: number): SearchResultItem[] {
  const raw = (json as { results?: unknown })?.results
  const list: SearxngRawResult[] = Array.isArray(raw) ? raw : []
  const items: SearchResultItem[] = []
  for (const r of list) {
    if (items.length >= maxResults)
      break
    const title = (r?.title ?? '').trim()
    const url = (r?.url ?? '').trim()
    if (!title || !url)
      continue
    const content = (r?.content ?? '').trim()
    const snippet = content.length > snippetMaxChars ? `${content.slice(0, snippetMaxChars)}…` : content
    items.push({ title, url, snippet })
  }
  return items
}

export interface SearchSearxngOptions {
  baseUrl: string
  maxResults: number
  snippetMaxChars: number
  timeoutMs: number
}

// SearXNG JSON API를 호출해 상위 N개 결과를 돌려준다. 검색은 선택적 의존성이라 절대 throw하지 않고
// 실패(미기동/타임아웃/비200/깨진 JSON)는 { results: [], error }로 우아하게 반환한다.
export async function searchSearxng(query: string, opts: SearchSearxngOptions): Promise<ElectronWebSearchResult> {
  const q = query.trim()
  if (!q)
    return { results: [], error: 'empty query' }

  try {
    const url = `${opts.baseUrl}/search?q=${encodeURIComponent(q)}&format=json`
    const res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs) })
    if (!res.ok)
      return { results: [], error: `search backend returned ${res.status}` }
    const json = await res.json()
    return { results: mapSearxngResults(json, opts.maxResults, opts.snippetMaxChars) }
  }
  catch (error) {
    return { results: [], error: errorMessageFrom(error) ?? 'web search unavailable' }
  }
}
