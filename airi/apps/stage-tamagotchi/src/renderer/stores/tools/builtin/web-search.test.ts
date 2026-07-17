import { beforeEach, describe, expect, it, vi } from 'vitest'

import { searchWeb } from '../../../web-search-io'
import { executeWebSearch, formatSearchResults } from './web-search'

vi.mock('../../../web-search-io', () => ({ searchWeb: vi.fn() }))

const mockedSearchWeb = vi.mocked(searchWeb)

describe('formatSearchResults', () => {
  it('formats a numbered list of title — snippet (url)', () => {
    const text = formatSearchResults({ results: [
      { title: 'Cats', url: 'https://cats.example', snippet: 'about cats' },
      { title: 'Dogs', url: 'https://dogs.example', snippet: 'about dogs' },
    ] })
    expect(text).toContain('1. Cats — about cats (https://cats.example)')
    expect(text).toContain('2. Dogs — about dogs (https://dogs.example)')
  })

  it('reports unavailability when there is an error', () => {
    expect(formatSearchResults({ results: [], error: 'boom' })).toMatch(/could not|unavailable/i)
  })

  it('reports no results when the list is empty and there is no error', () => {
    expect(formatSearchResults({ results: [] })).toMatch(/no results/i)
  })
})

describe('executeWebSearch', () => {
  // NOTICE:
  // vi.fn().mockReset()는 mock 함수 자신을 반환한다. beforeEach 화살표 함수를 축약형으로 쓰면
  // 그 반환값이 훅의 결과값이 되는데, Vitest 4.1.4의 훅 러너(@vitest/runner dist/chunk-artifact.js
  // withTimeout/withCancel)가 이 경우 뒤이은 mockRejectedValue reject를 정상적으로 catch했음에도
  // "unhandled" 오류로 오탐 처리해 다음 테스트를 실패시키는 것을 격리 재현으로 확인했다(2026-07-17).
  // 훅이 undefined를 반환하도록 블록 바디로 감싸면 오탐이 사라진다.
  // 제거 조건: Vitest가 이 훅 반환값 처리 버그를 고치면 축약형으로 되돌려도 된다.
  beforeEach(() => {
    mockedSearchWeb.mockReset()
  })

  it('returns an error string for an empty query without searching', async () => {
    const out = await executeWebSearch({ query: '  ' })
    expect(out).toMatch(/error/i)
    expect(mockedSearchWeb).not.toHaveBeenCalled()
  })

  it('returns formatted results on success', async () => {
    mockedSearchWeb.mockResolvedValue({ results: [{ title: 'T', url: 'https://u', snippet: 's' }] })
    const out = await executeWebSearch({ query: 'cats' })
    expect(out).toContain('1. T — s (https://u)')
  })

  it('never throws — returns a graceful string when the IPC call rejects', async () => {
    mockedSearchWeb.mockRejectedValue(new Error('ipc down'))
    const out = await executeWebSearch({ query: 'cats' })
    expect(out).toMatch(/could not|unavailable|error/i)
  })
})
