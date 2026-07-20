// AIRI provider 선택지를 등록하고 Neru 고유 설정을 프리시드한다.
//
// provider의 활성 선택과 자격 증명은 사용자 소유 설정으로 보존한다. provider 선택지 카탈로그만
// 기존 항목을 보존한 채 Neru 항목을 병합한다.
//
// onboarding, expression, stage model, Neru card는 Neru 고유 설정으로 기존 동작을 유지한다.

import { NERU_SYSTEM_PROMPT } from '@proj-airi/stage-ui/constants/neru-persona'
import { NERU_WITCH_PRESET_ID } from '@proj-airi/stage-ui/constants/neru-witch'

// 스칼라 설정 키를 raw 문자열로 기록한다.
// VueUse useLocalStorage의 문자열('')·불리언 직렬화기는 값을 raw로 저장하므로
// 문자열을 그대로 기록한다(불리언 키는 'true'/'false' 문자열과 일치).
function assertRaw(key: string, value: string): void {
  localStorage.setItem(key, value)
}

// 여러 provider가 공유하는 객체 키 — 기존 카탈로그를 보존하고 우리 항목만 병합한다.
function mergeObject(key: string, partial: Record<string, unknown>): void {
  let current: Record<string, unknown> = {}
  const existing = localStorage.getItem(key)
  if (existing) {
    try {
      current = JSON.parse(existing) as Record<string, unknown>
    }
    catch {
      // 손상된 값이면 무시하고 우리 항목만으로 재구성한다.
      current = {}
    }
  }
  localStorage.setItem(key, JSON.stringify({ ...current, ...partial }))
}

// airi-cards는 VueUse Map 직렬화(엔트리 배열의 JSON)를 쓴다 — neru 카드를 그 형식으로
// 넣고 기존 카드는 보존한다. 활성 카드도 neru로 단언한다.
function assertNeruCard(systemPrompt: string): void {
  const key = 'airi-cards'
  let entries: [string, unknown][] = []
  const existing = localStorage.getItem(key)
  if (existing) {
    try {
      entries = JSON.parse(existing) as [string, unknown][]
      if (!Array.isArray(entries))
        entries = []
    }
    catch {
      entries = []
    }
  }
  const neruCard = {
    name: 'neru',
    version: '1.0.0',
    description: '',
    personality: '',
    systemPrompt,
    extensions: { airi: { modules: {} } },
  }
  const next = entries.filter(([id]) => id !== 'neru')
  next.push(['neru', neruCard])
  localStorage.setItem(key, JSON.stringify(next))
}

export function preseedNeruProviders(): void {
  const STT = 'openai-compatible-audio-transcription'
  const TTS = 'openai-compatible-audio-speech'

  // provider의 실제 구성은 사용자가 결정하고, 여기서는 선택지로만 노출한다.
  mergeObject('settings/providers/added', {
    'neru-local-proxy': true,
    'codex-oauth': true,
    [STT]: true,
    [TTS]: true,
  })

  // 온보딩 위저드 건너뛰기.
  assertRaw('onboarding/completed', 'true')

  // neru는 감정을 표정으로 드러내는 아바타라 Live2D 표정 시스템을 항상 켠다. AIRI 기본값은
  // false인데, 꺼져 있으면 모델의 exp3 표정이 스토어에 등록조차 되지 않아 감정→표정 배선이
  // 무력화된다(스칼라 기능 키라 provider 키처럼 매 기동 단언한다).
  assertRaw('settings/live2d/expression-enabled', 'true')

  // 제거된 성능 프리시드가 기록한 값만 AIRI 기본값으로 되돌린다. 이후 사용자 변경은 보존한다.
  if (localStorage.getItem('neru/live2d-performance-seeded')) {
    const currentMaxFps = localStorage.getItem('settings/live2d/max-fps')
    const currentRenderScale = localStorage.getItem('settings/live2d/render-scale')
    if (currentMaxFps === '30')
      assertRaw('settings/live2d/max-fps', '0')
    if (currentRenderScale === '1')
      assertRaw('settings/live2d/render-scale', '2')
    localStorage.removeItem('neru/live2d-performance-seeded')
  }

  // neru의 기본 아바타를 마녀 모델로 최초 1회만 시드한다 — 이후 사용자가 UI에서 바꾼 선택을 존중한다.
  // 대상 키(settings/stage/model)는 AIRI 스토어가 Hiyori 기본값을 써버려 "없을 때만" 판정이
  // 무력화되므로, 우리만 쓰는 별도 센티넬 키로 최초 1회 여부를 판정한다.
  if (!localStorage.getItem('neru/stage-model-seeded')) {
    assertRaw('settings/stage/model', NERU_WITCH_PRESET_ID)
    assertRaw('neru/stage-model-seeded', 'true')
  }

  assertNeruCard(NERU_SYSTEM_PROMPT)
  assertRaw('airi-card-active-id', 'neru')
}
