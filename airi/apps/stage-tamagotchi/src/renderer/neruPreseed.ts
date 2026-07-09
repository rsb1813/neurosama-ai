// AIRI provider를 로컬 서비스로 프리시드 — 온보딩 없이 LLM(3456)·STT/TTS(3457) 연결
// 첫 실행 시 localStorage가 비어 있을 때만 기록해 사용자 편집을 덮어쓰지 않는다.
function seed(key: string, value: unknown): void {
  if (localStorage.getItem(key) === null)
    localStorage.setItem(key, JSON.stringify(value))
}

export function preseedNeruProviders(): void {
  const LLM = 'openai-compatible'
  const STT = 'openai-compatible-audio-transcription'
  const TTS = 'openai-compatible-audio-speech'

  // 게이트웨이·프록시는 apiKey를 검사하지 않지만 스키마상 필요 → 더미.
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
