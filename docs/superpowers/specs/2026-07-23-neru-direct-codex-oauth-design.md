# Neru 직접 Codex OAuth 설계

**상태.** 사용자 설계 승인 완료. 사양 문서 검토 대기.

## 목표

Neru의 `codex-oauth` 제공자는 Codex CLI와 `codex app-server`를 실행하거나 재사용하지 않는다. Electron main 프로세스가 ChatGPT 계정의 Device OAuth를 직접 시작하고, 암호화한 자격 증명으로 Codex 구독 전송 계약을 호출한다.

이 기능의 목적은 Codex CLI 설치 상태와 CLI의 토큰 저장소에 의존하지 않으면서도 Neru에서 Codex 구독 계정을 연결하는 것이다.

## 결정과 범위

- Device OAuth, 토큰 갱신, 로그아웃, 모델 조회, 스트리밍 대화, 함수 도구 왕복을 Neru가 직접 소유한다.
- `codex app-server` 자식 프로세스, CLI 버전 검사, JSON-RPC 계층은 Codex 제공자 경로에서 제거한다.
- 기존 `codex-oauth` 제공자 ID와 전용 설정 화면은 유지한다. 따라서 사용자가 다시 제공자를 선택하거나 기존 설정 URL을 바꿀 필요가 없다.
- 기존 Codex CLI 로그인은 읽거나 가져오지 않는다. 직접 전환 뒤에는 Neru 안에서 새로 로그인해야 한다.
- 로컬 프록시 제공자와 STT·TTS 제공자, 그리고 요청 범위 밖의 AIRI 업스트림 코드는 바꾸지 않는다.

## 대안 검토

1. **직접 Device OAuth와 직접 Codex 전송.** 채택한다. CLI 의존성을 없애고, 사용자 요청대로 Neru가 OAuth와 요청 수명을 소유한다.
2. **직접 OAuth 후 app-server 전송.** OAuth 저장소만 바뀌며 자식 프로세스 의존성이 남으므로 요구를 충족하지 못한다.
3. **OpenClaw 런타임 포함.** Electron 앱에 별도 에이전트 런타임과 저장소를 추가하므로 과도하다.

## 인증과 자격 증명 경계

1. renderer가 로그인을 요청하면 main 프로세스가 일회용 Device Code를 시작한다.
2. renderer에는 검증 URL, 사용 코드, 만료 시각, 취소 가능 여부만 전달한다. 액세스 토큰, 갱신 토큰, OAuth 응답 본문은 전달하지 않는다.
3. main 프로세스가 승인 완료를 대기하고, 토큰 교환·갱신·로그아웃을 직렬화한다.
4. 자격 증명은 Electron의 Windows 사용자 범위 암호화 저장소에만 보관한다. 평문 파일, Pinia 상태, Eventa IPC, 오류 메시지, 개발 로그에는 저장하거나 보내지 않는다.
5. 토큰 갱신 실패, 만료, 취소, 로그아웃은 현재 대화 제공자를 몰래 바꾸지 않는다. 연결 해제 상태와 재로그인 동작만 표시한다.

직접 OAuth는 OpenClaw과 Codex 오픈소스 구현에서 확인되는 호환 계약을 따른다. OpenAI가 외부 앱용으로 공개 문서화한 안정적 표면은 app-server이므로, 인증·전송 계약 변경은 사용자에게 재로그인을 요구하는 명시적 오류로 처리하고 임의의 API 키 또는 CLI 토큰으로 대체하지 않는다.

## 직접 Codex 전송

`codex-oauth` 전송기는 main 프로세스의 전용 서비스 하나로 분리한다.

- 인증된 모델 목록을 직접 조회해 설정 화면에 공급한다.
- 대화 요청은 Character 시스템 프롬프트를 포함하고, 응답은 기존 stage-ui 스트리밍 형식으로 변환한다.
- 함수 도구는 기존 AIRI 도구 정의를 JSON Schema로 직렬화해 요청에 포함한다. 도구 호출, 성공 결과, 실패 결과, 사용자 승인, 취소를 기존 도구 실행 경계와 연결한다.
- 중단 요청은 현재 직접 전송 하나만 취소한다. 중단은 사용자 오류로 보이지 않아야 한다.
- app-server에만 의미가 있던 작업 디렉터리, 샌드박스, Codex 파일·명령 권한 설정은 직접 전송 계약에서 지원되지 않으므로 UI와 요청에서 제거한다. Neru 자체 도구의 권한과 승인은 유지한다.

전송 계약의 URL, 헤더, 요청·SSE 이벤트 정규화는 한 모듈에 격리한다. 확인되지 않은 모델 ID, 헤더, 비공개 필드는 여러 화면이나 저장소에 복제하지 않는다.

## 상태와 사용자 경험

- 상태는 `disconnected`, `authorizing`, `connected`, `refreshing`, `reauthenticationRequired`, `error`로 표현한다.
- 동시에 둘 이상의 로그인, 갱신, 로그아웃이 일어나도 하나의 인증 작업만 진행한다.
- 로그인 성공 뒤에만 모델 목록을 갱신한다.
- 로그아웃은 암호화된 저장 항목을 삭제하고 진행 중인 직접 요청을 중단한다.
- 기존 CLI가 설치되지 않았거나 오래되었다는 메시지는 더 이상 표시하지 않는다.

## 검증 전략

### 단위 테스트

- Device OAuth의 성공, 취소, 만료, 중복 시작, 갱신 성공·실패, 로그아웃 경합을 검증한다.
- IPC 스냅샷과 오류가 토큰·인증 코드·콜백 URL의 민감한 쿼리를 포함하지 않는지 검증한다.
- 직접 SSE 이벤트가 기존 텍스트 스트림, 도구 호출, 도구 결과, 취소 형태로 변환되는지 검증한다.
- Character 프롬프트, 모델 선택, 기존 `remember` 도구가 요청에 유지되는지 검증한다.

### 통합 및 수동 검증

- 새 설치에서 Device OAuth 로그인, 앱 재시작 후 연결 복원, 모델 조회를 확인한다.
- 채팅 스트리밍, TTS 전달, 함수 도구 호출과 승인, 생성 중단, 로그아웃을 확인한다.
- 만료와 네트워크 오류를 모의해 재로그인 요구가 표시되고, 다른 제공자로 자동 전환하지 않는지 확인한다.
- main 프로세스 로그와 renderer DevTools에서 토큰이 노출되지 않는지 확인한다.

## 완료 기준

- Codex CLI가 설치되지 않은 Windows 환경에서도 Neru의 Device OAuth 로그인과 직접 대화가 동작한다.
- 토큰이 main 프로세스의 암호화 저장소 밖으로 나오지 않는다.
- 직접 Codex 응답에서 기존 Character 프롬프트, 스트리밍, 함수 도구, 사용자 승인, 취소가 보존된다.
- app-server와 CLI 검사·실행 코드가 Codex 제공자 실행 경로에 남지 않는다.

## 근거

- OpenClaw은 자체 PKCE OAuth, 별도 토큰 저장소, 갱신 수명을 설명한다. https://github.com/openclaw/openclaw/blob/main/docs/concepts/oauth.md
- OpenClaw은 Device Code 로그인과 직접 관리 자격 증명을 문서화한다. https://github.com/openclaw/openclaw/blob/main/docs/providers/openai.md
- Codex app-server의 공개 문서는 Device OAuth와 Codex가 관리하는 토큰 저장·갱신을 설명한다. https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
