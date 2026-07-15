import type { SystemMessage } from '@xsai/shared-chat'

import { EMOTION_PROMPT_LIST } from '../emotions'

function message(prefix: string, suffix: string) {
  return {
    role: 'system',
    content: [
      prefix,
      EMOTION_PROMPT_LIST,
      suffix,
    ].join('\n\n'),
  } satisfies SystemMessage
}

export default message
