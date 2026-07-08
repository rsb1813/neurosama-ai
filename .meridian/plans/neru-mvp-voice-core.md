# neru — AI VTuber (Neuro-sama급) : MVP 실시간 음성 대화 코어

## Context

**목표**: Neuro-sama와 동등하거나 그 이상인 AI 버튜버 `neru`를 만든다. 최종 기능군은 실시간 음성 대화, YouTube 같이보기, 게임 플레이, 채팅 소통, 사람 같은 컴퓨터 제어/코딩/에이전트, 장기기억, 능동 발화, 멀티 페르소나 협업이다. 참조: Project AIRI(검증됨), Neuro-sama(대부분 커뮤니티 추정).

**왜 이 계획인가**: 전체는 다중 독립 서브시스템의 집합이라 한 번에 설계·구현할 수 없다. "하나의 수직 슬라이스를 끝까지 동작시킨 뒤 확장" 원칙에 따라 **첫 슬라이스 = 실시간 음성 대화 코어**를 먼저 완성한다. 이 코어(STT→LLM→TTS 스트리밍 + 끼어들기 + 아바타 립싱크)는 이후 모든 기능이 얹히는 뼈대다.

**확정된 방향** (사용자 결정):
- 언어 흐름: **사용자 한국어 발화 → neru 영어 음성 답변(Neuro-sama처럼) + 화면 한국어 자막**
- 스택: **하이브리드** — Python 두뇌·음성 백엔드 + TypeScript 프론트(자막/대시보드)
- LLM: **Claude 클라우드 API** (초기). provider 인터페이스 뒤에 두어 후일 로컬/하이브리드 교체 가능
- STT: **로컬**(상당한 GPU 보유) — 저지연·무료·프라이버시
- TTS: **ElevenLabs**(영어 스트리밍, 고품질 저지연) 추천 — provider 인터페이스로 교체 가능(Azure "Ashley" = Neuro-sama 정통 대안)
- 아바타: **VTube Studio + Live2D**(외부 앱, 오디오 라우팅 자동 립싱크) — 가장 빠르고 검증된 경로
- 송출(Twitch/YouTube/OBS)은 **이번 범위 제외**, 아바타는 포함

**MVP 성공 기준**: 마이크에 한국어로 말하면 ~1–3초 내에 neru가 영어 음성으로 답하고, VTube Studio 아바타 입이 그 음성에 맞춰 움직이며, 화면에 한국어 자막이 뜬다. 내가 말하기 시작하면 neru가 즉시 말을 멈춘다(끼어들기).

---

## 전체 로드맵 (서브프로젝트 분해)

각 항목은 독립 spec→plan→구현 사이클을 가진다. 이 계획은 **1번만** 다룬다.

1. **[이번] 실시간 음성 대화 코어** — STT→LLM→TTS 스트리밍 파이프라인 + 끼어들기 + 아바타 립싱크 + 자막
2. 장기기억 (벡터DB/RAG, pgvector 또는 DuckDB)
3. 능동 발화 (idle 타이머·이벤트 기반 prompter 고도화)
4. 채팅 통합 (Twitch/YouTube 채팅을 신뢰 불가 입력으로 취급)
5. 송출 (OBS WebSocket 합성)
6. 게임 에이전트 (Neuro Game SDK식 텍스트 액션 프로토콜, 게임별 컨트롤러)
7. 컴퓨터 제어/코딩 에이전트 (Claude 도구 사용 기반)
8. 멀티 페르소나 (Evil neru 등 별도 소울, 상호 대화)
9. YouTube 같이보기

---

## MVP 아키텍처

**파이프라인** (전 구간 스트리밍, 지연 예산 ~1–3초):
```
한국어 마이크 → VAD → 로컬 STT(ko) → orchestrator → Claude(영어 답변 + 한국어 자막)
   → ElevenLabs TTS(영어) → 스피커/가상케이블 → VTube Studio 자동 립싱크
                                              → 프론트 한국어 자막 오버레이
   ↑ VAD가 사용자 발화 재감지 시 barge-in: TTS 재생 중단 + LLM 스트림 취소
```

**설계 철학** (AIRI 구조 차용): 이벤트 버스로 모듈 격리, 각 provider(STT/LLM/TTS/아바타)는 얇은 인터페이스 뒤에 두어 교체 가능. 모든 I/O 스트리밍.

**컴포넌트** (Python `asyncio`, 각 모듈 독립 태스크, 중앙 이벤트/시그널 버스로 통신):

| 모듈 | 역할 | 핵심 기술 |
|------|------|-----------|
| `audio_input` | 마이크 캡처 + VAD | `sounddevice`, Silero VAD |
| `stt` | 한국어 스트리밍 전사 | RealtimeSTT / faster-whisper (large-v3, GPU) |
| `orchestrator` | 턴테이킹 상태머신, 발화 타이밍·barge-in 신호 | 자체 구현 (이벤트 버스) |
| `llm` | Claude 스트리밍, 페르소나 프롬프트, 영어답변+한국어자막 산출 | `anthropic` SDK |
| `tts` | 영어 스트리밍 합성, 문장 청킹 | `elevenlabs` SDK |
| `avatar_bridge` | VTube Studio 제어 + 오디오 라우팅 립싱크 | `pyvts`, VB-Audio Virtual Cable |
| `bus` | 모듈 간 이벤트/시그널 공유 | asyncio 큐/이벤트 |
| `ws_server` | 프론트와 WebSocket(자막·상태 push) | `websockets` |
| `frontend`(TS) | 한국어 자막 오버레이 + 상태 대시보드 | Vite + 경량 TS, WebSocket 클라이언트 |

---

## 언어 파이프라인 상세

- **STT**: Whisper 한국어 모드로 사용자 발화를 한국어 텍스트로.
- **LLM**: 시스템 프롬프트에 "너는 neru, 영어로 말하는 AI 버튜버. 사용자의 한국어 입력을 이해하고 **영어로** 답한다"를 명시. 출력은 **구조화**하여 (a) 영어 발화 텍스트(TTS용), (b) 한국어 자막 텍스트를 함께 산출. 단순 시작안: 영어 답변만 생성 후 자막은 한국어 번역(추가 호출 또는 동일 호출에서 두 필드 산출). → 후자를 채택(단일 호출로 `{speech_en, subtitle_ko}` 산출)해 지연·비용 절감.
- **TTS**: 영어 텍스트만 ElevenLabs로 합성.
- **자막**: 한국어 텍스트를 프론트 오버레이에 스트리밍 표시.

---

## 끼어들기(barge-in)

VAD가 TTS 재생 중 사용자 발화를 감지하면 orchestrator가 (1) TTS 오디오 재생 중단, (2) 진행 중 LLM 스트림 취소, (3) 상태를 listening으로 전환. 이는 "저지연·끼어들기" 요구의 핵심이며 MVP 포함.

---

## 프로젝트 구조 (생성할 파일)

> CLAUDE.md 규약: 새 소스 파일 첫 줄은 역할을 설명하는 **한국어 주석 헤더**, 코드 식별자·문자열은 영어, 주석은 한국어. config 파일은 헤더 생략.

```
neru/
├─ backend/
│  ├─ pyproject.toml            # uv 또는 poetry, 의존성 핀
│  ├─ src/neru/
│  │  ├─ bus.py                 # 이벤트/시그널 버스
│  │  ├─ orchestrator.py        # 턴테이킹 상태머신 + barge-in
│  │  ├─ audio/input.py         # 마이크 캡처 + VAD
│  │  ├─ stt/base.py            # STT provider 인터페이스
│  │  ├─ stt/whisper_local.py   # RealtimeSTT/faster-whisper 구현
│  │  ├─ llm/base.py            # LLM provider 인터페이스
│  │  ├─ llm/claude.py          # Claude 스트리밍 구현 (speech_en + subtitle_ko)
│  │  ├─ tts/base.py            # TTS provider 인터페이스
│  │  ├─ tts/elevenlabs.py      # ElevenLabs 스트리밍 구현
│  │  ├─ avatar/vtube_studio.py # pyvts 제어 + 오디오 라우팅
│  │  ├─ persona.py             # neru 시스템 프롬프트/성격
│  │  ├─ ws_server.py           # 프론트 WebSocket 서버
│  │  ├─ config.py              # env 기반 설정 (API 키 등)
│  │  └─ main.py                # 엔트리포인트: 모듈 조립·실행
│  └─ tests/                    # provider mock 단위테스트 + 통합 하네스
├─ frontend/
│  ├─ package.json
│  ├─ index.html
│  └─ src/                      # 자막 오버레이 + 대시보드, WebSocket 클라이언트
├─ .env.example                 # ANTHROPIC_API_KEY, ELEVENLABS_API_KEY 등 (키 커밋 금지)
├─ .gitignore                   # .env, 모델 캐시, node_modules 등
└─ README.md                    # (영어) 설치·실행
```

**provider 인터페이스 패턴** (교체성 핵심): `stt/base.py`·`llm/base.py`·`tts/base.py`는 각각 async 스트리밍 메서드를 정의하는 추상 베이스. 구현체는 이를 상속. orchestrator는 베이스 타입에만 의존.

---

## 의존성 주의 (§4 — 메모리 아닌 실제 버전 확인)

아래는 후보이며, **설치 시점에 최신 버전을 확인해 핀**한다. 절대 기억에 의존해 API를 작성하지 말고 설치된 버전 문서를 확인:
- Python: `anthropic`(Claude), `elevenlabs`, `RealtimeSTT` 또는 `faster-whisper`, `silero-vad`/`webrtcvad`, `sounddevice`, `pyvts`, `websockets`, `pytest`
- 시스템: **VTube Studio**(외부 앱, API 활성화), **VB-Audio Virtual Cable**(TTS→VTube Studio 오디오 라우팅), CUDA 지원 PyTorch(로컬 Whisper GPU)
- Claude 모델 ID·가격·파라미터는 `claude-api` 스킬로 확인 후 사용

---

## 마일스톤 (증분, 각 단계 검증 가능)

1. **골격 + provider 인터페이스** → 검증: `main.py`가 mock STT/LLM/TTS로 "한 바퀴" 돌며 콘솔에 흐름 로그 출력, 테스트 통과
2. **로컬 STT 실동작** → 검증: 마이크 한국어 발화 → 한국어 텍스트 정확 전사(로그)
3. **Claude LLM 연결** → 검증: 한국어 텍스트 입력 → `{speech_en, subtitle_ko}` 스트리밍 산출, 페르소나 반영
4. **ElevenLabs TTS** → 검증: 영어 텍스트 → 스피커로 자연스러운 영어 음성, 첫 오디오까지 지연 측정
5. **전체 파이프라인 연결 + barge-in** → 검증: 말하면 답하고, 내가 끼어들면 즉시 멈춤. 왕복 지연 ~1–3초 확인
6. **VTube Studio 아바타 립싱크** → 검증: TTS 음성에 맞춰 아바타 입 움직임(가상 케이블 라우팅)
7. **TS 프론트 자막 오버레이** → 검증: 한국어 자막이 발화와 동기되어 화면 표시

---

## 검증 (엔드투엔드 테스트 방법)

- **단위**: 각 provider를 mock으로 대체한 orchestrator/버스 테스트 (`pytest backend/tests`). barge-in 상태전이 테스트 포함.
- **통합 하네스**: 녹음된 한국어 wav를 STT에 주입 → 파이프라인이 영어 텍스트 + 한국어 자막 + 오디오를 산출하는지 자동 검증 + 각 구간 지연 측정.
- **수동 엔드투엔드**: 실제 마이크 + VTube Studio 실행 상태에서 대화. barge-in, 립싱크, 자막 동기, 왕복 지연을 육안·귀로 확인.
- CLAUDE.md §12에 따라 각 마일스톤에서 테스트/빌드 실행 후 다음 단계로.

---

## 열린 결정 / 리스크

- **VTube Studio 오디오 립싱크**: VB-Cable로 TTS 출력을 VTube Studio "마이크" 입력에 라우팅하는 방식(kimjammer/Neuro 검증). 대안: pyvts로 입 파라미터 직접 주입. 구현 6단계에서 라우팅 우선 시도.
- **자막 생성 방식**: 단일 Claude 호출로 `{speech_en, subtitle_ko}` 동시 산출(채택). 품질 이슈 시 별도 번역 단계로 전환.
- **STT 한국어 저지연**: large-v3 정확하나 무거움 → GPU에서 지연 측정 후 필요 시 모델 크기/스트리밍 파라미터 조정.
- **비용**: Claude + ElevenLabs 유료. `.env`로 키 관리, 절대 커밋 금지(§18 시크릿 스캔).

## 구현 착수 시 (플랜 모드 종료 후)

- 이 계획을 정식 spec 문서로 승격(`docs/superpowers/specs/`)하고 체크리스트·컨텍스트 노트 생성(CLAUDE.md §11) 후 마일스톤 1부터 시작.
