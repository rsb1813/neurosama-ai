// 데스크톱 Codex Device OAuth 전송기에 연결되는 자격 증명 없는 제공자를 정의한다.
import type { ChatProvider } from '@xsai-ext/providers/utils'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { z } from 'zod'

import { defineProvider } from '../registry'

const codexOAuthConfigSchema = z.object({})

function createCodexOAuthSentinelProvider(): ChatProvider {
  return {
    chat: () => {
      throw new Error('Codex OAuth 전송기가 준비되지 않았습니다. 데스크톱 앱을 다시 시작하세요.')
    },
  } as ChatProvider
}

export const providerCodexOAuth = defineProvider({
  id: 'codex-oauth',
  order: 6,
  name: 'Codex (OAuth)',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.codex-oauth.title'),
  description: 'Use your Codex account through device OAuth in the desktop app.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.codex-oauth.description'),
  tasks: ['chat'],
  icon: 'i-lobe-icons:openai',
  isAvailableBy: isStageTamagotchi,
  requiresCredentials: false,

  createProviderConfig: () => codexOAuthConfigSchema,
  createProvider() {
    return createCodexOAuthSentinelProvider()
  },
  validationRequiredWhen: () => false,
  extraMethods: {
    listModels: async () => [
      {
        id: 'codex-configured',
        name: 'Codex configured model',
        provider: 'codex-oauth',
        description: 'Uses the model configured in Codex.',
      },
    ],
  },
})
