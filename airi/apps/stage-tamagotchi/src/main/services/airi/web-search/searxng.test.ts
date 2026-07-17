import { describe, expect, it } from 'vitest'

import { mapSearxngResults } from './searxng'

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
