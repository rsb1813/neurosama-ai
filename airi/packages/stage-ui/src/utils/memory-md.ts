// neru 장기기억 MEMORY.md 마크다운을 다루는 순수 헬퍼 (섹션별 append·중복제거·회상 렌더링)

export type MemoryCategory = 'identity' | 'preference' | 'context' | 'misc'

// 카테고리 → 섹션 헤더 표기. 파일은 이 순서로 섹션을 유지한다.
const SECTION_TITLE: Record<MemoryCategory, string> = {
  identity: 'Identity',
  preference: 'Preferences',
  context: 'Context',
  misc: 'Misc',
}

const FILE_HEADER = '# neru\'s memory'

function bulletBody(line: string): string {
  // "- text (date)" 에서 앞의 "- " 와 뒤의 " (date)" 를 벗겨 본문만 비교용으로 추출.
  const withoutDash = line.replace(/^\s*-\s*/, '')
  return withoutDash.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase()
}

/**
 * MEMORY.md 텍스트에 사실 하나를 append 한다.
 * - 파일/헤더/섹션이 없으면 만든다.
 * - 같은 섹션에 (대소문자·공백 무시) 동일 본문 불릿이 있으면 건너뛴다.
 */
export function appendMemoryToMarkdown(
  existing: string,
  entry: { category: MemoryCategory, text: string },
  date: string,
): string {
  const title = SECTION_TITLE[entry.category]
  const newBody = entry.text.trim().toLowerCase()
  const newBullet = `- ${entry.text.trim()} (${date})`

  const base = existing.trim().length > 0 ? existing.replace(/\s*$/, '') : FILE_HEADER
  const lines = base.split('\n')

  const sectionHeader = `## ${title}`
  const headerIdx = lines.findIndex(l => l.trim() === sectionHeader)

  if (headerIdx === -1) {
    // 섹션이 없으면 파일 끝에 새 섹션 + 불릿을 붙인다.
    return `${lines.join('\n')}\n\n${sectionHeader}\n${newBullet}\n`
  }

  // 섹션 범위(다음 '## ' 헤더 전까지)에서 중복 본문 확인.
  let end = headerIdx + 1
  while (end < lines.length && !lines[end].startsWith('## ')) end++
  const sectionLines = lines.slice(headerIdx + 1, end)
  const duplicate = sectionLines.some(l => l.trim().startsWith('-') && bulletBody(l) === newBody)
  if (duplicate)
    return `${lines.join('\n')}\n`

  // 섹션 마지막 불릿 뒤에 삽입.
  lines.splice(end, 0, newBullet)
  return `${lines.join('\n')}\n`
}

/**
 * MEMORY.md 텍스트를 회상용 컨텍스트 블록으로 렌더한다.
 * 비어 있으면 '' 를 반환하고(주입 no-op), budgetChars 초과 시 잘라 표시한다.
 */
export function renderMemoryContext(memoryText: string, budgetChars: number): string {
  const trimmed = memoryText.trim()
  if (trimmed.length === 0)
    return ''

  const header = 'What you remember about the user and this world (from past sessions):'
  let body = trimmed
  if (body.length > budgetChars)
    body = `${body.slice(0, budgetChars)}\n(memory truncated)`

  return `${header}\n${body}`
}
