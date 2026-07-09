# Workspace

### neru — AI VTuber (Neuro-sama clone)
Real-time voice conversation core: Korean speech in → English voice out + Korean subtitles.

**구조:** 단일 시스템 = vendored **Project AIRI 포크**(`airi/`, MIT, 코어까지 수정 허용). AIRI가 마이크 입력·STT 오케스트레이션·LLM 대화·아바타(Live2D)·자막을 모두 담당한다. 우리 GPU 음성 기술은 `airi/services/neru-audio` 게이트웨이(Python FastAPI)로 이관됨 — OpenAI 호환 `/v1/audio/speech`(Chatterbox, Neuro 클론 음성)·`/v1/audio/transcriptions`(faster-whisper large-v3, 한국어)를 `127.0.0.1:3457`에 노출, `uv run neru-audio`로 독립 기동. 데스크톱 앱(`airi/apps/stage-tamagotchi`)이 `pnpm desktop`(`airi/`에서 실행) 시 이 게이트웨이를 자동 spawn(dev 전용)하고 종료 시 프로세스 트리째 kill(`src/main/services/neru-audio/index.ts`). Provider는 `neruPreseed.ts`가 localStorage에 프리시드해 온보딩 없이 LLM 프록시(`localhost:3456`)·STT/TTS 게이트웨이(`localhost:3457`) 3개에 연결된다. 루트 `backend/`(자체 오케스트레이터·provider ABC)·`frontend/`(자체 Vite/pixi 프론트)는 **삭제됨**.

**Done (AIRI 통합 전, 삭제된 backend/frontend 기준 기록):** M1 (skeleton), M3 (Claude LLM), M4 (Chatterbox TTS + Neuro clone), M2 (faster-whisper STT). 코드+헬스 리뷰 완료. 아바타는 웹 네이티브 Live2D로 피벗(Vite 프론트, Playwright 검증), Electron 오버레이·HiDPI 렌더·움직임/설정까지 구현.
**AIRI 통합 (Task 1~5, 완료):** GPU 음성 기술을 `neru-audio` OpenAI 호환 게이트웨이로 이관, Electron 자동 spawn/tree-kill, provider 프리시드로 온보딩 스킵, 자체 backend/frontend 삭제. 상세는 `context-notes.md` "방향 대전환" 절, `checklist.md` 참조.

**Next:** 후속 스펙(순서 미확정) — 패키지 Python 번들링, 이중언어(영어 음성+한국어 자막), neru 마녀 Live2D 모델 AIRI 로드, 리브랜딩(productName airi→neru).

**Known Issues:**
- 패키지 Python 번들링 미해결: 패키지된 `airi.exe`엔 Python이 없어 `neru-audio` 게이트웨이 자동 기동이 dev(`uv run`)에서만 동작. 패키징 시 게이트웨이를 어떻게 번들링할지는 후속 결정 사항.
- neru 마녀 Live2D 모델(`neru-witch`) 파일 유실: gitignore 대상이라 Task 2의 `frontend/` 삭제 시 디스크에서도 함께 사라짐(트래킹된 백업 없음, 재검색 확인). 후속 Next Steps ③ 진행 전 모델 재확보 필요.

**Key Decisions:**
- **AIRI 통합(2026-07-09)**: 시스템을 하나로 — 자체 backend/frontend 폐기, vendored AIRI 포크(`airi/`)를 유일한 실행 시스템으로 채택. AIRI가 오케스트레이션·아바타·자막을 전담하고, 우리 GPU 기술은 OpenAI 호환 HTTP 게이트웨이(`neru-audio`)로만 남는다.
- Avatar: AIRI 내장 웹 네이티브 Live2D(pixi-live2d-display) 사용(자체 VTS/자체 프론트 대신). 영어 음성+한국어 자막(neru 정체성)은 `docs/superpowers/specs/neru-persona-reference.md`에 보존 — 후속 캐릭터 카드 스펙에서 AIRI 페르소나로 이식 예정.
- Blackwell/sm_120(`neru-audio`): torch cu128(TTS) + CTranslate2가 torch/lib CUDA DLL 재사용(STT), 별도 nvidia 휠 불필요.
- TTS = Chatterbox(Neuro 클론); STT = faster-whisper large-v3 + silero VAD — 둘 다 `neru-audio`로 그대로 이식.

**Next Steps:**
1. 패키지 Python 번들링 방식 결정 후 `desktop:build:win` 설치본 재검증.
2. 이중언어(영어 음성+한국어 자막) 페르소나 스펙 작성 및 AIRI 코어 반영.
3. neru 마녀 Live2D 모델(Cubism4)을 AIRI 모델 로더에 연결.
4. 리브랜딩: productName airi→neru.
