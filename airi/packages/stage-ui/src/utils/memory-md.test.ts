import { describe, expect, it } from 'vitest'

import { appendMemoryToMarkdown, renderMemoryContext } from './memory-md'

describe('appendMemoryToMarkdown', () => {
  it('creates the file scaffold and section when empty', () => {
    const out = appendMemoryToMarkdown('', { category: 'preference', text: 'Likes Factorio' }, '2026-07-16')
    expect(out).toContain('# neru\'s memory')
    expect(out).toContain('## Preferences')
    expect(out).toContain('- Likes Factorio (2026-07-16)')
  })

  it('appends under the existing section, not a duplicate section', () => {
    const existing = '# neru\'s memory\n\n## Preferences\n- Likes Factorio (2026-07-16)\n'
    const out = appendMemoryToMarkdown(existing, { category: 'preference', text: 'Streams Tuesdays' }, '2026-07-16')
    expect(out.match(/## Preferences/g)).toHaveLength(1)
    expect(out).toContain('- Likes Factorio (2026-07-16)')
    expect(out).toContain('- Streams Tuesdays (2026-07-16)')
  })

  it('skips an exact duplicate bullet (case-insensitive, trimmed) in the same section', () => {
    const existing = '# neru\'s memory\n\n## Identity\n- The user builds neru (2026-07-16)\n'
    const out = appendMemoryToMarkdown(existing, { category: 'identity', text: '  the user builds neru  ' }, '2026-07-17')
    expect(out.match(/- .*builds neru/gi)).toHaveLength(1)
  })

  it('routes each category to its own section header', () => {
    let out = appendMemoryToMarkdown('', { category: 'identity', text: 'a' }, '2026-07-16')
    out = appendMemoryToMarkdown(out, { category: 'context', text: 'b' }, '2026-07-16')
    out = appendMemoryToMarkdown(out, { category: 'misc', text: 'c' }, '2026-07-16')
    expect(out).toContain('## Identity')
    expect(out).toContain('## Context')
    expect(out).toContain('## Misc')
  })
})

describe('renderMemoryContext', () => {
  it('returns empty string for empty/whitespace memory', () => {
    expect(renderMemoryContext('', 4000)).toBe('')
    expect(renderMemoryContext('   \n  ', 4000)).toBe('')
  })

  it('wraps memory text in a recall header when present', () => {
    const out = renderMemoryContext('# neru\'s memory\n\n## Identity\n- x (2026-07-16)\n', 4000)
    expect(out).toContain('What you remember about the user and this world')
    expect(out).toContain('- x (2026-07-16)')
  })

  it('truncates to the budget and marks truncation', () => {
    const big = `# neru's memory\n\n## Misc\n${Array.from({ length: 500 }, (_, i) => `- fact ${i}`).join('\n')}`
    const out = renderMemoryContext(big, 200)
    expect(out.length).toBeLessThanOrEqual(200 + 90) // header + truncation note allowance
    expect(out).toContain('(memory truncated)')
  })
})
