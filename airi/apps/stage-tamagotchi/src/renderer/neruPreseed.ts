// AIRI provider를 로컬 서비스로 프리시드 — 온보딩 없이 LLM(3456)·STT/TTS(3457) 연결
// 첫 실행 시 localStorage가 비어 있을 때만 기록해 사용자 편집을 덮어쓰지 않는다.
//
// VueUse useLocalStorage는 기본값 타입으로 직렬화기를 고른다(guessSerializerType).
// 문자열 기본값('')은 raw 직렬화기(read/write가 값을 그대로 통과)라, 문자열을
// JSON.stringify로 저장하면 따옴표가 값 안에 박혀("openai-compatible") provider·model
// id 조회가 전부 어긋난다. 따라서 문자열은 raw로 기록하고, object·boolean만 JSON으로
// 기록한다(각각 object/boolean 직렬화기의 JSON.parse·"true" 판정과 일치).
function seed(key: string, value: unknown): void {
  if (localStorage.getItem(key) !== null)
    return
  localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
}

export function preseedNeruProviders(): void {
  const LLM = 'openai-compatible'
  const STT = 'openai-compatible-audio-transcription'
  const TTS = 'openai-compatible-audio-speech'

  // neru-audio 게이트웨이가 이 값을 Authorization: Bearer 토큰으로 검증한다 — 다른 값을
  // 쓰려면 게이트웨이의 NERU_API_KEY도 함께 맞춰야 한다.
  seed('settings/credentials/providers', {
    [LLM]: { apiKey: 'sk-local-proxy', baseUrl: 'http://localhost:3456/v1/' },
    [STT]: { apiKey: 'sk-local-proxy', baseUrl: 'http://localhost:3457/v1/' },
    [TTS]: { apiKey: 'sk-local-proxy', baseUrl: 'http://localhost:3457/v1/' },
  })
  seed('settings/providers/added', { [LLM]: true, [STT]: true, [TTS]: true })

  // 각 모듈이 프리시드된 provider를 가리키게(모델명은 게이트웨이가 무시).
  seed('settings/consciousness/active-provider', LLM)
  seed('settings/consciousness/active-model', 'claude-opus-4-7')
  seed('settings/hearing/active-provider', STT)
  seed('settings/hearing/active-model', 'large-v3')
  seed('settings/speech/active-provider', TTS)
  seed('settings/speech/active-model', 'chatterbox')

  // 온보딩 위저드 건너뛰기.
  seed('onboarding/completed', true)
}
