// Neru의 사용자가 직접 설정하는 로컬 OpenAI 호환 LLM 제공자를 정의한다.
import { createOpenAI } from '@xsai-ext/providers/create'
import { z } from 'zod'

import { defineProvider } from '../registry'

const neruLocalProxyConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
})

type NeruLocalProxyConfig = z.input<typeof neruLocalProxyConfigSchema>

export const providerNeruLocalProxy = defineProvider<NeruLocalProxyConfig>({
  id: 'neru-local-proxy',
  order: 5,
  name: 'Neru Local Proxy',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.neru-local-proxy.title'),
  description: 'A locally hosted OpenAI-compatible LLM endpoint configured by you.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.neru-local-proxy.description'),
  tasks: ['chat'],
  icon: 'i-lobe-icons:openai',

  createProviderConfig: ({ t }) => neruLocalProxyConfigSchema.extend({
    apiKey: neruLocalProxyConfigSchema.shape.apiKey.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.placeholder'),
      type: 'password',
    }),
    baseUrl: neruLocalProxyConfigSchema.shape.baseUrl.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.placeholder'),
    }),
  }),
  createProvider(config) {
    return createOpenAI(config.apiKey ?? '', config.baseUrl)
  },

  validationRequiredWhen(config) {
    return !!config.baseUrl?.trim()
  },
})
