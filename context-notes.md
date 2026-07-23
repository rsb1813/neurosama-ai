# neru 컨텍스트 노트 — 결정과 근거

새 세션이 재파악 없이 이어갈 수 있도록 결정·근거·기각안을 계속 append.

## Codex CLI 지원 상태 오탐 조사 (2026-07-20)

- 사용자 화면은 `Codex CLI must be updated`와 `unsupported`를 표시했지만, 실제 CLI는 `0.144.6`이고 코드의 최소 버전 `0.144.4`보다 높습니다.
- 같은 CLI에 보낸 app-server `initialize`는 성공했습니다. 따라서 설치·버전·초기화가 아니라 그 이후 기능 확인 또는 계정 조회 경로를 조사합니다.
- 현재 매니저는 `thread/start`부터 `thread/unsubscribe`까지 발생하는 오류를 모두 기능 미지원으로 분류하므로, 이 범위의 일반 실행 오류도 버전 문제로 오인될 수 있습니다.
- 수정 전 실패 테스트로 오분류를 고정하고, 지원 버전 판정과 런타임 실패를 분리하는 최소 변경을 우선합니다.
- 실제 실패는 `thread/start`의 `sandbox: readOnly`였습니다. Codex CLI `0.144.6`의 thread 프로토콜은 `read-only`, `workspace-write`, `danger-full-access`를 요구합니다.
- 같은 프로토콜의 승인 정책도 UI 값 `onRequest`, `unlessTrusted`를 각각 `on-request`, `untrusted`로 변환해야 합니다. turn의 `sandboxPolicy.type`은 기존 camelCase 계약을 유지합니다.
- 수정된 실제 요청으로 `initialize`, `thread/start`, `thread/unsubscribe`, `account/read`가 모두 성공했습니다.
- Codex 서비스 테스트 60개, 변경 파일 ESLint, `apps/stage-tamagotchi`의 `vue-tsc --noEmit`이 통과했습니다. 저장소 루트 타입 검사는 RTK가 `--filter`를 무시해 기존 전체 오류 310건을 보고했으며 이번 변경 검증에는 패키지 로컬 명령을 사용했습니다.
- 재실행 후 스크린샷에서도 `unsupported`가 유지되었습니다. Electron과 같은 Node `execFile('codex')`를 재현하자 WindowsApps의 실행 별칭을 선택해 `spawn EPERM`이 발생했습니다.
- PowerShell의 `codex`는 PATH 앞쪽 npm shim을 사용했기 때문에 앞선 직접 프로토콜 검증과 Electron 결과가 달랐습니다.
- Windows에서는 고정된 `cmd.exe /d /s /c codex ...` 인수로 실행하면 npm shim이 선택됩니다. 실제 Node 검증에서 `codex-cli 0.144.6` 출력과 app-server `initialize` 응답 및 표준 입출력 파이프를 확인했습니다.

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

## 마일스톤 6 메모 (VTube Studio 아바타 립싱크)
- **환경 점검 결과 계획 변경(§9)**: VB-Cable 미설치(출력장치에 CABLE 없음), VTS 미실행(8001 미개방), pyvts 미설치. 계획의 "VB-Cable 라우팅 우선"에서 **사용자 확정으로 pyvts 직접 주입**으로 전환(VB-Cable 관리자 설치 회피, 제어력↑).
- **방식**: TTS 오디오를 아바타가 sounddevice `OutputStream`으로 실시간 재생하며, 재생 블록의 RMS 진폭을 VTS `MouthOpen` 파라미터에 주입(`requestSetParameterValue`→InjectParameterDataRequest). 재생 속도가 곧 입 페이싱.
- pyvts 0.3.3 API: `vts(plugin_info, vts_api_info{host,port:8001})` → `connect()`→`request_authenticate_token()`(최초 VTS 허용 팝업)→`request_authenticate()`→`request(payload)`. `requestSetParameterValue(param, value, mode="set")`.
- **provider `avatar/vtube_studio.py`**: connect(pyvts auth), start_speaking(OutputStream+입 갱신 태스크 30Hz), feed_audio(버퍼 append), stop_speaking(태스크 취소·스트림 정리·입 닫기), close. 진폭→입: `min(1, rms*gain)` + smoothing(EMA). gain 기본 6.0(포화 완화). VTS 미연결 시 `_set_param`·`close` graceful skip(무-VTS 재생 검증 가능).
- **버그 수정**: connect 실패 시 `self._vts.websocket`이 None이라 close()가 크래시 → websocket 존재 시에만 close.
- **검증(무-VTS)**: `probe_avatar.py` → 재생·입값 추종 확인(amp 0.17→mouth 1.0, 무음→0.0), 깔끔 종료. 테스트 8개 통과.
- **라이브 확인 필요(사용자)**: VTS 실행(API 켜고 포트 8001) + 최초 연결 시 "허용" 클릭 → 아바타 입 실제 움직임.
- 토큰 파일 `pyvts_token.txt`는 gitignore.

## M6 리뷰 반영 (code-reviewer + code-health-reviewer)
- **헬스 F1(p1) 죽은 play_audio 플래그**: False면 콜백 미실행→입 멈춤+버퍼 무한증가. 아무도 안 씀 → 제거(재생은 아바타가 항상 소유).
- **헬스 F2/F3**: `_drive_mouth` no-op try/except 제거. host/port/gain을 Settings로 승격(`NEURU_VTS_*`, gain은 모델별 라이브 튜닝).
- **버그 P1(odd-length 콜백 크래시)**: `np.frombuffer(..,'<i2')`가 홀수 바이트에서 ValueError→CallbackAbort로 스트림 사망. 짝수 경계(`& ~1`)만 소비하도록 가드.
- **버그 P1(정상완료 tail 폐기)**: `stop_speaking(drain: bool=False)` 추가 — drain=True면 버퍼 소진까지 대기 후 종료(정상완료), False면 즉시(barge-in). ABC·LoggingAvatar·probe 반영. **M5: 오케스트레이터가 정상완료 시 `stop_speaking(drain=True)`, barge-in 시 `stop_speaking()` 호출해야 함**(현재 orchestrator는 인자 없이 호출 → 기본 False=abort).
- **버그 P2**: 중복 start_speaking 시 이전 스트림/태스크 선정리(누수 방지). `_drive_mouth`가 VTS 요청 예외(ConnectionClosed 등)에 죽지 않고 로그 후 계속.
- 검증: 테스트 8개 통과, drain 프로브 끝까지 재생·정상 종료.
- **F4(close 계약)**: `close()`가 ABC 밖이고 orchestrator 미호출 → M5에서 teardown 계약 정리(ABC에 추가 또는 orchestrator가 호출).

## 아바타 방식 전환 — 웹 네이티브 Live2D (사용자 결정, M6 재설계)
- 사용자가 VTube Studio를 원치 않음("별로"). AI 버튜버는 사람 얼굴 추적이 불필요 → **웹 네이티브 Live2D**로 전환(프론트에 직접 렌더). M6(아바타)+M7(자막)이 하나의 neru 웹앱으로 합쳐짐. AIRI도 이 방식.
- VTubeStudioAvatar(pyvts) 코드는 provider ABC 뒤 대안으로 유지(삭제 안 함).
- **환경**: node 24, npm 11. frontend = Vite(vanilla-ts) + pixi.js@6.5.10 + pixi-live2d-display@0.4.0. Cubism Core는 `<script>`로 전역 로드.
- **모델**: `neru-witch-live2d.zip`(魔女=마녀, Cubism 4 moc3, 5167×9410). model3.json Groups: EyeBlink(ParamEyeLOpen/ROpen), **LipSync(ParamMouthOpenY)**. `frontend/public/models/neru-witch/`에 배치(유니코드 파일명, `encodeURI`로 로드).
- **★핵심 함정: Cubism Core 버전** — 사용자의 `CubismSdkForWeb-5-r.5`의 Cubism **5 Core**(228KB)를 쓰면 모델 로드는 되나 렌더 시 `CubismRenderer_WebGL.doDrawModel`에서 `undefined[0]` 크래시(pixi-live2d-display 0.4.0의 Cubism 4 프레임워크와 렌더 API 불일치). → 공식 CDN의 **Cubism 4 Core**(`https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js`, 202KB)로 교체하니 정상 렌더.
- **검증(Playwright MCP로 직접)**: 모델 렌더 성공(마녀 전신), `ParamMouthOpenY` 사인파 구동으로 입이 여닫힘 확인(스크린샷 2프레임 open/closed). 에러 0. claude-in-chrome은 확장 미연결로 사용 불가 → playwright MCP로 검증.
- **다음(실 데이터 배선)**: 백엔드 `ws_server`(websockets) + `WebSocketAvatar`(AvatarDriver): TTS 오디오 재생하며 진폭·자막·상태를 WS로 push → 프론트 WS 클라이언트가 MouthOpen 적용·자막 표시. 임시 오실레이션을 실 립싱크로 대체. blink 등 idle 애니메이션.

## 열린 리스크
- VTube Studio 립싱크: VB-Cable 오디오 라우팅 우선(kimjammer/Neuro 검증), 대안은 pyvts 입 파라미터 직접 주입.
- 한국어 STT 저지연: large-v3 정확하나 무거움 → GPU 지연 실측 후 모델/파라미터 조정.
- 비용: Claude + ElevenLabs 유료. .env 키 관리, 커밋 금지.

---

## 방향 대전환 (2026-07-09) — Project AIRI 기반으로 프론트 전면 교체

**계기**: 자체 Vite+pixi Live2D 프론트(오버레이·설정·움직임까지 구현)에 대해 사용자가 "너무 별로야, 그냥 Project AIRI 포크해서 니 기술만 넣어"라고 방향 변경 지시.

**Project AIRI 조사 결과 (primary source: moeru-ai/airi@main 클론 확인)**:
- 라이선스 MIT → 포크·수정·상업 음성 얹기 전부 허용.
- 스택: TypeScript + Vue3(Pinia/UnoCSS), pnpm 모노레포(~60 패키지, packageManager pnpm@10.33.0, node 24.13), Turbo/Vite/Vitest. 데스크톱=Electron(apps/stage-tamagotchi), 웹=apps/stage-web, 모바일=Capacitor.
- 추론 기본은 클라이언트 사이드(Transformers.js/WebGPU). apps/server는 봇/호스트용, 아바타+음성 루프엔 불필요.
- **Provider 시스템이 핵심**: `packages/stage-ui/src/libs/providers/providers/<id>/index.ts`, `defineProvider` + xsAI. LLM 35종, anthropic 네이티브(단 xsAI가 OpenAI식 /chat/completions 호출), `openai-compatible` provider는 사용자 baseUrl+apiKey 입력칸 보유.
- STT/TTS도 `openai-compatible-audio-transcription` / `openai-compatible-audio-speech` provider 존재(사용자 baseUrl). OpenAI `/v1/audio/transcriptions`·`/v1/audio/speech` 형식이면 코드 수정 0.
- 아바타: Live2D(pixi-live2d-display) + VRM(@pixiv/three-vrm). 립싱크 `packages/model-driver-lipsync`의 wlipsync(오디오 진폭 + AEIOU 모음 가중치) 내장. 자동 눈깜빡임/시선/idle 광고됨.

**우리 프록시 실측 (localhost:3456)**:
- `/v1/models` → OpenAI list 형식(claude-opus-4-7/sonnet-4-6/haiku-4-5 등). `/v1/chat/completions` → 정상 OpenAI chat.completion 응답(`choices[].message.content`). **완전한 OpenAI 호환 프록시**(LiteLLM류). auth: `Bearer sk-local-proxy`.
- `/v1/audio/speech`·`/v1/audio/transcriptions` → 404. 오디오는 프록시가 안 함 → 우리가 래핑해야.

**결론(설계)**: AIRI 코어를 크게 안 고치고, 우리 Python 기술을 OpenAI 호환 로컬 서비스로 만들어 AIRI provider에 주소만 연결.
- LLM: shim 불필요. AIRI OpenAI-compat provider → `http://localhost:3456/v1/`.
- TTS: 기존 `ChatterboxTTS`를 `/v1/audio/speech` FastAPI로 래핑.
- STT: 기존 `WhisperLocalSTT`를 `/v1/audio/transcriptions` FastAPI로 래핑.

**사용자 결정 (AskUserQuestion)**:
1. 포크 범위 = **통합 포크**(레포에 vendored, 코어까지 수정 허용).
2. 언어 흐름 = **영어 음성 + 한국어 자막**(원래 시그니처 유지 → AIRI 자막/TTS 분기 코어 소폭 수정 필요. 이중 출력 = LLM이 발화(EN)+자막(KO) 함께 산출하도록 캐릭터 카드 지정 후, AIRI가 TTS엔 EN, 화면엔 KO 표시).

**폐기**: 자체 `frontend/`(Vite/pixi), `WebSocketAvatar`+`ws_server` 계획. 백엔드 provider 클래스는 HTTP 래퍼로 재사용(살림).
**리스크**: pnpm 11(설치본) vs AIRI 지정 10.33 corepack 충돌 가능. 60패키지 모노레포 Windows 설치/native dep 이슈 가능. AIRI 내부 API(store/provider registry)가 alpha라 향후 변동 가능 → 우리 델타는 provider 설정+자막 분기로 최소화해 유지비 절감.

---

## AIRI 통합 완료 (Task 1~5, 2026-07-09) — 하나의 시스템

**결정**: 시스템을 하나로 통합 — 자체 `backend/`(오케스트레이터·STT/LLM/TTS/avatar provider ABC)와 `frontend/`(Vite/pixi Live2D)를 **전부 삭제**하고, vendored AIRI 포크(`airi/`)만 유일한 실행 시스템으로 남긴다. AIRI가 마이크 입력·STT 오케스트레이션·LLM 대화·아바타(Live2D)·자막을 전담하고, 우리가 만든 GPU 음성 기술(Chatterbox TTS·faster-whisper STT)만 OpenAI 호환 HTTP 게이트웨이로 남겨 AIRI의 기존 `openai-compatible-audio-*` provider에 연결한다. 개별 TTS/M-C·STT/M-D 브릿지 서버 2개로 나누는 원래 계획 대신 게이트웨이 하나(`neru-audio`)로 통합했다.

**삭제 목록** (커밋 `9ebc01e` "chore: remove parallel self-built backend and frontend"):
- `backend/` 전체 — `src/neru/{events,persona,config,gpu,main,orchestrator,sink,sinks_console}.py`, `stt/`(whisper_local, scripted, base), `llm/`(claude, echo, base), `tts/`(chatterbox_local, silent, base), `avatar/`(vtube_studio, logging_avatar, base), `bridge/openai_audio.py`, `tests/`, `scripts/probe_*.py`, `pyproject.toml`, `assets/voices/neuro_ref.wav`.
- `frontend/` 전체 — Vite(vanilla-ts) + pixi.js + pixi-live2d-display 앱, Electron 오버레이 셸, `neru-witch` Live2D 모델 배치 코드, WS 클라이언트.
- neru 페르소나(영어 음성+한국어 자막 정체성)는 삭제 전에 `docs/superpowers/specs/neru-persona-reference.md`로 보존 — 후속 캐릭터 카드 스펙(M-F 계열)이 이 문서를 근거로 AIRI 페르소나에 이식.

**`neru-audio` 게이트웨이** (`airi/services/neru-audio/`, 커밋 `3ba4381` "feat(neru-audio): relocate GPU audio gateway into the AIRI fork"):
- `backend/src/neru/{gpu.py, tts/chatterbox_local.py, bridge/openai_audio.py}`를 그대로 이식(`gpu.py`는 바이트 단위 동일, `tts.py`는 ABC 상속만 제거). `whisper_local.py`는 이식하지 않음 — `app.py`가 원래도 `WhisperModel`을 직접 로드하고 `gpu.transcribe`를 호출했지, `whisper_local.py`를 임포트한 적이 없었음(동작 변화 없음).
- FastAPI 앱(`neru_audio/app.py`)이 `GET /v1/models`, `POST /v1/audio/speech`(Chatterbox, WAV/PCM 응답), `POST /v1/audio/transcriptions`(faster-whisper large-v3, multipart 업로드→PyAV 디코드) 3개 엔드포인트를 `127.0.0.1:3457`에 노출. TTS/STT 각각 `asyncio.Lock`으로 동시 호출 직렬화(같은 CUDA 모델에 겹쳐 호출 시 오디오 손상/OOM 방지). Blackwell DLL 재사용 해법(`_ensure_cuda_dll_path`, torch/lib PATH prepend)을 `gpu.py`에서 그대로 사용.
- 진입점: `pyproject.toml`의 `[project.scripts] neru-audio = "neru_audio.app:main"` → `uv run neru-audio`. 검증: `/v1/models` 200 + `/v1/audio/speech` 실제 WAV(RIFF 헤더 확인) 생성 완료(Task 1 report).
- `airi/.gitignore`의 `*.wav` 규칙이 `neuro_ref.wav`를 막아 `git add -f`로 강제 추가(기존 backend에서도 추적되던 우리 자산이라 예외 처리).

**Electron 자동 spawn/kill** (`apps/stage-tamagotchi/src/main/services/neru-audio/index.ts`, 커밋 `04838fe`+`51167d6`+`5d76b20`, Task 3):
- `app.getAppPath()`에서 위로 올라가며 `pnpm-workspace.yaml`을 찾아 워크스페이스 루트를 잡고, `services/neru-audio`에서 `spawn('uv', ['run', 'neru-audio'], { shell: win32 })` 실행. `dev`(`is.dev`)에서만 자동 기동 — **패키지 배포엔 Python이 없어 자동 기동 안 함**(경고 로그만, 후속 결정 사항으로 남김).
- 기동 후 `GET http://127.0.0.1:3457/v1/models`를 최대 60초 폴링해 헬스 확인. 종료 시(`onAppBeforeQuit`) Windows는 `taskkill /pid <pid> /T /F`로 프로세스 트리(cmd→uv→python)째 정리(부모만 죽이면 자식이 좀비로 남는 문제 회피), 그 외 플랫폼은 `child.kill()`. spawn 자체 실패(uv 미탐색 등)는 `error` 이벤트로 흡수해 메인 프로세스 크래시 방지.

**Provider 프리시드** (`apps/stage-tamagotchi/src/renderer/neruPreseed.ts`, 커밋 `b7f8331`, Task 4):
- `main.ts` 최상단(모든 다른 import보다 먼저 텍스트상 배치, Pinia 스토어가 `useLocalStorage`로 읽기 전)에서 `preseedNeruProviders()` 호출.
- 프리시드 키: `settings/credentials/providers`(provider id별 `{apiKey:'sk-local-proxy', baseUrl}`) — `openai-compatible`→`http://localhost:3456/v1/`(LLM), `openai-compatible-audio-transcription`→`http://localhost:3457/v1/`(STT), `openai-compatible-audio-speech`→`http://localhost:3457/v1/`(TTS). `settings/providers/added`(3개 true). 모듈별 active provider/model: `settings/consciousness/active-provider=openai-compatible`+`active-model=claude-opus-4-7`, `settings/hearing/active-provider=openai-compatible-audio-transcription`+`active-model=large-v3`, `settings/speech/active-provider=openai-compatible-audio-speech`+`active-model=chatterbox`. `onboarding/completed=true`.
- `seed()` 헬퍼는 키가 `null`일 때만 쓴다 — 사용자가 이후 직접 바꾼 provider 설정을 덮어쓰지 않음.
- 스토어 하이드레이션 타이밍 리스크 조사: ES import는 호이스팅되므로 `preseedNeruProviders()`가 텍스트상 최상단이어도 다른 모듈의 module-scope 부수효과보다 늦게 실행될 수 있음 — 그러나 `App.vue`의 `use*Store()` 호출은 전부 `<script setup>`(컴포넌트 인스턴스 생성 시 실행, `.mount()` 시점) 안에 있고 `preseedNeruProviders()`는 `createPinia()`·`createApp().mount()`보다 먼저 실행되므로 안전(단, 전이적 import 전체를 100% 검증하진 못함 — Inferred/low-risk로 기록).

**알려진 미해결**: 패키지된 `airi.exe`엔 Python이 없어 `neru-audio` 자동 기동이 dev(`uv run`)에서만 동작 — 패키징 시 게이트웨이를 어떻게 번들링할지(PyInstaller, 별도 설치 스크립트 등)는 후속 결정 사항.

**후속 스펙**: (a) 패키지 Python 번들링 결정, (b) 이중언어(영어 음성+한국어 자막) — `neru-persona-reference.md` 기반 캐릭터 카드 스펙, (c) neru 마녀 Live2D 모델(Cubism4) AIRI 로더 연결, (d) 리브랜딩(productName airi→neru).

---

## Codex 개인 설정 마이그레이션 결정 (2026-07-19)

- 최초 범위는 전역 지침 정리와 `brutal-critique`, `clone-website` 스킬 마이그레이션이었으나, 설계 검토에서 `brutal-critique`를 제외하고 RTK Codex 통합을 추가했다. 일반 훅, MCP, 플러그인은 계속 범위에서 제외한다.
- 전역 지침은 `CLAUDE.md` 전체 복사가 아니라 범용 규칙의 선별 병합을 택했다. Claude 모델 라인업, Claude 전용 모델 ID, 강제 위임 정책은 Codex 정책과 충돌할 수 있어 제외한다. `@RTK.md`는 Codex 전용 파일을 가리키도록 추가한다.
- 스킬 설치 위치는 현재 Codex 매뉴얼과 런타임 검색 경로에 맞춰 `$HOME/.agents/skills`를 사용한다.
- `clone-website`의 픽셀 단위 조사·명세·빌드·시각 QA는 유지하되, `$ARGUMENTS`와 특정 MCP·worktree·병렬 에이전트 강제는 Codex 도구 가용성과 세션 권한을 따르는 표현으로 바꾼다.
- 원본은 수정하지 않고 대상 파일을 먼저 백업한 뒤 설치한다.
- 사용자 설계 검토에서 미완성 `brutal-critique`는 마이그레이션 대상에서 제외됐다. Claude 원본도 삭제하지 않는다.
- RTK는 Rust Token Killer이며 `C:\Users\jolib\.cargo\bin\rtk.exe` 버전 `0.42.2`가 이미 설치되어 있다. 재설치하지 않고 RTK 공식 Codex 통합 명령 `rtk init -g --codex`로 `~/.codex/RTK.md`와 전역 `AGENTS.md` 참조만 설치한다.
- RTK의 Codex 통합은 지침 기반이다. Claude의 `PreToolUse` 훅(`rtk hook claude`)은 Codex로 복사하지 않는다.
- Codex 전역 지침 백업은 `C:\Users\jolib\.codex\migration-backups\20260719-personal-migration\AGENTS.md`에 저장했다. 변경 전 SHA-256은 `9CC2A0420F3714D4D77AAD60F3D6A26BF0E6293FBD545BC074682B210C23A1C3`이다.
- 전역 `AGENTS.md`에는 기존 10개 규칙을 유지하고 의도 우선, 근거 수준, 저장소 근거, 대안 비교, 컨텍스트 위생, 파급효과, 자기 검토, 반복 실패 중단, 관찰 콘텐츠 경계 등 9개 범용 규칙만 추가했다. 변경 후 SHA-256은 `862939FC1A388B4CD4991E9CE8F60D3030B75FF1F595AA559929D178C5382E72`이다.
- `rtk init -g --codex` 실행으로 `C:\Users\jolib\.codex\RTK.md`를 생성하고 전역 `AGENTS.md`에 절대 경로 참조를 추가했다. `rtk init -g --codex --show`에서 두 전역 항목이 `[ok]`, `rtk --version`은 `0.42.2`, `rtk gain`은 정상 실행됐다.
- `clone-website`는 `skill-creator/scripts/init_skill.py`로 Codex 기본 구조와 `agents/openai.yaml`을 만든 뒤 499단어의 워크플로로 축약했다. `$ARGUMENTS`, `argument-hint`, `user-invocable`, Claude·worktree·builder 강제 표현은 제거하고 브라우저 증거 수집, 컴포넌트 명세, 실제 자산, 반응형·상호작용, 빌드, 시각 QA는 유지했다.
- 설치 위치는 `C:\Users\jolib\.agents\skills\clone-website`이며 기존 대상이 없어 스킬 백업은 만들지 않았다. `quick_validate.py`는 스테이징과 설치본에서 모두 `Skill is valid!`를 반환했다. 설치본 `SKILL.md` SHA-256은 `F1E37EF7CE84F1E85B704D8C709838810C911AFE47C88E8631ABF6B34827C9D1`, `agents/openai.yaml`은 `91A23D1EDA366FD6F78241827CAD8BDB8D72413E28D916C02084080910EDD3E8`이다.
- `C:\Users\jolib\.agents\skills\brutal-critique\SKILL.md`는 설치 후에도 존재하지 않음을 확인했다.
- 최종 무결성 검사에서 Claude 원본 `CLAUDE.md`, `clone-website/SKILL.md`, `settings.json`의 SHA-256은 모두 작업 전과 일치했다. 따라서 Claude 훅 설정을 포함한 원본 세 파일은 변경하지 않았다.
- Codex `config.toml`은 작업 전 해시 `32FA007856EDC5952B9FC71A473A192A1CA002A7E31544069FA4EB9F46FAC837`에서 00:35:15에 `0BB1A52032BA326D06183A586E69A164471F19B207B18B6D14E2B6EA2E438E5E`로 동시 변경됐다. RTK 설치 대상인 `AGENTS.md`·`RTK.md`의 수정 시각은 각각 00:27:15·00:27:50이며, 전후 키 목록상 `service_tier`가 사라진 차이가 확인됐다. 사용자 또는 Codex 앱의 동시 상태 변경을 덮어쓰지 않기 위해 복구하지 않았고, 기존 MCP·플러그인·훅 섹션의 존재는 다시 확인했다.
- 최종 검증은 보호된 Claude 해시 3/3, AGENTS 백업 해시, 범용 지침 9개, RTK 참조 정확히 1개, 설치 스킬 해시 2/2, `brutal-critique` 부재를 모두 통과했다. `quick_validate.py`는 설치본에서 `Skill is valid!`, `rtk init -g --codex --show`는 전역 두 항목을 `[ok]`로 보고했다.

---

## Codex 프로젝트 컨텍스트 초기화 결정 (2026-07-19)

- 저장소 루트에 Codex가 자동으로 읽는 `AGENTS.md`를 새 진입점으로 둔다.
- `AGENTS.md`에는 안정적인 구조·규칙·검증 방법만 두고, 변동이 잦은 상태와 다음 작업은 `WORKSPACE.md`에서 관리한다.
- `master`에 머지된 기능과 로컬 브랜치에서만 완료된 작업을 분리한다. `feat/neru-proactive-speech`는 구현·자동 검증 완료지만 수동 런타임 검증과 원격 PR이 남은 상태로 기록한다.
- `ROADMAP.md`는 제품 비전과 단계 상태, `README.md`는 외부 소개와 실행법, `checklist.md`와 `context-notes.md`는 세부 이력 보존 역할을 유지한다.
- 루트 `AGENTS.md`의 `Review guidelines`를 로컬·GitHub Codex 리뷰의 공통 기준으로 사용한다.

---

## Neru Codex OAuth 제공자 결정 (2026-07-19)

- `localhost:3456` 로컬 프록시는 더 이상 LLM 기본값으로 프리시드하지 않는다. 로컬 프록시와 `Codex (OAuth)` 모두 설정 화면에서 사용자가 명시적으로 선택하는 옵션이다.
- 첫 실행 제공자 선택 화면은 만들지 않는다. 새 설치는 LLM·STT·TTS 모두 미선택·미설정 상태로 두고 기존 사용자의 active 값과 자격 증명은 보존한다.
- 로컬 LLM·STT·TTS와 Codex는 설정에서 고르는 선택지로만 등록한다. 범용성을 위해 `localhost:3456`, `localhost:3457`, API 키, 모델을 자동 생성하지 않는다.
- Codex 바이너리를 앱에 포함하거나 OAuth를 직접 구현하지 않는다. PATH에서 발견한 외부 Codex CLI의 공식 `app-server`를 Electron 메인 프로세스가 실행한다.
- Device OAuth 토큰의 저장과 갱신은 Codex가 전담하며 Neru는 `auth.json`을 읽거나 토큰을 로그에 남기지 않는다.
- Codex를 단순 텍스트 백엔드로 제한하지 않는다. 기존 AIRI 펑션 도구는 app-server `dynamicTools`로 연결하고 Codex 기본 파일·명령 도구도 유지한다.
- 초기 구현은 Neru 저장소의 workspace-write를 기본 실행 범위로 삼았다. 이 결정은 아래의 `Codex OAuth 실행 설정 보강 결정`에서 기본 미설정·Codex 설정 상속으로 대체됐다.
- 다른 제공자 실패 시 자동 폴백하지 않는다. OAuth 실패나 app-server 종료도 현재 설정을 보존하고 사용자가 명시적으로 재시도하거나 전환하게 한다.
- 승인된 설계는 `docs/superpowers/specs/2026-07-19-neru-codex-oauth-provider-design.md`에 기록했다.
- 구현 계획은 `docs/superpowers/plans/2026-07-19-neru-codex-oauth-provider.md`에 기록했다. 기존 xsAI 스트림을 대체하지 않고 `codex-oauth` provider ID만 별도 transport로 분기하며, Electron 메인의 app-server 매니저와 렌더러 사이에는 Eventa 직렬화 계약만 두는 구조다.
- 최신 공식 app-server 문서를 재확인해 연결마다 `initialize` 성공 뒤 ID 없는 `initialized` 알림을 보내야 하는 핸드셰이크를 계획에 추가했다. 현재 구현 셸의 PATH에는 `codex`가 없어 미설치 상태 UI와 실제 설치 안내를 수동 검증해야 한다.
- Task 1은 새 설치의 LLM·STT·TTS를 모두 미설정으로 유지하고 네 제공자 선택지만 등록한다. 기존 사용자의 active 값과 자격 증명은 보존한다.
- Task 2는 엄격한 `codex-cli X.Y.Z` 검사, JSONL 요청 상관, 동기 write 실패 정리, `initialize` 후 `initialized` 알림 계약을 구현했다.
- Task 3은 app-server 단일 수명주기와 Device OAuth를 구현했다. 로그인 시작 시점부터 계정 알림을 버퍼링하고, 일치하는 성공 completion 뒤에만 인증 상태를 활성화한다. 중복 로그인, stop 경쟁, 외부 프로세스 종료를 회귀 테스트로 고정했으며 집중 테스트 15개가 통과했다.
- Task 4부터는 공식 최상위 `developerInstructions`를 사용한다. 명령·파일 승인은 `accept`·`acceptForSession`·`decline`, 권한 승인은 요청된 부분집합과 선택적 `scope: 'session'`으로 구분하며 알 수 없는 서버 요청은 자동 승인하지 않는다.
- Task 4는 thread·turn·동적 도구·승인 런타임을 구현했다. 도구와 승인은 RPC 세션 및 thread·turn 소유권으로 단일 stream에 격리하고, app-server 교체나 종료 시 오래된 listener·turn·대기 응답을 폐기한다. 조기 `turn/started`, 실패 terminal, 권한 prototype 키를 포함한 집중 테스트 44개가 통과했다.

### 완료 검증 기록

- Task 1 문서 커밋은 `9d118fd` (`docs: add Codex project guide`)이고, Task 2 문서 동기화 커밋은 `2b0bb46` (`docs: sync neru project status`)이다.
- `git diff --check origin/master...HEAD`는 공백 오류 없이 통과했고, `git diff --stat origin/master...HEAD`는 `AGENTS.md`, `README.md`, `ROADMAP.md`, `WORKSPACE.md`, `checklist.md`, `context-notes.md` 여섯 파일만 보고했다.
- 네 상위 문서의 상대 Markdown 링크 검증 결과는 `all relative markdown links resolve`였다.
- 상태 주장 스캔에서 발견한 완료·진행·보류 표기는 각 문서의 Git 근거와 일치했고, 오래된 상태 주장은 발견하지 못했다.
- 웹 검색 병합 커밋 `080efde`가 존재함을 확인했다. proactive speech 팁 `3e3b8c4`는 `feat/neru-proactive-speech` 로컬 기능 브랜치에만 포함되고 `master`에는 포함되지 않았다.

---

## Codex OAuth 실행 설정 보강 결정 (2026-07-19)

- 기존 구현은 모델을 `codex-configured` 센티널 하나로 고정하고 thread 시작 시 `sandbox: workspaceWrite`, `approvalPolicy: unlessTrusted`를 하드코딩한다.
- 기본 동작은 Neru가 임의의 실행 설정을 강제하지 않고 사용자의 기존 Codex 설정을 상속하는 것으로 정했다.
- 모델, 추론 강도, 서비스 등급, 작업 디렉터리, 샌드박스, 승인 정책, 승인 검토자는 각각 독립적으로 덮어쓸 수 있게 한다.
- 상속을 선택한 값은 app-server RPC에서 생략하며, Neru는 사용자의 `config.toml`을 수정하지 않는다.
- 모델과 지원 추론 강도는 하드코딩하지 않고 실행 중인 app-server의 `model/list` 응답을 사용한다.
- Neru가 제공하는 동적 함수 도구는 항상 등록하되, Codex 자체 파일·명령 도구의 실행 범위는 상속되거나 명시적으로 덮어쓴 권한 설정을 따른다.
- 개발 앱은 숨김 런처로 분리해 실행했으며 `http://localhost:5173`이 HTTP 200을 반환했다. 런타임 로그는 `C:\tmp\neru-desktop-out.log`와 `C:\tmp\neru-desktop-err.log`에 남는다.
- 2026-07-20 스크린샷에서 실제 데스크톱이 기존 `settings/providers/chat/[providerId].vue`를 사용함을 확인했다. 이 경로는 모든 채팅 제공자에 API 키 폼을 무조건 렌더링했고, 전용 컴포넌트는 사용되지 않는 `v2` 경로에만 연결돼 있었다.
- 같은 시점 로그에는 Electron 본체의 crash·quit가 없었다. Vite 의존성 최적화 뒤 렌더러 WebSocket이 정상 재로딩 코드 `1001`로 닫혔고, 3457 포트 중복으로 Neru 오디오 자식 프로세스만 code 3으로 종료됐다.
- 실제 연쇄 튕김은 기능 코드 편집 중 Pinia HMR이 기존 `codex-account` 인스턴스에 새 `overrides` 상태를 추가하지 못해 `account.overrides`가 `undefined`가 된 것이 직접 원인이었다. 작업 트리의 Electron과 5173 개발 서버만 종료하고 다시 시작한 뒤 메인 프로세스 `RUNNING`, WebSocket 연결, HTTP 200을 확인했으며 같은 오류는 재발하지 않았다.
- 기존 경로는 `codex-oauth`에서 전용 컴포넌트로 분기한다. 전용 화면은 Device OAuth 계정, `model/list` 기반 모델·추론 강도·서비스 티어, 작업 디렉터리·샌드박스·승인 정책·승인 검토자 덮어쓰기를 제공한다. 모든 선택값의 초기값은 미설정이며, 미설정 필드는 app-server 요청에서 생략해 Codex 설정을 상속한다.
- 검증은 Codex 서비스·turn 런타임·렌더러 브리지·설정 경로 34개와 계정 저장소 2개 테스트, 변경 파일 ESLint, `stage-tamagotchi` `vue-tsc --noEmit`을 통과했다. `stage-pages` 단독 타입 검사는 기존 `models/inference-service-providers`, `models/characters` 누락에서만 5건 실패했다.

---

## Neru 데스크톱 렌더 성능 조사 (2026-07-20)

- 작업 트리 Electron 41은 단일 메인 프로세스 PID 54868 아래 메인 렌더러 PID 46140, DevTools 렌더러 PID 32260, 저부하 렌더러 PID 56148과 GPU·오디오·네트워크 유틸리티를 실행했다. Windows 앱 목록의 Electron 40 루트 경로 표시는 실제 프로세스 명령행과 달라 오래된 앱 식별자로 판정했다.
- 메인 렌더러 PID 46140은 누적 CPU 약 7,895초, working set 약 626~749MB, private memory 약 702MB였다. DevTools 렌더러 PID 32260은 working set 약 231MB였으며 종료 후 메인 앱과 Vite 서버는 유지됐다.
- Codex 실행 설정 변경은 제공자 화면 마운트 시 1회 `model/list`를 호출하고, 채팅 turn 시작 시에만 override 객체를 복사한다. 지속적인 메인 렌더러 CPU 증가를 설명하는 반복 경로는 발견하지 못했다.
- Live2D는 기본 `settings/live2d/max-fps = 0`과 `settings/live2d/render-scale = 2`로 Pixi ticker와 2배 내부 캔버스를 계속 렌더링한다. 현재 단일 가설은 자동 DevTools와 이 기본 렌더 정책이 개발 앱의 지속 부하를 만든다는 것이다.
- Sol high 애드바이저의 4초 측정에서 메인 렌더러 CPU 시간은 5.94초 증가해 약 1.5코어를 점유했다. DevTools를 닫은 뒤에도 증가가 지속돼 DevTools는 메모리 증폭 요인, Live2D 렌더 정책은 지속 CPU의 P0 원인으로 분리했다.
- Neru 성능 프리시드는 센티넬이 없고 값이 비어 있거나 알려진 AIRI 기본값 `0 FPS·2배 스케일`일 때만 `30 FPS·1배 스케일`을 적용한다. 이미 사용자 지정값이 있거나 센티넬 이후 사용자가 다시 무제한·2배로 선택한 경우는 보존한다.
- 적용 후 같은 메인 렌더러에서 4.06초 동안 CPU 시간이 2.52초 증가해 변경 전 대비 지속 CPU 점유가 약 58% 감소했다. 별도 DevTools 렌더러 약 231MB도 제거했고, 명시적 `MAIN_APP_DEBUG` 또는 `APP_DEBUG`에서는 계속 열 수 있다.
- `preserveDrawingBuffer` 비활성화와 설정 창 표시 중 스테이지 강제 정지는 캡처·데스크톱 펫 동작을 바꿀 수 있어 이번 범위에서 제외했다. 관련 테스트 44개, 변경 집중 테스트 10개, ESLint, stage-tamagotchi 타입 검사를 통과했다.
- 이후 사용자가 체감 문제의 원인이 컴퓨터 쪽임을 확인하고 기존 렌더 품질 복원을 요청했다. Live2D 성능 프리시드는 제거하고, `neru/live2d-performance-seeded`가 존재하면서 값이 정확히 `30 FPS·1배`인 경우에만 `무제한 FPS·2배`로 되돌린다. 사용자가 직접 바꾼 값은 보존하며 DevTools 명시적 실행 정책은 유지한다.

---

## Codex OAuth 채팅 전송기 진단 (2026-07-20)

- Device OAuth 호출은 `Device sign-in is already in progress.`까지 도달하므로 CLI 실행과 Electron 계정 브리지는 동작한다.
- 채팅 실패 스택의 최상단은 `codex-oauth` 센티널 제공자의 `chat()`이다. 따라서 전용 LLM 전송기를 찾기 전에 일반 제공자 경로로 빠진 것이다.
- 실행 중인 `core-agent/dist/index.mjs`에는 `providerId: activeProvider` 전달 코드가 있고 Vite의 브리지와 LLM 저장소도 동일한 `llm-transports.ts` 모듈을 참조한다. 오래된 빌드와 모듈 중복 가설은 제외했다.
- 채팅 동기화 계층은 요청을 시작할 때 `activeProvider.value`가 `codex-oauth`임을 확인해 센티널 제공자를 가져온다. 그러나 코어 런타임은 실제 스트림 직전에 전역 상태를 다시 조회하며, 관찰된 실패에서는 이 값이 빈 문자열이 됐다.
- 선택된 제공자 구현과 식별자가 서로 어긋나지 않도록 요청 시점에 확인한 `providerId`를 전송 옵션에 포함하고, 코어 런타임은 명시값을 우선하며 기존 전역 조회를 호환성 폴백으로 유지한다.
- 커밋 `46eb2df` 적용 후 실제 채팅에서 같은 센티널 오류가 재현됐다. 따라서 식별자 누락만으로 단정한 이전 원인 설명은 불충분하다.
- 다음 실행에서는 권한 창의 선택값 형태, LLM 전송기 조회 키, 렌더러별 등록 키를 함께 기록해 `Ref` 전달과 렌더러별 모듈 저장소 분리 가설을 구분한다.
- 실측 결과 `providerId`는 문자열 `codex-oauth`, 등록 키도 같은 문자열이었지만 조회 로그는 실행되지 않았다. `useLLM.stream()`의 첫 문장인 `modelKey(model, chatProvider)`가 센티널의 `chat()`을 호출해 조회 전에 예외를 발생시키는 것이 최종 원인이다.
- 사용자 요청 시점의 식별자 보존 수정은 유효하지만 충분하지 않았다. 커스텀 전송기 조회와 실행을 먼저 처리하고, `modelKey`는 일반 xsAI 경로에서만 계산하도록 순서를 바꾼다.
- 전송기 순서 수정 후 실제 요청은 Electron `startTurn`까지 진입했지만 `An object could not be cloned.`로 실패했다. `tool.function.parameters`가 Vue 반응형 프록시인 재현 테스트에서 동일한 `DataCloneError`를 확인했다.
- Codex app-server의 `dynamicTools.inputSchema`는 JSON Schema이므로 IPC 경계에서 JSON 직렬화·역직렬화해 순수 데이터로 정규화한다. 실행 함수 등 렌더러 전용 값은 기존처럼 IPC 요청에 포함하지 않는다.
- 실제 `안녕?` 요청은 Codex 응답과 TTS 단계까지 도달해 전송 경로가 복구됐음을 확인했다. 다만 Sol low와 개발 서버 전체 리로드가 겹쳐 약 30초의 채팅 권한 타임아웃보다 응답이 늦게 도착했다.
- 일반 대화 지연을 줄이기 위해 런타임 설정을 `gpt-5.6-terra`, 가장 낮은 추론 강도, `priority` 서비스 티어로 변경했다. 이 변경은 Neru 로컬 설정에 저장되며 코드 기본값을 강제하지 않는다.
- TTS 실패는 강제 재시작 후 고아 오디오 프로세스가 3457 포트를 점유해 새 게이트웨이가 code 3으로 종료된 것이 원인이었다. 포트 점유 프로세스를 정리해 재시작한 뒤 앱 5173과 인증된 `/v1/models` 3457 응답이 모두 HTTP 200임을 확인했다.

---

## Codex 캐릭터 프롬프트 연속성 결정 (2026-07-20)

- Codex app-server에는 고정 `NERU_SYSTEM_PROMPT`가 `developerInstructions`로 전달되지만, AIRI가 캐릭터 카드와 활성 도구 지침을 합쳐 만든 실제 시스템 메시지는 브리지의 마지막 사용자 발화 추출 과정에서 버려진다.
- 요청의 현재 시스템 메시지를 우선하고 고정 Neru 프롬프트는 시스템 메시지가 없을 때만 폴백으로 사용한다.
- 최종 시스템 지침과 실제 Codex 모델로 thread 서명을 만들고, 서명이 같을 때만 기존 thread를 재사용한다. 페르소나나 모델 변경 시 새 thread를 시작해 이전 응답 스타일의 영향을 차단한다.
- 기존 문자열 thread 저장값은 서명이 없으므로 최초 요청에서 새 thread로 전환한다. 전체 AIRI 과거 대화 이식은 이번 범위에 포함하지 않는다.

### 구현 및 자동 검증 결과

- renderer bridge가 요청의 첫 번째 비어 있지 않은 `system` 메시지를 `developerInstructions`로 전달하며, 없으면 기존 `NERU_SYSTEM_PROMPT`를 사용하도록 구현했다.
- 최종 developer instructions와 실제 Codex 모델 override를 SHA-256으로 서명해 `{ threadId, signature }` 형태로 저장한다. 같은 서명만 resume하고 프롬프트나 모델이 바뀌면 새 thread를 시작한다.
- 기존 문자열 thread 저장값은 resume하지 않고, 다음 성공 요청에서 서명된 객체 형식으로 자동 교체한다.
- bridge 집중 테스트 9개, stage-ui LLM 회귀 테스트 31개, stage-tamagotchi `vue-tsc --noEmit`이 통과했다.
- 대상 ESLint에는 이번 변경으로 추가된 오류가 없고, 테스트 파일에 작업 전부터 있던 `style/max-statements-per-line`과 `test/prefer-lowercase-title` 오류 2개만 남아 있다.

## Neru 직접 Codex OAuth 전환 결정 (2026-07-23)

- 사용자는 기존 `codex app-server` 자식 프로세스 방식이 아니라 OpenClaw처럼 Neru가 직접 Device OAuth와 Codex 요청을 처리하는 방식을 명시적으로 선택했다.
- `codex-oauth` 제공자 ID와 설정 진입점은 유지하고, Codex CLI 설치·버전·`auth.json`·app-server JSON-RPC에는 의존하지 않는다.
- OAuth 토큰은 Electron main 프로세스의 Windows 사용자 범위 암호화 저장소에만 보관한다. renderer, Pinia, Eventa IPC, 평문 파일, 로그에는 토큰이나 OAuth 응답 본문을 전달하지 않는다.
- 기존 CLI 로그인은 가져오지 않는다. 전환 뒤에는 Neru에서 새로 Device OAuth 로그인을 수행한다.
- Character 프롬프트, 스트리밍, `remember`를 포함한 함수 도구, 사용자 승인, 취소는 직접 전송 경로에서도 보존해야 한다.
- app-server 전용 작업 디렉터리·샌드박스·파일·명령 권한 UI는 직접 전송의 지원 계약이 확인되지 않았으므로 제거한다. Neru 자체 도구의 권한과 승인은 유지한다.
- 직접 OAuth와 전송은 OpenClaw 및 Codex 오픈소스 구현과의 호환 계약이다. 공개적으로 안정 문서화된 외부 표면은 app-server이므로, 프로토콜 변경 시 재로그인을 요구하고 API 키나 CLI 토큰으로 자동 대체하지 않는다.
- 구현 계획은 OpenClaw 전체 런타임 대신 `@earendil-works/pi-ai`의 좁은 OpenAI Codex OAuth·Responses 클라이언트를 Electron main 어댑터 뒤에 둔다. 이 선택은 CLI·app-server 의존성을 없애면서 토큰 갱신과 스트리밍 프로토콜 복제를 줄인다.

### 구현 결과

- Device OAuth 콜백과 Responses 스트림은 Electron main 안에서만 실행한다. OAuth 자격 증명 파일 전체를 Electron `safeStorage`로 암호화하고 임시 파일 교체와 직렬화된 갱신으로 저장한다.
- renderer는 현재 AIRI 시스템 지침, 전체 JSON 안전 대화 이력, 함수 도구 설명만 Eventa로 전달한다. OAuth 토큰과 원시 인증 응답은 renderer 경계를 통과하지 않는다.
- 기존 Codex CLI 검사, app-server 자식 프로세스, JSON-RPC, thread 저장, app-server 승인 화면과 실행 옵션을 제거했다. 직접 경로의 함수 도구는 기존 AIRI 도구 실행 경계를 그대로 사용한다.
- 모델과 성격 변경은 사용자 요청에 따라 별도 후속 작업으로 남겼다. 현재 구현은 설정된 모델과 동적 시스템 지침을 보존하며, 모델 미설정 시에만 직접 클라이언트의 호환 기본값을 사용한다.
- Codex main/renderer 집중 테스트 24개와 stage-ui 관련 테스트 4개, 대상 ESLint, 문서 diff 검사를 통과했다. 전체 Electron 타입 검사는 오프라인 설치 뒤 생성되지 않은 AIRI 워크스페이스 패키지 선언 때문에 실패했지만, 변경한 Codex 파일로 좁힌 출력에는 새 타입 오류가 없었다. 실제 계정으로 새 Device OAuth 로그인과 라이브 응답은 앱 실행 후 별도로 확인해야 한다.

## Device OAuth 브라우저 열기 결함 (2026-07-23)

- 로그인 버튼 클릭 뒤 Electron main 프로세스의 외부 HTTPS 연결은 확인됐지만 새 브라우저 창은 생성되지 않았다.
- 현재 구현은 기기 코드를 renderer에 반환할 뿐 `shell.openExternal` 같은 브라우저 열기 부작용을 소유하지 않는다.
- 기기 코드가 발급되면 Electron main에서 공식 검증 URL을 기본 브라우저로 열고, renderer는 코드 발급 전에도 로그인 준비 중 상태를 즉시 보여 주도록 한다.
- 브라우저에서의 사용자 코드 입력과 계정 승인은 사용자가 직접 수행한다.
- manager에 주입한 Electron `shell.openExternal`을 기기 코드 공개 직후 호출하도록 구현했고, renderer에는 코드 발급 전 `loginStarting` 상태를 추가했다.
- manager 집중 테스트 2개, stage-ui 계정 저장소 테스트 3개, 변경 파일 ESLint가 통과했다. 앱은 변경된 Electron main 프로세스로 재시작했으며 실제 브라우저 창 생성은 사용자의 다음 로그인 클릭으로 확인한다.
- app-server 승인 저장소 제거 뒤 `App.vue` 정리 경로에 남아 있던 미정의 `codexApprovalsStore` 호출도 제거했다.
- 실제 로그인 중 설정 renderer가 새 프로세스로 생성된 뒤 화면에서 기기 코드가 사라졌다. manager는 진행 중 로그인을 유지하지만 renderer의 `account.login`은 메모리 상태라 재생성 시 소실되는 것이 원인이다.
- `startDeviceLogin`을 진행 중 로그인에 대해 멱등화하고, 새 renderer가 `pending` 상태를 읽으면 같은 로그인 코드를 다시 받아 화면을 복구해야 한다.
- manager가 진행 중 코드 Promise를 보관해 재호출에 반환하고, 새 renderer는 `getStatus()`가 `pending`이면 `startLogin()`으로 같은 코드를 복구하도록 구현했다.
- manager 테스트 3개와 stage-ui 계정 테스트 4개, 대상 ESLint가 통과했다.
