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

## 마일스톤 2 — 로컬 STT 실동작 ✅ (라이브 마이크 최종확인은 사용자)
- [x] Blackwell 검증: CTranslate2가 sm_120 인식, torch/lib CUDA DLL 재사용(별도 nvidia 휠 불필요)
- [x] `stt/whisper_local.py`: faster-whisper large-v3 + silero VAD, 지연 로드, to_thread 오프로드
- [x] 마이크 입력(sounddevice) + Silero VADIterator로 SpeechStarted/Transcript 발행
- [x] config: NEURU_STT_MODEL_SIZE / NEURU_STT_DEVICE_INDEX + condition_on_previous_text=False
- [x] 검증(오프라인): `probe_stt.py --file`로 VAD 세그먼트+한국어 전사(large-v3, RTF 0.047)
- [x] 검증(초기화): `probe_stt.py --seconds N` 마이크 스트림 무크래시
- [ ] 검증(라이브): 실제 마이크 한국어 발화 → 한국어 텍스트 — **사용자가 말해서 확인 필요**

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

## 마일스톤 6 — 아바타 립싱크 (웹 네이티브 Live2D로 전환)
- [x] (대안) VTubeStudioAvatar(pyvts) 구현·검증 — provider 뒤 대안으로 유지
- [x] **방식 전환**: 사용자가 VTS 원치 않음 → 웹 네이티브 Live2D(프론트 직접 렌더). M6+M7 통합
- [x] frontend 스캐폴드: Vite+TS + pixi.js@6.5.10 + pixi-live2d-display@0.4.0
- [x] neru 마녀 모델 렌더 검증(Playwright): 전신 렌더 + ParamMouthOpenY 여닫힘 확인
- [x] ★Cubism Core는 **4 버전** 필요(SDK5의 5 Core는 doDrawModel 크래시) — CDN 4 Core로 해결
- [ ] `WebSocketAvatar`(AvatarDriver) + `ws_server`: 진폭·자막·상태를 프론트로 push
- [ ] 프론트 WS 클라이언트: MouthOpen 실 립싱크(임시 오실레이션 대체) + idle blink
- [ ] 검증: TTS 발화에 맞춰 아바타 입 실제 움직임(백엔드→WS→브라우저)

## 마일스톤 7 — TS 프론트 자막 오버레이
- [ ] `ws_server.py`: 프론트로 상태/자막 push
- [ ] frontend: Vite + 경량 TS, 한국어 자막 오버레이 + 상태 대시보드
- [ ] 검증: 자막이 발화와 동기되어 화면 표시
