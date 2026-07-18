import { afterEach, describe, expect, it, vi } from 'vitest'

import { mapSearxngResults, searchSearxng } from './searxng'

describe('mapSearxngResults', () => {
  it('maps title/url/content and caps the count', () => {
    const json = {
      results: [
        { title: 'A', url: 'https://a.example', content: 'alpha' },
        { title: 'B', url: 'https://b.example', content: 'beta' },
        { title: 'C', url: 'https://c.example', content: 'gamma' },
      ],
    }
    const out = mapSearxngResults(json, 2, 300)
    expect(out).toEqual([
      { title: 'A', url: 'https://a.example', snippet: 'alpha' },
      { title: 'B', url: 'https://b.example', snippet: 'beta' },
    ])
  })

  it('returns [] when results is missing or not an array', () => {
    expect(mapSearxngResults({}, 5, 300)).toEqual([])
    expect(mapSearxngResults({ results: null }, 5, 300)).toEqual([])
    expect(mapSearxngResults('not json', 5, 300)).toEqual([])
  })

  it('skips items missing a title or url', () => {
    const json = { results: [
      { title: '', url: 'https://x', content: 'c' },
      { title: 'ok', url: '', content: 'c' },
      { title: 'good', url: 'https://good', content: 'c' },
    ] }
    expect(mapSearxngResults(json, 5, 300)).toEqual([{ title: 'good', url: 'https://good', snippet: 'c' }])
  })

  it('truncates snippet to snippetMaxChars with an ellipsis', () => {
    const json = { results: [{ title: 't', url: 'https://u', content: 'x'.repeat(50) }] }
    const [item] = mapSearxngResults(json, 5, 10)
    expect(item.snippet).toBe(`${'x'.repeat(10)}…`)
  })

  it('tolerates missing content (empty snippet)', () => {
    const json = { results: [{ title: 't', url: 'https://u' }] }
    expect(mapSearxngResults(json, 5, 300)).toEqual([{ title: 't', url: 'https://u', snippet: '' }])
  })
})

const OPTS = { baseUrl: 'http://localhost:8888', maxResults: 5, snippetMaxChars: 300, timeoutMs: 8000 }

describe('searchSearxng', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns mapped results on a 200 JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ title: 'T', url: 'https://u', content: 'c' }] }),
    })))
    const out = await searchSearxng('cats', OPTS)
    expect(out).toEqual({ results: [{ title: 'T', url: 'https://u', snippet: 'c' }] })
  })

  it('returns an error (no throw) on a non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })))
    const out = await searchSearxng('cats', OPTS)
    expect(out.results).toEqual([])
    expect(out.error).toContain('502')
  })

  it('returns an error (no throw) when fetch rejects (SearXNG down / timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }))
    const out = await searchSearxng('cats', OPTS)
    expect(out.results).toEqual([])
    expect(out.error).toBeTruthy()
  })

  it('returns an error (no throw) on malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error('bad json') },
    })))
    const out = await searchSearxng('cats', OPTS)
    expect(out.results).toEqual([])
    expect(out.error).toBeTruthy()
  })

  it('returns an error for an empty query without calling fetch', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const out = await searchSearxng('   ', OPTS)
    expect(out.error).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
  })
})
