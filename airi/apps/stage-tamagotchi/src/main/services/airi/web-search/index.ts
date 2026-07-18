// SearXNG 웹 검색을 수행하는 메인 프로세스 서비스 — 렌더러의 webSearch IPC(electronWebSearch)를 처리한다.
// 렌더러가 아니라 메인에서 fetch하는 이유: 자체 호스팅 SearXNG는 CORS 헤더를 주지 않아
// 렌더러(dev localhost:5173 / 패키지 file://)에서 직접 부르면 막힌다. 메인(Node)엔 CORS 제약이 없다.
import type { createContext } from '@moeru/eventa/adapters/electron/main'

import process from 'node:process'

import { defineInvokeHandler } from '@moeru/eventa'

import { electronWebSearch } from '../../../../shared/eventa'
import { searchSearxng } from './searxng'

// SearXNG 접속 주소는 env로 재정의 가능(기본 로컬 Docker Compose 포트).
const BASE_URL = process.env.NERU_SEARXNG_URL ?? 'http://localhost:8888'
const MAX_RESULTS = 5
const SNIPPET_MAX_CHARS = 300
const TIMEOUT_MS = 8000

export function createWebSearchService(params: { context: ReturnType<typeof createContext>['context'] }) {
  defineInvokeHandler(params.context, electronWebSearch, async (payload) => {
    return searchSearxng(payload.query ?? '', {
      baseUrl: BASE_URL,
      maxResults: MAX_RESULTS,
      snippetMaxChars: SNIPPET_MAX_CHARS,
      timeoutMs: TIMEOUT_MS,
    })
  })
}
