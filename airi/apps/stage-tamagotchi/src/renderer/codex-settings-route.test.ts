// 데스크톱의 기존 채팅 제공자 경로가 Codex OAuth 전용 설정 카드를 사용하는지 검증한다.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('desktop Codex OAuth provider route', () => {
  it('renders the dedicated OAuth settings instead of the generic API key form', () => {
    const source = readFileSync(new URL('../../../../packages/stage-pages/src/pages/settings/providers/chat/[providerId].vue', import.meta.url), 'utf8')

    expect(source).toContain("import CodexOAuthProviderSettings from '../../../../components/settings/CodexOAuthProviderSettings.vue'")
    expect(source).toContain('<CodexOAuthProviderSettings v-if="providerId === \'codex-oauth\'" />')
    expect(source).toContain('<template v-else>')
  })
})
