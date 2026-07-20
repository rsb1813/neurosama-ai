# Codex 캐릭터 프롬프트 연속성 설계

## 목표

Codex OAuth 전송기가 AIRI의 현재 캐릭터 시스템 메시지를 그대로 사용하고, 캐릭터 프롬프트나 실제 Codex 모델이 바뀐 경우에만 기존 Codex thread를 새로 시작한다.

## 현재 문제

- AIRI 채팅 런타임은 캐릭터 카드, 공통 형식 지침, 활성 도구 지침을 합쳐 최종 시스템 메시지를 만든다.
- Codex 브리지는 전체 메시지 배열에서 마지막 사용자 발화만 추출하고, 고정된 `NERU_SYSTEM_PROMPT`만 `developerInstructions`로 보낸다.
- 세션별 Codex thread 저장값에는 어떤 프롬프트와 모델로 만든 thread인지 기록되지 않는다.
- 따라서 캐릭터 카드의 현재 지침이 누락되고, 모델이나 페르소나를 바꿔도 이전 thread의 응답 스타일이 남을 수 있다.

## 설계

### 지침 선택

Codex 브리지는 요청의 첫 번째 `system` 메시지 내용을 `developerInstructions`로 사용한다. 시스템 메시지가 없거나 텍스트로 변환할 수 없으면 기존 `NERU_SYSTEM_PROMPT`를 폴백으로 사용한다.

### thread 서명

세션별 저장값을 `{ threadId, signature }` 형태로 확장한다. `signature`는 최종 `developerInstructions`와 실제 Codex 모델 override를 입력으로 만든 결정적이고 짧은 문자열이다.

- 저장된 서명과 현재 서명이 같으면 기존 thread를 resume한다.
- 서명이 다르면 `threadId`를 전달하지 않아 새 thread를 시작하고, 성공한 새 thread와 서명을 덮어쓴다.
- 기존 문자열 저장 형식은 서명이 없는 값으로 취급해 최초 요청에서 새 형식으로 안전하게 전환한다.
- 도구 목록과 일반 사용자 발화는 서명에 포함하지 않는다. 도구는 매 resume에 다시 전달되고, 발화는 동일한 대화 thread의 내용이기 때문이다.

### 범위

- 기존 Codex tool 실행, 승인, 스트리밍, thread resume 실패 처리는 변경하지 않는다.
- AIRI 전체 과거 대화 기록을 새 Codex thread에 이식하지 않는다. 이번 수정은 시스템 프롬프트 정확성과 모델·페르소나 변경 시 격리에 한정한다.
- 코드 기본 모델이나 서비스 티어는 강제하지 않는다.

## 검증

- 조립된 시스템 메시지가 `developerInstructions`로 전달되는 테스트.
- 동일한 세션·프롬프트·모델에서 저장된 thread를 재사용하는 테스트.
- 프롬프트 변경 시 새 thread를 시작하는 테스트.
- 실제 모델 override 변경 시 새 thread를 시작하는 테스트.
- 기존 문자열 저장 형식이 새 thread로 마이그레이션되는 테스트.
- Codex 브리지 집중 테스트, LLM 전송기 회귀 테스트, ESLint와 `git diff --check`를 실행한다.

