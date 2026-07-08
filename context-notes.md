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

## 마일스톤 4 메모 (로컬 TTS = Chatterbox)
- **엔진 결정 = Chatterbox (Resemble AI)**. 근거: MIT 라이선스(수익화 안전), 5초 제로샷 복제, 영어 SOTA, RTX 5080/sm_120 구동 확인. 대안 XTTSv2는 CPML 비상업+Coqui 폐업으로 기각. 리서치 상세는 서브에이전트 리포트(세션 로그).
- **사용자 결정**: Chatterbox 확정, 기본 음성으로 먼저 구축(복제 샘플은 나중에 교체).
- **Blackwell 검증 완료 (probe venv, 스크래치패드/tts-probe)**:
  - 드라이버 610.47(요구 570+ 상회), CUDA UMD 13.3, 네이티브 Windows(WDDM).
  - torch **2.9.0+cu128**가 arch list에 `sm_120` 포함, `torch.cuda.get_device_capability()==(12,0)`, GPU matmul 정상.
  - Chatterbox 로드 6.4초, `generate()` **RTF 0.58**(3.7초 오디오를 2.1초에 생성, 실시간보다 빠름). "no kernel image" 크래시 없음. sr=24000.
- **설치 레시피 (순서·함정 중요)**:
  1. `uv pip install torch==2.9.0 torchaudio==2.9.0 --index-url https://download.pytorch.org/whl/cu128`
  2. `uv pip install chatterbox-tts` — **주의: torch를 2.6.0(CPU)로 다운그레이드함** → 1을 다시 실행해 cu128 복구.
  3. `uv pip install "setuptools<81"` — perth(워터마커)가 `pkg_resources`를 import하는데 setuptools 81+는 이를 제거함. <81 필수(아니면 `PerthImplicitWatermarker=None` → TypeError).
  4. 저장: torchaudio 2.9의 `save`는 torchcodec 요구 → `soundfile.write(path, wav.squeeze(0).cpu().numpy(), sr)` 사용.
- **provider 설계 주의**: `generate()`는 동기·블로킹(~2초/문장) → asyncio에서 `asyncio.to_thread`로 오프로드 필수(barge-in 응답성). 모델 로드(6.4초)는 시작 시 1회만. 첫 오디오 지연↓ 원하면 추후 chatterbox-streaming 포크/RealtimeTTS(~470ms 첫 청크)로 교체.
- **메인 env 통합 완료**:
  - pyproject: `[tool.uv.sources]` torch/torchaudio→`pytorch-cu128` 인덱스, `[tool.uv] override-dependencies`로 chatterbox의 torch 2.6 핀을 2.9.0+cu128로 강제.
  - **함정: py 버전** — uv 기본 3.13에선 librosa→numba가 sdist-only 구버전(0.53.1)으로 backtrack해 빌드 실패. `requires-python=">=3.11,<3.13"` + `.python-version=3.11` + venv 재생성으로 해결.
  - **함정: 유니버설 리졸버** — `uv sync`가 numba 0.53.1로 backtrack → `numba>=0.61`, `numpy<2` 하한 명시로 모던 휠 고정(probe는 numba 0.66/llvmlite 0.48).
  - 결과: torch 2.9.0+cu128 + chatterbox-tts 0.1.7, 기존 mock 테스트 5개 유지 통과.
- **provider `tts/chatterbox_local.py`**: chatterbox 지연 import(인스턴스화 시 로드 안 함), `_generate_pcm`을 `asyncio.to_thread`로 오프로드, 문장 전체 생성 후 chunk_ms(50ms) PCM16 프레임으로 스트리밍. 출력 24kHz mono PCM16 LE. `audio_prompt_path`로 복제 음성 지정(None=기본).
- **실측 지연(probe_tts.py, 메인 env)**: cold(모델 로드+첫 gen) 28.8s(시작 1회), **warm 첫 청크 1.74s, RTF 0.45**. sounddevice 재생 성공.
  - 함의: 문장당 첫 오디오 ~1.74s. LLM 지연과 합치면 첫 발화 왕복이 목표(1–3s) 상단~초과 가능 → M5에서 (a)LLM/TTS 파이프라이닝(첫 문장 나오자마자 합성) (b)chatterbox-streaming 포크로 첫 청크↓ 검토.
  - torchaudio 2.9 `save`는 torchcodec 필요 → 저장은 soundfile 사용(provider는 raw PCM 바이트만 다룸).

## 음성 클로닝 (Neuro-sama, M4 후속)
- 사용자가 "예전 세션에서 받은 진짜 Neuro-sama 목소리" 클로닝 요청. airi 프로젝트 세션 스크래치패드(`.../C--Users-jolib-Documents-airi/d76a2f8e-.../scratchpad`)에서 발견.
- 채택: `neuro_ref.wav`(8초, 44.1kHz mono, 깨끗한 자기소개 클립 "My name is Neuro-Sama..."). 임시 경로 유실 대비 `backend/assets/voices/`로 복사·커밋.
- config `tts_voice_prompt` 추가: 기본=번들 neuro_ref.wav, `NEURU_TTS_VOICE_PROMPT`로 교체, 빈 값이면 기본 음성. 클로닝 합성 1.83s/문장 확인.
- 주의: 저작권 있는 실제 목소리 — 로컬 전용(원격 remote 없음). 공개/송출 시 재검토 필요.

## 마일스톤 2 메모 (로컬 STT = faster-whisper)
- **엔진 = faster-whisper(CTranslate2 4.8.1) large-v3 + silero VAD 6.2.1**. RealtimeSTT 래퍼 대신 직접 구성(sounddevice 마이크 + silero VADIterator + faster-whisper) — 제어력↑, 이벤트 모델(SpeechStarted/Transcript)에 직접 매핑.
- **Blackwell 검증(격리 venv 후 메인 env)**:
  - CTranslate2가 sm_120 인식(`get_cuda_device_count()==1`), cuda 로드 성공.
  - **함정: CUDA DLL** — CTranslate2가 `cublas64_12.dll`을 못 찾음. faster-whisper는 CUDA 런타임을 자동설치 안 함. `os.add_dll_directory`만으론 부족(네이티브 delay-load는 PATH 참조) → **import 전에 PATH에 bin 디렉터리 prepend 필요**.
  - **해법: torch/lib 재사용** — 메인 env의 torch cu128이 `cublas64_12.dll`·`cudnn64_9.dll` 등 전부 번들. `_ensure_cuda_dll_path()`가 torch/lib를 PATH+add_dll_directory에 추가 → 별도 nvidia-* 휠 불필요(1.3GB 절약, 프로세스 내 DLL 중복 회피).
  - 실측: large-v3 warm transcribe **0.34s / 7.28s 오디오(RTF 0.047)**, base도 정확. lang=ko prob=1.00.
- **provider `stt/whisper_local.py`**: 지연 로드(`_load`), silero `VADIterator`(512샘플/16kHz 청크)로 발화 온셋→SpeechStarted, 오프셋→버퍼 transcribe→Transcript(is_final). 마이크는 sounddevice InputStream(blocksize=512) 콜백이 `loop.call_soon_threadsafe`로 asyncio 큐에 프레임 전달. transcribe는 `to_thread` 오프로드. 취소·종료 시 stream 정리.
  - `condition_on_previous_text=False`로 Whisper 반복·환각 억제(합성음성 파일에서 반복 관측 후 추가).
- **config**: `stt_model_size`(NEURU_STT_MODEL_SIZE, 기본 large-v3), `stt_device_index`(NEURU_STT_DEVICE_INDEX). 마이크 기본=시스템 기본 입력(현재 device 1=Steam Streaming Mic, 실물은 device 20=Realtek).
- **검증**: `scripts/probe_stt.py --file <wav>`로 VAD 세그먼트+전사 결정적 확인, `--seconds N`로 마이크 초기화 무크래시 확인. **실제 마이크 발화 테스트는 사용자 몫**(라이브).
- 테스트: 지연 로딩 회귀 테스트 추가(총 6개 통과).

## M2/M4 리뷰 반영 (code-reviewer + code-health-reviewer)
- **P1(버그) Chatterbox 모델 이중 로드 레이스**: `_ensure_model`이 락 없이 `to_thread`에서 실행 → cold-load 중 barge-in으로 취소돼도 스레드는 계속 로드 → 다음 합성이 두 번째 `from_pretrained` 동시 실행(CUDA OOM 위험). `threading.Lock` 이중검사로 직렬화.
- **P2 stream.start() 누수**: `start()`가 try 밖이라 실패 시 장치 핸들 누수 → 시작 전체를 try로 감쌈.
- **P2 발화 첫 음소 잘림**: VAD start 시 버퍼를 트리거 프레임부터만 담아 speech_pad·트리거 지연 이전 오디오 유실 → `_PREROLL_FRAMES(8=~256ms)` deque pre-roll을 버퍼 앞에 붙임.
- **P2 시작 실패 무한 대기**: STT run() 시작 실패 시 stt_task에 예외 잠복, 오케스트레이터 `_consume`가 큐에서 영원히 대기 → 시작부를 try로 감싸 실패 시 `Shutdown` 발행 후 전파(소비 루프 종료 보장).
- **헬스 F1 세그먼트 로직 중복**: provider·probe에 상태머신 복제 → `_VadSegmenter`로 추출, run()·probe가 동일 로직 구동(probe가 실제 로직 검증). F2 명명 통일(`_ensure_model`), F3 device=CUDA 고정 주석, F4 docstring "모델 고유 sr(현재 24kHz)"로 수정, probe off-by-one(+1) 수정.
- 검증: 테스트 6개 통과, 파일 프로브 세그먼트+전사 정상.
- **M5로 연기(현 시점 speculative)**: (a) TTS 오디오 바이트에 샘플레이트 메타 동반(실 오디오 싱크 붙일 때 필요, 지금 아바타는 mock) (b) 오케스트레이터가 `stt_task`를 큐와 함께 관측해 provider 죽음을 근본 처리(현재는 provider-local Shutdown로 완화).

## 열린 리스크
- VTube Studio 립싱크: VB-Cable 오디오 라우팅 우선(kimjammer/Neuro 검증), 대안은 pyvts 입 파라미터 직접 주입.
- 한국어 STT 저지연: large-v3 정확하나 무거움 → GPU 지연 실측 후 모델/파라미터 조정.
- 비용: Claude + ElevenLabs 유료. .env 키 관리, 커밋 금지.
