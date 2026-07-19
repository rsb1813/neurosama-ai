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

## ▶ 방향 전환 — Project AIRI 기반으로 프론트 전면 교체 (자체 Vite/pixi 폐기)
자체 프론트 완성도 부족 → **Project AIRI**(MIT, Vue3 모노레포, Live2D+VRM+오디오 립싱크 내장) 포크.
사용자 결정: ① **통합 포크**(레포에 vendored, 코어까지 수정 허용) ② **영어 음성 + 한국어 자막** 유지.
핵심 검증(완료): 프록시 `localhost:3456` = **OpenAI 완전 호환**(`/v1/chat/completions`·`/v1/models` OK, 모델 opus-4-7/sonnet-4-6/haiku-4-5). AIRI OpenAI-compat provider에 주소만 넣으면 LLM 연결. 오디오 엔드포인트는 없음(404) → STT/TTS는 우리가 OpenAI 호환 서버로 래핑.

### M-A — AIRI vendored fork + 실행 ✅
- [x] AIRI를 레포 `airi/`에 vendored 클론(.git 제거, docs/content 450MB 제거), 커밋 편입
- [x] pnpm install: 전체 설치 필요(필터 설치는 워크스페이스 빌드 깨짐). `.npmrc`로 버전강제·purge 비활성화
- [x] `apps/stage-web` dev 실행(pnpm 11 표준, CI=true) → Playwright로 AIRI UI+Live2D 로드 확인(에러는 미기동 선택적 서버 WS뿐)
- [x] 자체 `frontend/`(Vite/pixi) 폐기 처리 — Task 2에서 완료(아래 통합 마일스톤 참고)

### M-B — LLM 연결 ✅
- [x] AIRI 온보딩에서 "OpenAI 호환" provider: baseUrl=`http://localhost:3456/v1/`, key=`sk-local-proxy`, model=`opus-4-7`. Ping 통과, 모델목록 4개 수신
- [x] 검증: 한국어 입력 → Claude(opus-4-7) 한국어 응답 표시(Playwright). 페르소나는 아직 AIRI 기본 → M-F에서 교체
- [x] (후속) provider 설정을 포크에 프리시드해 사용자 브라우저에서도 온보딩 없이 연결 — Task 4에서 완료(`neruPreseed.ts`, 아래 통합 마일스톤 참고)

### M-Desktop — 데스크톱 앱 패키징 (사용자 요청: 웹 아닌 데스크톱)
- [x] 타깃 확인: `apps/stage-tamagotchi` = Electron(electron-vite + electron-builder)
- [x] Electron 바이너리 이슈 해결: pnpm 10+가 postinstall 차단 + extract-zip 실패(dist에 dxil.dll만) → `scripts/ensure-electron.mjs`가 캐시 zip을 system tar로 재추출 + path.txt
- [x] `pnpm desktop`으로 데스크톱 창 기동 확인(override 불필요, 9 프로세스, injeca RUNNING, 내장 WS 서버)
- [x] `pnpm desktop:build:unpack` → `dist/win-unpacked/airi.exe`(212MB)+app.asar(1.08GB), 총 1.7GB 산출. 빌드 성공(exit 0)
- [x] 검증: 패키지된 `airi.exe` 독립 실행 확인(7 프로세스, 1.75GB) — dev 아님
- [ ] (후속) `desktop:build:win` 설치본(NSIS) + neru 리브랜딩(현재 productName=airi)

### 통합 마일스톤 — AIRI 편입 (Task 1~5) ✅
M-C·M-D(개별 TTS/STT 브릿지 서버 2개 계획)를 대체 — `airi/services/neru-audio` 게이트웨이 하나로 통합 구현.
- [x] Task 1: `airi/services/neru-audio` Python 게이트웨이 생성 — Chatterbox `/v1/audio/speech`(Neuro 클론 음성) + faster-whisper large-v3 `/v1/audio/transcriptions`(한국어), OpenAI 호환, `127.0.0.1:3457`. `uv run neru-audio`로 독립 기동
- [x] Task 2: 루트 `backend/`·`frontend/` 삭제 — AIRI가 오케스트레이션·아바타·자막 전담, GPU 음성 기술만 neru-audio로 이식
- [x] Task 3: Electron(`apps/stage-tamagotchi`)이 앱 실행 시 neru-audio 자동 spawn(dev 전용)하고 종료 시 프로세스 트리째 kill (`src/main/services/neru-audio/index.ts`)
- [x] Task 4: AIRI provider 프리시드(`neruPreseed.ts`) — localStorage에 LLM/STT/TTS 3개 provider 기록, 온보딩 없이 연결
- [x] Task 5: 문서 갱신 (`WORKSPACE.md`, `checklist.md`, `context-notes.md`, `.meridian/docs/pipeline-architecture.md`)

### M-C — TTS 브릿지 (Chatterbox → OpenAI `/v1/audio/speech`) — **대체됨** (기록용, 위 통합 마일스톤 참고)
- [ ] 기존 `ChatterboxTTS` 재사용해 OpenAI 호환 `/v1/audio/speech` FastAPI 서버 작성
- [ ] AIRI `openai-compatible-audio-speech` provider 연결
- [ ] 검증: 응답이 Neuro 복제 음성으로 발화 + 립싱크 입 움직임

### M-D — STT 브릿지 (faster-whisper → OpenAI `/v1/audio/transcriptions`) — **대체됨** (기록용, 위 통합 마일스톤 참고)
- [ ] 기존 `WhisperLocalSTT`(large-v3) 재사용해 OpenAI 호환 `/v1/audio/transcriptions` 서버 작성
- [ ] AIRI `openai-compatible-audio-transcription` provider 연결
- [ ] 검증: 한국어 마이크 발화 → 전사 텍스트

### M-E — neru 마녀 Live2D 모델 AIRI 로드 — 🔄 Phase 1 계획 완료(`feat/neru-witch-avatar`)
- [x] 모델 재확보: `~/Downloads/neru-witch-live2d.zip`(38MB, Cubism4, EyeBlink/LipSync 그룹 확인)
- [x] 스펙+계획 작성: `docs/superpowers/specs|plans/2026-07-14-neru-witch-avatar-render*`
- [ ] **Phase 1 구현**: ASCII 리네임 번들 → 프리셋 등록 → neruPreseed 1회성 시드 → 육안 검증 → 12표정 카탈로그
- [ ] **Phase 2**(별도 스펙): 감정→exp3 표정 배선 — AIRI에 미구현이라 신규 글루 필요(감정은 현재 모션에만 연결)

### M-F — 이중언어 (영어 음성 + 한국어 자막) ★코어 수정 — ✅ 완료 (PR #18 병합)
- [x] 페르소나(캐릭터 카드): 문장별 `English <ko>한국어</ko>` 이중 출력 지정(`neru-persona.ts`, 프리시드로 활성)
- [x] AIRI 응답 categoriser가 `<ko>`를 자막 채널로, 태그 밖 영어를 TTS로 분기(`response-categoriser.ts`, `onSubtitle` 훅)
- [x] 코어 라우팅: `chat-orchestrator-runtime` onLiteral/onSegment — 영어=음성, 한국어=화면
- [x] E2E 발견 버그 수정: 스트리밍 speech 추출이 여는 `<ko>` 앞 영어를 유실하던 문제(첫 문장 누락) → `<ko>` 세그먼트 경계 기반 추출로 교체(커밋 5f11741 + 리뷰 반영 d898ad1). 로그로 검증(4문장 첫 문장부터 정상 발화)
- [x] 검증(음성): 한국어 입력 → 영어 음성 첫 문장부터 정상, 채팅 패널 한국어 표시
- [x] E2E 발견 2차 버그 수정: 청크가 닫는 `<` 경계에서 끝나면 categorizer가 세그먼트 발화를 놓쳐 자막·후속 영어·영속화 유실 → 태그 문자 있으면 authoritative 재파싱 폴백(커밋 2ddc720, 회귀 테스트 2개). 최종 전체 브랜치 리뷰가 발견
- [~] 자막 오버레이(별도 창): 화면에 안 뜸 — `caption-speaker`도 동일하게 안 떠서 **기존 AIRI 공용 인프라 이슈로 판정, 별도 트랙 분리**(이중언어 블로커 아님, 채팅 패널 한국어 정상)

### M-G — 전체 루프 + barge-in
- [x] barge-in 구현 및 자동 테스트 — PR #21로 병합
- [ ] 수동 검증: STT→LLM→TTS→아바타 왕복 ~1–3초, 말하면 답하고 끼어들면 멈춤

### 폐기/보류
- 자체 Vite 프론트(`frontend/`), `WebSocketAvatar`+`ws_server` 계획 → AIRI가 대체. **Task 2에서 루트 `backend/`·`frontend/` 실제 삭제 완료**(위 통합 마일스톤 참고)
- 백엔드 provider 클래스(STT/TTS/LLM)는 폐기 아님 — Chatterbox TTS·faster-whisper STT는 `airi/services/neru-audio` HTTP 게이트웨이 안에서 재사용됨

---

## Codex 개인 설정 마이그레이션 (2026-07-19)

- [x] Claude와 Codex 전역 지침 차이 및 두 개인 스킬 원본 조사
- [x] 마이그레이션 범위와 제외 항목 설계 문서화
- [x] Codex 전역 `AGENTS.md` 백업 및 범용 규칙 선별 병합
- [x] 사용자 피드백 반영 — 미완성 `brutal-critique` 마이그레이션 제외
- [x] `clone-website` Codex 스킬 변환 및 검증
- [x] 기존 RTK 바이너리를 Codex 전역 `RTK.md`와 `AGENTS.md`에 연결하고 검증
- [x] Claude 전용 토큰·설정 변경 여부와 최종 구조 검증
- [x] 변경 결과와 백업 경로 기록

---

## Codex 프로젝트 컨텍스트 초기화 문서 (2026-07-19)

- [x] 루트 문서와 최근 Git 상태 대조
- [x] 문서별 역할과 상태 기준 설계
- [x] 루트 `AGENTS.md` 작성
- [x] `WORKSPACE.md`, `ROADMAP.md`, `README.md` 상태 동기화
- [x] 문서 링크·경로·명령·Git 근거 검증
- [x] 문서 변경 커밋

---

## Neru Codex OAuth 제공자 (2026-07-19)

- [x] 현재 `localhost:3456` LLM 프리시드와 AIRI 제공자 구조 조사
- [x] Codex app-server Device OAuth·thread·도구·승인 프로토콜 확인
- [x] 제공자 선택 방식과 권한 경계 사용자 승인
- [x] 설계 문서 작성과 자체 검토
- [x] 사용자의 작성된 설계 문서 검토
- [x] 구현 계획 작성
- [x] Task 1~8 구현과 집중 자동 테스트 완료
- [ ] 실제 Codex Device Login·도구·승인 흐름 수동 검증
- [~] 타입 검사: 기존 VAD/모델 모듈 누락 오류가 남아 전체 통과하지 않음

---

## Codex OAuth 실행 설정 보강 (2026-07-19)

- [x] 현재 전용 설정 UI와 app-server 요청 경로 조사.
- [x] 공식 app-server의 `model/list`, 모델별 추론 강도, thread·turn 덮어쓰기 계약 확인.
- [x] 기본 미설정·Codex 설정 상속과 항목별 Neru 덮어쓰기 설계 승인.
- [x] 사용자의 갱신된 설계 문서 검토.
- [x] app-server 모델 카탈로그와 지원 옵션을 Electron 브리지로 노출.
- [x] 제공자별 덮어쓰기 설정 저장소와 정규화 테스트 작성.
- [x] Codex 전용 설정 UI에 모델·추론 강도·서비스 등급·작업 폴더·권한·승인 설정 추가.
- [x] thread·turn 요청에서 상속 필드는 생략하고 명시적 덮어쓰기만 전달.
- [x] 관련 단위 테스트, 앱 타입 검사, Electron 재시작 검증.
- [x] 스크린샷으로 실제 데스크톱 제공자 경로가 기존 `settings/providers/chat/[providerId]`임을 확인.
- [x] 기존 제공자 경로에서 API 키 폼 대신 Codex OAuth 전용 카드를 렌더링.
- [x] 개발 서버 재로딩과 Electron 프로세스 종료를 구분해 튕김 증상을 재검증.
