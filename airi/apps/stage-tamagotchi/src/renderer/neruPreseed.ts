// AIRI provider를 로컬 서비스로 프리시드 — 온보딩 없이 LLM(3456)·STT/TTS(3457) 연결
//
// neru는 로컬 스택만 가리키는 단일 목적 어플라이언스라 이 키들은 neru 소유 설정으로
// 취급해 매 기동 시 authoritative하게 단언한다. 초기 구현은 "값이 없을 때만" 기록했으나,
// 이 방식은 dev localStorage에 AIRI 기본값(빈 active-provider, speech="speech-noop",
// 우리 provider가 빠진 added/credentials 카탈로그)이 이미 박혀 있으면 전부 건너뛰어
// 프리시드가 무력화된다(실측 확인). 따라서 스칼라 키는 덮어쓰고, 여러 provider가
// 공유하는 객체(credentials/added)는 기존 카탈로그를 보존한 채 우리 항목만 병합한다.
//
// 트레이드오프: active-provider를 매번 단언하므로 사용자가 UI에서 provider를 바꿔도
// 다음 기동에 로컬 스택으로 되돌아간다 — 어플라이언스 성격상 의도된 동작이다.

// 스칼라 설정 키 — 로컬 스택 지정을 매 기동 단언한다.
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

export function preseedNeruProviders(): void {
  const LLM = 'openai-compatible'
  const STT = 'openai-compatible-audio-transcription'
  const TTS = 'openai-compatible-audio-speech'

  // neru-audio 게이트웨이가 apiKey를 Authorization: Bearer 토큰으로 검증한다 — 다른 값을
  // 쓰려면 게이트웨이의 NERU_API_KEY도 함께 맞춰야 한다. model은 hearing/speech 스토어의
  // configured 판정이 참조하므로 provider 설정에도 함께 넣는다(게이트웨이는 무시).
  mergeObject('settings/credentials/providers', {
    [LLM]: { apiKey: 'sk-local-proxy', baseUrl: 'http://localhost:3456/v1/', model: 'claude-opus-4-7' },
    [STT]: { apiKey: 'sk-local-proxy', baseUrl: 'http://localhost:3457/v1/', model: 'large-v3' },
    [TTS]: { apiKey: 'sk-local-proxy', baseUrl: 'http://localhost:3457/v1/', model: 'chatterbox' },
  })
  mergeObject('settings/providers/added', { [LLM]: true, [STT]: true, [TTS]: true })

  // 각 모듈이 프리시드된 provider를 가리키게(모델명은 게이트웨이가 무시).
  assertRaw('settings/consciousness/active-provider', LLM)
  assertRaw('settings/consciousness/active-model', 'claude-opus-4-7')
  assertRaw('settings/hearing/active-provider', STT)
  assertRaw('settings/hearing/active-model', 'large-v3')
  assertRaw('settings/speech/active-provider', TTS)
  assertRaw('settings/speech/active-model', 'chatterbox')

  // 온보딩 위저드 건너뛰기.
  assertRaw('onboarding/completed', 'true')
}
