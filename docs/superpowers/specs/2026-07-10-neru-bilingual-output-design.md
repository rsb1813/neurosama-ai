# neru 이중언어 출력 설계 — 영어 음성 + 한국어 화면

> 상태: 설계 확정 대기(사용자 리뷰). 구현 계획은 writing-plans로 별도 작성.
> 날짜: 2026-07-10

## Goal

사용자가 **한국어로 말하면** neru가 **영어 음성**으로 답하고, **화면(채팅 패널 + 자막 오버레이)에는 한국어**가 표시된다. neru의 시그니처 기능이며, 오늘 검증한 라이브 루프(마이크→STT→LLM→TTS→아바타) 위에 얹는다.

## Context — 현재 AIRI 흐름 (매핑 확인됨)

핵심 제약: **화면 텍스트 = 음성 텍스트 = 자막이 전부 하나의 문자열(`speechOnly`)에서 파생**된다. "말하는 것"과 "보여주는 것"의 분리가 아직 없다 — 우리가 만든다.

- LLM 스트림 조립: `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts`의 `performSend` → `onLiteral`(:507-534)에서 `speechOnly`를 만들어 `buildingMessage.content += speechOnly`(:518, 화면)와 `emitTokenLiteralHooks(speechOnly)`(:520, TTS)로 **동시에** 흘린다.
- 마커 파서: `packages/core-agent/src/runtime/llm-marker-parser.ts` — 스트림을 리터럴 vs `<|...|>` 특수토큰으로 분리(감정/모션이 이 out-of-band 채널로 나감).
- 응답 카테고라이저: `packages/core-agent/src/runtime/response-categoriser.ts:32-35` — 현재 **모든 XML 태그를 `reasoning`으로 취급해 음성·화면 양쪽에서 버린다**. `filterToSpeech`(:367).
- TTS fan-out: `apps/stage-tamagotchi/src/renderer/.../Stage.vue:766-796` — `onTokenLiteral(literal => currentSession.appendText(literal))`(:782-784).
- 문장 세그먼트: `packages/pipelines-audio/src/processors/tts-chunker.ts` — `Intl.Segmenter` 단어 단위, 4~12단어로 청킹. 각 세그먼트가 오디오 1개 → 자막 1프레임.
- 자막 오버레이: 별도 Electron 창 `apps/stage-tamagotchi/src/renderer/pages/caption.vue`, BroadcastChannel `airi-caption-overlay`. `Stage.vue:539-564`의 `onStart`(오디오 세그먼트 재생 시작 콜백)에서 `postCaption({ type: 'caption-assistant', text: item.text })`(:552)로 **오디오와 동기**되어 나간다.
- 시스템 프롬프트: `packages/stage-ui/src/stores/modules/airi-card.ts:428-441` — 활성 카드의 `systemPrompt`/`description`/`personality`를 합침. `session-store.ts`가 이를 세션 시스템 메시지로 넣음. 카드 프롬프트로 출력 언어를 확실히 제어 가능.

## 확정된 결정

1. **언어 정책**: 화면(채팅 패널 + 자막 오버레이) = **한국어 전용**. 음성 = **영어 전용**. 영어 텍스트는 TTS로만 가고 화면엔 표시하지 않는다.
2. **자막 생성 방식**: LLM이 한 응답에서 영어(음성)와 한국어(자막)를 **함께** 생성(구조화 출력). 별도 번역 호출 없음 — 단일 호출, 문맥 유지, 고품질 한국어, 캐릭터 유지.
3. **접근**: Seam B — 구조화 마커 emission + 파서 분기.

## 마커 포맷

LLM(neru 카드 프롬프트)이 문장 단위로 영어를 말하고, 각 영어 문장 뒤에 그 한국어 번역을 `<ko>...</ko>`로 병기한다.

```
Hey chat! <ko>안녕 여러분!</ko> How are you today? <ko>오늘 어때?</ko>
```

- 태그 **밖 영어** → 음성(TTS) 채널.
- `<ko>` **안 한국어** → 화면(채팅 패널 + 자막) 채널.
- `<ko>` 형식을 고른 이유: AIRI가 이미 XML 태그를 out-of-band로 추출(현재는 버림)하므로 그 기계를 확장하는 게 가장 자연스럽다.

## 개입 지점 (3곳)

### 1. neru 페르소나 카드 (프리시드)
- `docs/superpowers/specs/neru-persona-reference.md`의 보존된 페르소나(재치있고 장난기 있는 Neuro-sama류) + `<ko>` 포맷 지시를 합친 시스템 프롬프트로 neru 카드를 구성.
- `airi-cards`(Map) + `airi-card-active-id`를 authoritative preseed로 심어 활성 카드로 지정. 기존 `neruPreseed.ts`의 방식 재사용(스칼라는 단언, Map은 병합).
- 프롬프트는 엄격해야 한다: 문장마다 정확히 하나의 `<ko>` 쌍, 태그 밖엔 영어만, 마크다운/번호매김 금지.

### 2. 응답 파서 분기 (english=speech, ko=display)
- `response-categoriser.ts`가 지금은 모든 태그를 버리는데, `<ko>` 태그를 인식해 그 내용을 **화면 채널**로 라우팅한다(버리지 않음).
- `chat-orchestrator-runtime.ts`의 `onLiteral`(:507-534)을 수정:
  - 태그 밖 영어 리터럴 → **TTS 훅으로만**(`emitTokenLiteralHooks`), `buildingMessage.content`에는 넣지 않음.
  - `<ko>` 내용 → `buildingMessage.content`(채팅 패널 한국어) + 자막 채널로, TTS에는 넣지 않음.
- 즉 현재 "영어가 화면+음성 양쪽"인 것을 "영어=음성, 한국어=화면"으로 **채널을 바꾼다**.

### 3. 자막 동기화
- 자막 오버레이는 지금 오디오 세그먼트(`item.text`, 영어 4~12단어)마다 나간다. 우리는 여기에 **매칭되는 한국어**를 표시해야 한다.
- 접근: 영어 문장 → 한국어 번역을 **순서 큐**로 짝지어 두고, 각 영어 TTS 세그먼트에 **원본 문장 인덱스**를 태깅. 오디오 세그먼트 재생 시작(`onStart`) 시 그 문장 인덱스의 한국어를 자막으로 표시.
- 채팅 패널의 한국어는 오디오 동기 불필요 — 파싱되는 대로 누적.
- **이 정렬이 핵심 구현 리스크**다. 구현 계획에서 문장↔세그먼트 매핑을 구체화한다.

## 데이터 흐름

```
사용자 한국어 발화
  → STT(:3457) → 한국어 텍스트
  → Claude(:3456, neru 카드 시스템 프롬프트)
  → 스트림: "English. <ko>한국어.</ko> ..."
      ├─ 영어(태그 밖)  → TTS(:3457) → 오디오 재생 → 아바타 립싱크
      └─ 한국어(<ko>)   → 채팅 패널(누적) + 자막 큐
                          → 매칭 영어 세그먼트 재생 시 자막 오버레이 표시
```

## 에러 처리 / 폴백

- LLM이 어떤 문장에 `<ko>`를 빠뜨림 → 그 문장은 폴백으로 영어를 화면에 표시(정보 손실 방지). 파이프라인은 멈추지 않는다.
- `<ko>` 짝이 영어 문장 수와 어긋남 → 순서 큐 best-effort 매칭. 남는 한국어는 마지막에 flush.
- 태그가 중첩/미완결 → 파서는 미완결 태그를 버퍼링하고 완결 시 방출(기존 마커 파서의 버퍼링 규약 준수).

## 범위 밖 (YAGNI)

- 번역 품질 튜닝, 다중 언어(일본어 등) 확장.
- 스트리밍 TTS(공식 bidirectional-ws) 경로 — 기본 REST 세그먼트 경로만 대상.
- neru 마녀 Live2D 모델, 리브랜딩(별도 로드맵).

## 테스트

- 파서 단위테스트: `"English. <ko>한국어.</ko>"` 입력 → speech 채널="English.", display 채널="한국어." (분리 검증).
- 폴백 테스트: `<ko>` 없는 문장 → 영어가 화면 폴백으로.
- 짝 어긋남 테스트: 영어 3문장 + `<ko>` 2개 → best-effort 큐 동작.
- 카드 프리시드 테스트: 클린 localStorage에서 neru 카드가 활성으로 심기고 시스템 프롬프트에 언어 규칙이 포함됨.
- 수동 E2E: `pnpm desktop`에서 한국어 발화 → 영어 음성이 들리고 화면엔 한국어 자막이 동기되어 표시.

## 성공 기준

한국어로 말하면 neru가 **알아들을 수 있는 영어 음성**으로 답하고, **채팅 패널과 자막 창에 한국어**가 (자막은 음성과 대략 동기되어) 표시된다.
