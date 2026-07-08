# neru MVP 체크리스트 — 실시간 음성 대화 코어

로드맵과 상세는 `.meridian/plans/neru-mvp-voice-core.md` 참조.

## 마일스톤 1 — 골격 + provider 인터페이스
- [x] 이벤트/데이터 타입 정의 (`events.py`: State, SpeechStarted, Transcript, ReplyChunk, Shutdown)
- [x] provider 추상 인터페이스 (STT/LLM/TTS/Avatar base) + OutputSink 프로토콜
- [x] 오케스트레이터: 턴테이킹 상태머신 + barge-in + graceful shutdown
- [x] mock 구현체 (ScriptedSTT, EchoLLM, SilentTTS, LoggingAvatar, ConsoleSink)
- [x] 데모 엔트리포인트 `main.py` — mock으로 파이프라인 한 바퀴
- [x] 단위 테스트 (정상 경로 + barge-in) — 통과
- [x] uv 프로젝트/README/.gitignore/.env.example

## 마일스톤 2 — 로컬 STT 실동작
- [ ] RealtimeSTT 또는 faster-whisper 한국어 스트리밍 구현 (`stt/whisper_local.py`)
- [ ] 마이크 입력 + Silero VAD로 SpeechStarted/Transcript 발행
- [ ] 검증: 마이크 한국어 발화 → 한국어 텍스트 전사(로그)

## 마일스톤 3 — Claude LLM 연결 ✅
- [x] `config.py`: env 기반 설정(프록시 base_url/모델/키)
- [x] `persona.py`: neru 시스템 프롬프트(한국어 이해·영어 답변, 문장별 EN:/KO: 형식)
- [x] `llm/claude.py`: AsyncAnthropic(base_url=프록시), 스트리밍 EN/KO 파싱 → ReplyChunk
- [x] Claude 모델 ID는 `claude-api` 스킬로 확인 + 프록시 /v1/models로 실측(opus-4-8 없음 → opus-4-7)
- [x] 검증: `scripts/probe_llm.py`로 한국어 입력 → 영어답변+한국어자막 6청크 스트리밍, 페르소나 반영 확인

## 마일스톤 4 — 로컬 TTS (Chatterbox) ✅
- [x] 엔진 선정: Chatterbox(MIT·5초 제로샷 복제·영어 SOTA·5080 구동). 대안 XTTSv2 기각(비상업 라이선스)
- [x] RTX 5080(Blackwell/sm_120) CUDA 휠 호환성 확인: torch 2.9.0+cu128 sm_120 인식, GPU 커널 정상
- [x] `tts/chatterbox_local.py`: 지연 로드 + `asyncio.to_thread` 오프로드 + PCM16 청크 스트리밍
- [x] pyproject: cu128 torch 인덱스 + override, numba/numpy 하한, setuptools<81, sounddevice; py3.11 고정
- [x] 실제 오디오 재생(sounddevice) + 첫 오디오 지연 측정: warm 첫 청크 1.74s, RTF 0.45(실시간보다 빠름), 24kHz
- [x] 검증: `scripts/probe_tts.py` → 영어 텍스트 → 자연스러운 영어 음성 스피커 재생
- [ ] (후속) 첫 오디오 지연↓: chatterbox-streaming 포크/RealtimeTTS(~470ms 첫 청크)로 교체 여지 — M5에서 검토

## 마일스톤 5 — 전체 파이프라인 + barge-in 실측
- [ ] 실 STT+LLM+TTS 연결, 마이크 VAD가 barge-in 트리거
- [ ] 검증: 왕복 지연 ~1–3초, 끼어들면 즉시 멈춤

## 마일스톤 6 — VTube Studio 아바타 립싱크
- [ ] `avatar/vtube_studio.py`: pyvts 연결 + 오디오 라우팅(VB-Cable)
- [ ] 검증: TTS 음성에 맞춰 아바타 입 움직임

## 마일스톤 7 — TS 프론트 자막 오버레이
- [ ] `ws_server.py`: 프론트로 상태/자막 push
- [ ] frontend: Vite + 경량 TS, 한국어 자막 오버레이 + 상태 대시보드
- [ ] 검증: 자막이 발화와 동기되어 화면 표시
