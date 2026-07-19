# Neru Codex OAuth 실행 설정 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 데스크톱 Codex OAuth 제공자 카드에서 API 키 폼을 제거하고, 계정 로그인과 app-server 모델·실행 설정을 상속 또는 항목별 덮어쓰기할 수 있게 한다.

**Architecture:** 기존 Electron app-server 단일 프로세스와 Eventa 브리지를 유지한다. 모델 카탈로그는 `model/list`를 거쳐 렌더러 스토어에 전달하고, 로컬에 저장한 선택값 중 상속이 아닌 값만 `thread/start`·`thread/resume`·`turn/start`에 전달한다. 기존 설정 경로와 v2 경로는 같은 Vue 컴포넌트를 사용한다.

**Tech Stack:** TypeScript, Vue 3, Pinia, Electron, Eventa, Vitest, Codex app-server JSON-RPC v2.

## 전역 제약

- 모든 실행 설정의 기본값은 미설정이며 기존 Codex 설정을 상속한다.
- Neru는 `config.toml`과 `auth.json`을 읽거나 수정하지 않는다.
- 동적 펑션 도구는 실행 설정과 무관하게 항상 등록한다.
- 모델과 지원 추론 강도·서비스 등급은 `model/list` 응답에서만 얻는다.
- 기존 채팅 제공자 화면과 Codex 외 제공자의 동작은 변경하지 않는다.

---

### Task 1: 실제 데스크톱 경로에 Codex 전용 카드 연결

**Files:**
- Modify: `airi/packages/stage-pages/src/pages/settings/providers/chat/[providerId].vue`
- Modify: `airi/packages/stage-pages/src/components/settings/CodexOAuthProviderSettings.vue`
- Verify: `airi/packages/stage-pages/src/pages/v2/settings/providers/edit/[providerId]/index.vue`

**Interfaces:**
- Consumes: route의 `providerId`, 기존 `CodexOAuthProviderSettings`.
- Produces: `codex-oauth`에서만 전용 카드, 그 외 제공자에서는 기존 API 키 폼.

- [x] **Step 1: 기존 경로의 실패 동작을 확인**

Run: `cd airi && pnpm -F @proj-airi/stage-pages typecheck`

Expected: 타입 검사는 통과할 수 있지만 실제 Codex 경로에는 API 키 폼이 나타난다.

- [x] **Step 2: 최소 분기 구현**

```vue
<CodexOAuthProviderSettings v-if="providerId === 'codex-oauth'" />
<template v-else>
  <ProviderBasicSettings
    :title="t('settings.pages.providers.common.section.basic.title')"
    :description="t('settings.pages.providers.common.section.basic.description')"
    :on-reset="handleResetSettings"
  >
    <ProviderApiKeyInput v-model="apiKey" :provider-name="providerMetadata?.localizedName" :placeholder="apiKeyPlaceholder" />
  </ProviderBasicSettings>
  <ProviderAdvancedSettings :title="t('settings.pages.providers.common.section.advanced.title')">
    <ProviderBaseUrlInput v-model="baseUrl" :placeholder="providerMetadata?.defaultOptions?.().baseUrl as string || 'Base URL of your provider'" />
  </ProviderAdvancedSettings>
  <ProviderValidationAlerts
    :is-valid="isValid"
    :is-validating="isValidating"
    :validation-message="validationMessage"
    :has-manual-validators="hasManualValidators"
    :is-manual-testing="isManualTesting"
    :manual-test-passed="manualTestPassed"
    :manual-test-message="manualTestMessage"
    :on-run-test="runManualTest"
    :on-force-valid="forceValid"
    :on-go-to-model-selection="goToModelSelection"
  />
</template>
```

- [x] **Step 3: 타입 검사와 수동 화면 검증**

Run: `cd airi && pnpm -F @proj-airi/stage-pages typecheck`

Expected: PASS이며 기존 Codex 경로에 API 키·Base URL 입력이 보이지 않는다.

---

### Task 2: 모델 카탈로그와 실행 설정 저장

**Files:**
- Modify: `airi/apps/stage-tamagotchi/src/shared/eventa/codex.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/services/codex/service.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/services/codex/service.test.ts`
- Modify: `airi/apps/stage-tamagotchi/src/renderer/App.vue`
- Modify: `airi/packages/stage-ui/src/stores/codex-account.ts`
- Modify: `airi/packages/stage-ui/src/stores/codex-account.test.ts`

**Interfaces:**
- Produces: `codexListModels`, `CodexModel[]`, `CodexRuntimeOverrides`, `refreshModels()`, 영속 `overrides`.

- [x] **Step 1: 실패 테스트 작성**

```ts
it('preserves model and reasoning effort order from app-server', async () => {
  const models = await controller.listModels()
  expect(models[0].supportedReasoningEfforts.map(item => item.value)).toEqual(['low', 'medium', 'high'])
})

it('normalizes unsupported saved effort back to inherit', async () => {
  store.overrides.model = 'gpt-x'
  store.overrides.effort = 'ultra'
  store.applyModels([{ id: 'gpt-x', name: 'GPT X', supportedReasoningEfforts: [{ value: 'high', label: 'High' }], serviceTiers: [] }])
  expect(store.overrides.effort).toBeUndefined()
})
```

- [x] **Step 2: RED 확인**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/service.test.ts packages/stage-ui/src/stores/codex-account.test.ts`

Expected: 모델 목록 계약과 상태가 없어 FAIL한다.

- [x] **Step 3: 최소 구현**

`model/list`의 `data`만 JSON 안전 타입으로 정규화한다. 모델 ID·표시명·추론 강도 배열 순서·서비스 등급을 보존하고, 저장값이 현재 카탈로그에 없으면 해당 값만 `undefined`로 되돌린다.

- [x] **Step 4: GREEN 확인**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex/service.test.ts packages/stage-ui/src/stores/codex-account.test.ts`

Expected: PASS.

---

### Task 3: 명시한 덮어쓰기만 app-server에 전달

**Files:**
- Modify: `airi/apps/stage-tamagotchi/src/shared/eventa/codex.ts`
- Modify: `airi/apps/stage-tamagotchi/src/renderer/bridges/codex.ts`
- Modify: `airi/apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/services/codex/turn-runtime.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/services/codex/turn-runtime.test.ts`
- Modify: `airi/packages/stage-pages/src/components/settings/CodexOAuthProviderSettings.vue`

**Interfaces:**
- Consumes: `CodexRuntimeOverrides`.
- Produces: 상속 필드는 생략되고 명시한 모델·effort·serviceTier·cwd·sandbox·approvalPolicy·approvalsReviewer만 RPC에 포함되는 turn 요청.

- [x] **Step 1: 실패 테스트 작성**

```ts
it('omits inherited runtime settings', async () => {
  await runtime.startTurn(request({ overrides: {} }), sink)
  expect(threadStartParams).not.toHaveProperty('cwd')
  expect(threadStartParams).not.toHaveProperty('sandbox')
  expect(turnStartParams).not.toHaveProperty('model')
})

it('sends only explicit runtime overrides', async () => {
  await runtime.startTurn(request({ overrides: { model: 'gpt-x', effort: 'high', sandbox: 'readOnly', approvalsReviewer: 'auto_review' } }), sink)
  expect(turnStartParams).toMatchObject({ model: 'gpt-x', effort: 'high', approvalsReviewer: 'auto_review', sandboxPolicy: { type: 'readOnly' } })
})
```

- [x] **Step 2: RED 확인**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts apps/stage-tamagotchi/src/main/services/codex/turn-runtime.test.ts`

Expected: 현재 `workspaceWrite`·`unlessTrusted` 하드코딩 때문에 FAIL한다.

- [x] **Step 3: 최소 구현**

thread 요청에는 developer instructions와 dynamic tools를 항상 포함하고, 실행 설정은 정의된 값만 포함한다. turn 요청에는 모델·effort·serviceTier·cwd·approvalPolicy·approvalsReviewer와 `{ type: sandbox }` 형태의 `sandboxPolicy`를 선택적으로 추가한다.

- [x] **Step 4: 전체 검증과 커밋**

Run: `cd airi && pnpm exec vitest run apps/stage-tamagotchi/src/main/services/codex packages/stage-ui/src/stores/codex-account.test.ts apps/stage-tamagotchi/src/renderer/bridges/codex.test.ts && pnpm -F @proj-airi/stage-pages typecheck && pnpm -F @proj-airi/stage-tamagotchi typecheck`

Expected: 관련 테스트와 타입 검사가 PASS하고, 실제 Codex 카드에서 OAuth 로그인과 실행 설정이 보인다.

검증 결과: 관련 Vitest 36개와 stage-tamagotchi 타입 검사는 통과했다. stage-pages 단독 타입 검사는 기존 생성 모델 모듈 누락 5건 때문에 실패했으며 이번 변경 파일의 신규 오류는 보고되지 않았다. 개발 앱은 깨끗하게 재시작해 `RUNNING`과 렌더러 WebSocket 연결을 확인했다.
