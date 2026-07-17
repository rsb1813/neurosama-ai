// SearXNG JSON 검색 응답을 다루는 순수 헬퍼 — neru가 쓸 상위 N개 스니펫으로 정규화한다.
import type { SearchResultItem } from '../../../../shared/eventa'

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
