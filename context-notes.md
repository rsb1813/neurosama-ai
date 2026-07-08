# neru 컨텍스트 노트 — 결정과 근거

새 세션이 재파악 없이 이어갈 수 있도록 결정·근거·기각안을 계속 append.

## 확정된 방향 (사용자 결정)
- 언어 흐름: 사용자 **한국어 발화** → neru **영어 음성** 답변(Neuro-sama처럼) + 화면 **한국어 자막**.
- 스택: 하이브리드 (Python 두뇌·음성 + TypeScript 프론트).
- LLM: Claude 클라우드 API (초기). provider 뒤에 두어 교체 가능.
- STT: 로컬 (RTX 5080 16GB 보유). 저지연·무료·프라이버시.
- TTS: ElevenLabs 추천(영어 스트리밍 고품질). 기각 대안 = Azure "Ashley"(Neuro-sama 정통) — 교체 가능하게 설계.
- 아바타: VTube Studio + Live2D (외부 앱, 오디오 라우팅 자동 립싱크). 기각 대안 = 웹 네이티브 Live2D(제어력↑, 구현부담↑).
- 송출(OBS/Twitch/YouTube)은 이번 MVP 제외. 아바타는 포함.

## 갱신된 결정 (사용자 추가 정보)
- **Claude 접근**: API 키 없음. 로컬 **Anthropic 형식 프록시 `http://localhost:3456`** 사용. SDK base_url을 이 주소로, api_key는 더미. 모델 ID는 프록시가 서빙하는 것에 의존 → env로 설정·프로브, 가정 금지.
- **Claude 비용 무관** — 품질 우선.
- **TTS 로컬 확정** (ElevenLabs 아님). RTX 5080에서 StyleTTS2/XTTSv2/Kokoro(RealtimeTTS) 후보. → M4는 "로컬 TTS"로 변경.
- **작업 순서**: M3(Claude) → M4(로컬 TTS) → M2(로컬 STT) → M6(아바타) → M7(자막).

## 아키텍처 결정
- **provider 인터페이스 패턴**: STT/LLM/TTS/Avatar를 얇은 추상 베이스 뒤에 둠. 오케스트레이터는 베이스에만 의존 → 교체성 확보 (AIRI brain/ears/mouth 구조 차용).
- **오케스트레이터가 중앙 드라이버**: STT가 asyncio.Queue로 SpeechStarted/Transcript 발행 → 오케스트레이터가 소비. 순수 pub/sub 대신 큐+중앙 드라이버로 단순화(스트리밍 파이프라인엔 이게 더 명료).
- **barge-in = 응답 태스크 취소**: 응답을 취소 가능한 asyncio.Task로 실행. SpeechStarted 오면 cancel → 응답의 except에서 아바타 입 닫고 LISTENING 복귀.
  - CancelledError는 "한 번만" 던져지므로, except에서 잡은 뒤 정리 await는 안전(재-cancel 없는 한).
- **Shutdown은 graceful drain**: 진행 중 응답을 취소하지 않고 완료를 기다림(`_drain_response`). 타이밍과 무관한 안정적 정상 종료 경로 확보. barge-in(cancel)과 종료(drain)를 구분.
- **자막 생성**: 단일 Claude 호출로 `{speech_en, subtitle_ko}` 동시 산출 채택(지연·비용 절감). 품질 문제 시 별도 번역 단계로 전환 여지.

## 마일스톤 1 메모
- 데모 barge-in: 현재 mock 타이밍상 응답이 SpeechStarted 전에 끝나 화면엔 안 겹침. 끼어들기 자체는 `GatedLLM` 기반 결정적 단위테스트로 검증.
- 미사용 import(orchestrator의 ReplyChunk) 자체리뷰에서 제거.
- 실 런타임 의존성(anthropic/elevenlabs/RealtimeSTT 등)은 아직 미설치 — 각 마일스톤에서 버전 확인 후 핀(§4).

## 마일스톤 1 리뷰 반영 (code-reviewer / code-health-reviewer)
- **P1 provider 오류 복구**: `_respond`에 `except Exception` 추가 — Claude/ElevenLabs/VTube가 네트워크·타임아웃 오류를 던져도 로깅·정리·청취복귀 후 파이프라인 지속(이번 발화만 버림). 실 provider 붙기 전 선제 방어.
- **P2a 취소 판별**: `_cancel_task`가 자식의 CancelledError만 삼키고, 현재(부모) task 취소는 `current_task().cancelling()>0`로 판별해 보존·재전파. `run()` 외부 취소(예: wait_for 타임아웃)가 유실되지 않음.
- **P2b 정리 예외 방어**: barge-in 정리(`_end_speech`)를 `_safe_end_speech`로 감싸 정리 중 예외가 CancelledError를 가리거나 루프를 무너뜨리지 않게 함. `_on_speech_started`의 LISTENING 가드가 최종 안전망.
- 헬스: `Event` 유니온 타입 추가, 추상 메서드 불필요 `raise` 제거, `OutputSink`가 Protocol인 이유 주석화(드리프트 아님), `LoggingAvatar.speaking` 미사용 필드 제거.
- 회귀 테스트 2개 추가: 오류 복구+지속, barge-in 정리 예외 무해화. 총 4개 통과.

## 마일스톤 3 메모 (Claude LLM 연결)
- **프록시 실측**: `GET http://localhost:3456/v1/models`는 OpenAI 형식 리스트 반환. 서빙 모델 = `claude-opus-4-6/4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5`. **`claude-opus-4-8`은 없음** → 기본 모델을 `claude-opus-4-7`(최고 성능)로 설정. env `NEURU_LLM_MODEL`로 교체 가능.
- messages 엔드포인트는 Anthropic 형식 → `AsyncAnthropic(base_url=..., api_key="sk-local-proxy")` 그대로 동작 확인.
- **저지연 위해 thinking 생략**: opus-4-7은 adaptive-only이나 param 생략 시 사고 없이 즉답. budget_tokens 전달 금지(400).
- **EN/KO 스트리밍 파싱**: 페르소나가 문장마다 `EN: ...`/`KO: ...` 두 줄 출력 → `ClaudeLLM._consume_line`이 줄 단위로 파싱, EN 보류 후 KO에서 쌍지어 ReplyChunk 방출. 첫 문장 완성 즉시 방출(TTS 조기 전달). 형식 밖 줄은 무시.
  - 기각안: 구조화 JSON 출력(streaming JSON 파싱 지연·취약) / 별도 번역 호출(추가 지연·비용). 태그 줄 방식이 단일 호출·저지연·견고.
- 검증: `uv run python scripts/probe_llm.py` → 한국어 입력에 영어 답변 6문장 + 한국어 자막, 페르소나(장난기·따뜻함) 반영 확인.
- main.py 실연결은 M5(전체 파이프라인)로 미룸 — M3은 provider 단위 검증까지.

## 마일스톤 1 리뷰 후속 (재리뷰 반영, commit 795b35e)
- **P1 외부취소 시 응답 태스크 고아화**: `run()` finally에서 `_cancel_task(stt_task)`가 sticky `cancelling()>0`로 재-raise → `_cancel_response()` 스킵되어 진행 중 응답 태스크가 pending 방치(경험적 재현됨). inner try/finally로 응답 정리를 반드시 실행하게 수정. 회귀 테스트 `test_external_cancel_does_not_orphan_response_task` 추가(수정 없으면 실패 확인).
- **P2 관측성**: `_cancel_task`의 `except Exception: pass` → `logger.exception`으로 교체(STT가 조용히 죽으면 로그 남기도록).

## 열린 리스크
- VTube Studio 립싱크: VB-Cable 오디오 라우팅 우선(kimjammer/Neuro 검증), 대안은 pyvts 입 파라미터 직접 주입.
- 한국어 STT 저지연: large-v3 정확하나 무거움 → GPU 지연 실측 후 모델/파라미터 조정.
- 비용: Claude + ElevenLabs 유료. .env 키 관리, 커밋 금지.
