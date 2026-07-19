# Neru Codex OAuth 제공자 설계

**상태:** 사용자 설계 승인 완료. 구현 계획 작성 전 문서 검토 대기.

## 목표

Neru의 LLM 제공자를 자동 지정하지 않고 설정 화면에서 사용자가 다음 두 방식 중 하나를 명시적으로 선택하게 한다.

- 사용자가 직접 구성하는 로컬 OpenAI 호환 프록시.
- 설치된 Codex CLI가 관리하는 ChatGPT Device OAuth 기반 Codex.

첫 실행 선택 화면은 추가하지 않는다. 새 설치에서는 LLM·STT·TTS를 모두 미선택·미설정 상태로 유지하고, 기존 설치의 제공자 설정은 보존한다. 로컬 `neru-audio` STT와 TTS는 설정에서 사용자가 고를 수 있는 선택지로 제공한다.

## 결정된 범위

- `localhost:3456`과 특정 모델을 LLM 기본값으로 주입하는 동작을 제거한다.
- 로컬 프록시는 설정 화면에서 주소, API 키, 모델을 입력하고 사용자가 선택할 때만 활성화한다.
- Codex는 별도 포함 바이너리가 아니라 사용자의 PATH에서 발견한 최신 Codex CLI를 사용한다.
- 지원 하한은 현재 안정판 `codex-cli 0.144.4`로 두고, 버전 문자열뿐 아니라 초기화 시 Device OAuth와 `dynamicTools` 기능을 실제로 프로브한다.
- OAuth 토큰을 Neru가 읽거나 저장하지 않는다. 인증, 보관, 갱신, 로그아웃은 Codex `app-server`가 담당한다.
- Codex의 파일 도구와 명령 도구를 유지한다.
- Neru의 `remember` 등 기존 펑션 도구를 Codex 동적 도구로 연결한다.
- 기본 권한은 Neru 저장소에 한정된 workspace-write이며, 범위 밖 접근과 위험 작업은 화면 승인을 요구한다.

## 고려한 접근법

### 선택안. 외부 Codex CLI의 app-server 사용

Electron 메인 프로세스가 `codex app-server`를 자식 프로세스로 실행하고 표준 입출력 JSON-RPC로 통신한다. 공식 Device OAuth와 승인 프로토콜을 그대로 사용하며 Codex 업데이트도 기존 설치 경로를 따른다. Codex CLI가 없거나 지원 버전보다 낮으면 설정 화면에서 설치 또는 업데이트 안내를 표시한다.

### 제외안. Codex 바이너리 번들

별도 설치가 필요 없지만 운영체제와 아키텍처별 바이너리 패키징, 보안 업데이트, 앱 용량 증가를 Neru가 책임져야 하므로 현재 범위를 넘어선다.

### 제외안. OAuth 직접 구현

Neru가 Codex OAuth 클라이언트를 모방하고 토큰을 직접 보관해야 한다. 공개된 app-server 인증 경계를 우회하고 보안 책임을 불필요하게 키우므로 사용하지 않는다.

## 사용자 경험

### 제공자 설정

기존 LLM 제공자 설정 화면에 `로컬 프록시`와 `Codex (OAuth)`를 동등한 선택지로 표시한다. 어느 쪽도 기본 선택으로 표시하지 않는다.

- 새 설치는 LLM·STT·TTS의 active provider, active model, 자격 증명을 만들지 않는다.
- 기존 설치의 LLM·STT·TTS active 값과 자격 증명은 마이그레이션 과정에서 변경하지 않는다.
- 제공자 전환은 사용자가 설정 화면에서 저장한 경우에만 일어난다.
- 다른 제공자 실패 시 자동 폴백하지 않는다.

로컬 프록시는 기존 OpenAI 호환 설정 편집기와 검증기를 재사용한다. 기존 `localhost:3456` 값이 저장된 사용자는 그대로 볼 수 있지만 새 설치에는 자동 생성하지 않는다.

로컬 `neru-audio` STT와 TTS도 제공자 목록에는 표시하지만 `localhost:3457`, API 키, 모델, active 값을 자동 생성하지 않는다.

### Codex 연결

Codex 카드에는 CLI 설치 상태, 로그인 상태, 계정 플랜, 연결 상태를 표시한다.

1. 사용자가 `Codex로 로그인`을 누른다.
2. 메인 프로세스가 `account/login/start`에 `chatgptDeviceCode`를 보내고 검증 URL, 사용자 코드, login ID를 받는다.
3. 화면에 URL과 코드를 표시하고 브라우저 열기, 코드 복사, 취소를 제공한다.
4. `account/login/completed` 성공 알림 뒤에만 Codex를 active provider로 저장한다.
5. 모델은 Neru가 하드코딩하지 않고 Codex 사용자 설정과 app-server가 노출하는 모델을 따른다.

로그인 실패, 만료, 취소, 워크스페이스 정책 차단은 원문 원인을 사용자에게 보여주되 현재 active provider를 변경하지 않는다.

## 아키텍처

### Electron 메인 프로세스의 Codex 브리지

새 Codex 브리지는 다음 책임만 가진다.

- PATH에서 Codex 실행 파일과 지원 버전을 확인한다.
- 앱 수명주기에 맞춰 app-server 프로세스를 하나 실행하고 정상 종료한다.
- JSON-RPC 요청 ID, 응답, 알림, 서버 발 요청을 상관관계에 맞게 전달한다.
- 렌더러가 직접 프로세스나 인증 파일에 접근하지 않도록 Eventa IPC 계약을 제공한다.
- 비정상 종료 시 진행 중 요청을 실패 처리하고 재시작 가능한 상태로 되돌린다.

브리지는 Codex `auth.json`을 읽지 않는다. stdout의 JSON-RPC와 stderr의 진단 로그를 분리하고, 토큰이나 인증 응답 본문은 애플리케이션 로그에 기록하지 않는다.

### Codex LLM 어댑터

`codex-oauth` 제공자 어댑터는 기존 Neru 대화 런타임과 app-server 사이를 변환한다.

- Neru 대화 하나에 Codex thread 하나를 연결하고 thread ID를 대화 메타데이터에 보관한다.
- 새 thread에는 Neru 페르소나와 현재 기억 컨텍스트를 Codex developer instructions로 전달한다.
- 사용자 메시지는 `turn/start` 입력으로 보낸다.
- `item/agentMessage/delta`와 완료 이벤트를 기존 텍스트 스트림으로 변환해 자막과 TTS 경로를 그대로 사용한다.
- 앱 재시작 뒤 저장된 thread ID가 유효하면 `thread/resume`을 사용하고, 유효하지 않으면 명확한 새 대화로 시작한다.
- 중단 요청은 `turn/interrupt`로 전달한다.

Codex가 일반 OpenAI 채팅 API가 아니라 에이전트 런타임이라는 차이는 이 어댑터 내부에 가둔다. 로컬 프록시 경로와 Codex 경로가 서로의 인증, thread, 도구 실행 상태를 공유하지 않게 한다.

### 펑션 도구

app-server 초기화에서 실험 API 기능을 명시적으로 켜고, 기존 AIRI 도구 정의를 Codex `dynamicTools` 스키마로 변환한다.

- 도구 이름, 설명, JSON 입력 스키마를 thread 시작 시 등록한다.
- `item/tool/call` 요청을 받으면 기존 AIRI 도구 실행기를 호출한다.
- 성공 결과는 `inputText`, 필요 시 이미지 또는 오디오 콘텐츠 항목으로 반환한다.
- 실행 오류는 실패 결과로 반환하되 Codex 프로세스나 전체 대화를 종료하지 않는다.
- `remember`와 같은 로컬 상태 도구는 기존 실행 정책을 유지하며 별도 OS 권한 승인을 요구하지 않는다.

동적 도구 API는 실험 기능이므로 지원 Codex 최소 버전을 명시하고 시작 시 기능 가용성을 검사한다. 기능이 없으면 Codex 제공자를 활성화하지 않고 업데이트 안내를 표시한다.

### 파일과 명령 도구

Codex 기본 파일·명령 도구는 비활성화하지 않는다. thread의 작업 디렉터리는 Neru 저장소 루트이고 기본 권한 프로필은 workspace-write로 둔다.

- 저장소 내부 읽기와 샌드박스 내 안전한 변경·명령은 Codex 정책에 따라 실행한다.
- 샌드박스 밖 파일 접근, 추가 네트워크 권한, 위험 명령은 app-server 승인 요청을 렌더러로 전달한다.
- 승인 화면은 요청 이유, 명령, 작업 경로, 추가 권한 범위를 표시한다.
- 사용자는 이번만 허용, 세션 동안 허용, 거절을 선택할 수 있다.
- 승인 대기 중에는 해당 Codex turn만 멈추며 Neru의 화면과 음성 입력 상태는 유지한다.
- 앱 종료이나 대화 취소 시 남아 있는 승인 요청을 취소한다.

## 상태와 수명주기

- app-server는 Electron 메인 프로세스당 하나만 유지한다.
- 로그인 상태는 app-server의 `account/read`와 `account/updated`를 진실의 원천으로 사용한다.
- active provider는 기존 AIRI 설정 저장소에 보관한다.
- Codex thread ID는 해당 Neru 대화에만 연결한다.
- 로그아웃은 Codex 계정만 로그아웃하며 로컬 프록시 설정과 대화 데이터는 삭제하지 않는다.
- 제공자를 전환하면 진행 중인 응답을 먼저 중단하고 다음 사용자 메시지부터 새 제공자를 사용한다.

## 오류 처리

- **CLI 없음 또는 구버전.** Codex 카드를 비활성 상태로 표시하고 설치·업데이트 안내를 제공한다.
- **OAuth 취소·만료·정책 차단.** active provider를 바꾸지 않고 재시도 가능한 오류를 표시한다.
- **app-server 비정상 종료.** 진행 중 turn과 승인 요청을 실패 처리하고 사용자가 재연결할 수 있게 한다. 로컬 프록시로 자동 전환하지 않는다.
- **thread 재개 실패.** 기존 대화를 훼손하지 않고 새 Codex thread 시작 여부를 사용자에게 알린다.
- **동적 도구 미지원.** 대화 일부 기능을 조용히 제거하지 않고 Codex 업데이트가 필요하다고 표시한다.
- **도구 실행 실패.** 구조화된 실패 결과를 Codex에 돌려주고 turn을 계속할 수 있게 한다.
- **승인 시간 초과 또는 취소.** 요청을 거절로 종료하고 명령을 실행하지 않는다.

## 테스트 전략

### 단위 테스트

- LLM 프리시드가 새 설치에서 active LLM과 `localhost:3456` 자격 증명을 만들지 않는지 검증한다.
- 기존 active provider와 자격 증명을 보존하는지 검증한다.
- JSON-RPC 요청·응답·알림·서버 발 요청의 상관관계와 프로세스 종료 처리를 검증한다.
- Device OAuth 성공, 취소, 만료, 오류 상태 전이를 검증한다.
- Codex 이벤트가 기존 텍스트 스트림과 완료·중단 상태로 변환되는지 검증한다.
- AIRI 도구 스키마 변환과 `item/tool/call` 성공·실패 반환을 검증한다.
- 승인 결정이 app-server 응답으로 정확히 매핑되고 허용 범위를 넓히지 않는지 검증한다.

### 통합 테스트

- 가짜 app-server 프로세스로 초기화, account read, OAuth, thread 시작·재개, turn 스트리밍을 왕복 검증한다.
- `remember` 호출이 기존 메모리 저장 경로를 실행하고 결과를 Codex에 반환하는지 검증한다.
- 프로젝트 내부 명령과 범위 밖 접근 요청이 각각 자동 실행과 승인 흐름으로 나뉘는지 검증한다.
- 로컬 프록시와 Codex 사이를 전환해도 서로의 설정과 대화 상태가 섞이지 않는지 검증한다.

### 수동 검증

- 실제 최신 Codex CLI로 Device Login을 완료하고 계정·플랜 표시를 확인한다.
- Neru 대화, 스트리밍, 영어 TTS, 한국어 자막을 확인한다.
- 기억 펑션 호출과 저장을 확인한다.
- 저장소 내부 읽기·수정 명령과 범위 밖 접근 승인 창을 확인한다.
- 앱 재시작 뒤 로그인 상태와 대화 thread 재개를 확인한다.
- 마지막으로 관련 단위 테스트, 타입 검사, Electron 빌드를 실행한다.

## 완료 기준

- 새 설치에서 LLM이 자동 선택되지 않는다.
- 설정 화면에서 로컬 프록시와 Codex OAuth를 명시적으로 선택하고 전환할 수 있다.
- 기존 사용자 제공자 설정은 보존된다.
- Neru가 OAuth 토큰을 직접 취급하지 않고 공식 app-server Device Login을 완료한다.
- Codex 대화가 기존 출력 경로로 스트리밍된다.
- Neru 펑션 도구와 Codex 파일·명령 도구가 모두 작동한다.
- 저장소 밖 권한은 사용자 승인 없이 부여되지 않는다.
- 오류 시 다른 제공자로 몰래 전환하거나 설정을 잃지 않는다.

## 범위 밖

- Codex 바이너리 번들 및 자동 업데이트.
- OAuth 토큰 직접 읽기, 복사, 내보내기.
- 첫 실행 제공자 선택 화면.
- 로컬 프록시와 Codex 사이의 자동 폴백.
- STT·TTS 제공자 구조 변경.
- Codex 외 추가 LLM 제공자 설계.

## 공식 근거

- Codex app-server는 `account/login/start`의 `chatgptDeviceCode`, `account/login/completed`, `account/updated`를 제공한다.
- thread와 turn API는 대화 재개, 스트리밍 agent message, 중단을 제공한다.
- 실험 API를 켜면 `dynamicTools`와 `item/tool/call`을 통해 클라이언트 함수 도구를 연결할 수 있다.
- app-server 승인 프로토콜은 파일 변경, 명령 실행, 추가 권한 요청에 대한 사용자 결정을 지원한다.

참조: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
