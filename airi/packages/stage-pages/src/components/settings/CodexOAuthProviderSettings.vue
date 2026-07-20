<!-- Codex Device OAuth 계정과 실행별 런타임 설정을 관리한다. -->
<script setup lang="ts">
import {
  ProviderAdvancedSettings,
  ProviderBasicSettings,
} from '@proj-airi/stage-ui/components'
import { useCodexAccountStore } from '@proj-airi/stage-ui/stores/codex-account'
import { Button, FieldCombobox, FieldInput } from '@proj-airi/ui'
import { computed, onMounted } from 'vue'

const inheritValue = '__codex_inherit__'
const account = useCodexAccountStore()
const canUseCodex = computed(() => account.status.authMode === 'chatgpt')
const selectedModel = computed(() => account.models.find(model => model.id === account.overrides.model))

const model = computed({
  get: () => account.overrides.model ?? inheritValue,
  set: (value: string) => {
    account.overrides.model = inherited(value)
    account.overrides.effort = undefined
    account.overrides.serviceTier = undefined
  },
})
const effort = optionalOverride('effort')
const serviceTier = optionalOverride('serviceTier')
const cwd = computed({
  get: () => account.overrides.cwd ?? '',
  set: (value: string) => account.overrides.cwd = value.trim().length === 0 ? undefined : value,
})
const sandbox = optionalOverride('sandbox')
const approvalPolicy = optionalOverride('approvalPolicy')
const approvalsReviewer = optionalOverride('approvalsReviewer')

const modelOptions = computed(() => [
  { label: 'Codex 설정 상속', value: inheritValue },
  ...account.models.map(item => ({ label: item.name, value: item.id })),
])
const effortOptions = computed(() => [
  { label: 'Codex 설정 상속', value: inheritValue },
  ...(selectedModel.value?.supportedReasoningEfforts ?? []).map(item => ({ label: item.label, value: item.value })),
])
const serviceTierOptions = computed(() => [
  { label: 'Codex 설정 상속', value: inheritValue },
  ...(selectedModel.value?.serviceTiers ?? []).map(value => ({ label: value, value })),
])

onMounted(() => void account.refreshModels())

function inherited(value: string) {
  return value === inheritValue ? undefined : value
}

function optionalOverride(key: 'effort' | 'serviceTier' | 'sandbox' | 'approvalPolicy' | 'approvalsReviewer') {
  return computed({
    get: () => account.overrides[key] ?? inheritValue,
    set: (value: string) => account.overrides[key] = inherited(value) as never,
  })
}

function resetSettings() {
  for (const key of Object.keys(account.overrides))
    delete account.overrides[key as keyof typeof account.overrides]
}
</script>

<template>
  <ProviderBasicSettings
    title="기본"
    description="ChatGPT 계정으로 로그인하고, 이 제공자에서 사용할 모델을 선택합니다."
    :on-reset="resetSettings"
  >
    <div class="flex flex-col gap-3 rounded-lg bg-neutral-50 p-4 dark:bg-neutral-800">
      <div>
        <div class="text-sm font-medium">
          Codex 계정
        </div>
        <p class="text-xs text-neutral-500 dark:text-neutral-400">
          Codex CLI의 Device OAuth로 연결합니다. OAuth 토큰은 Neru 설정에 복사하지 않습니다.
        </p>
      </div>

      <p v-if="account.status.error" class="text-sm text-red-600 dark:text-red-400">
        {{ account.status.error }}
      </p>

      <template v-if="account.login">
        <p class="text-sm">
          브라우저에서 아래 코드를 입력해 주세요.
        </p>
        <code class="w-fit rounded bg-neutral-100 px-2 py-1 font-mono dark:bg-neutral-900">{{ account.login.userCode }}</code>
        <a :href="account.login.verificationUrl" target="_blank" rel="noreferrer" class="w-fit text-sm text-primary-600 underline">
          로그인 페이지 열기
        </a>
        <Button class="w-fit" size="sm" variant="secondary" @click="account.cancelLogin">
          취소
        </Button>
      </template>

      <template v-else-if="canUseCodex">
        <p class="text-sm text-emerald-700 dark:text-emerald-400">
          로그인됨. {{ account.status.planType || 'ChatGPT' }} 플랜.
        </p>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" @click="account.selectCodex">
            Codex 사용
          </Button>
          <Button size="sm" variant="secondary" @click="account.logout">
            로그아웃
          </Button>
        </div>
      </template>

      <template v-else>
        <p class="text-sm text-neutral-500">
          CLI 상태. {{ account.status.cli }}.
        </p>
        <Button class="w-fit" size="sm" :disabled="account.status.cli === 'unsupported'" @click="account.startLogin">
          Device OAuth 로그인
        </Button>
      </template>
    </div>

    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-3">
        <p v-if="account.modelsLoading" class="text-sm text-neutral-500">
          Codex 모델을 불러오는 중입니다.
        </p>
        <p v-else-if="account.modelsError" class="text-sm text-red-600 dark:text-red-400">
          {{ account.modelsError }}
        </p>
        <span v-else />
        <Button size="sm" variant="secondary" :disabled="account.modelsLoading" @click="account.refreshModels">
          모델 새로고침
        </Button>
      </div>

      <FieldCombobox
        v-model="model"
        label="모델"
        description="미설정 시 Codex의 현재 기본 모델을 사용합니다."
        :options="modelOptions"
      />
      <FieldCombobox
        v-model="effort"
        label="추론 강도"
        description="선택한 모델이 지원하는 값만 표시합니다."
        :options="effortOptions"
        :disabled="!selectedModel"
      />
      <FieldCombobox
        v-if="serviceTierOptions.length > 1"
        v-model="serviceTier"
        label="서비스 티어"
        description="미설정 시 Codex의 현재 서비스 티어를 사용합니다."
        :options="serviceTierOptions"
      />
    </div>
  </ProviderBasicSettings>

  <ProviderAdvancedSettings title="고급">
    <div class="flex flex-col gap-4">
      <FieldInput
        v-model="cwd"
        label="작업 디렉터리"
        description="비워 두면 Codex 설정 또는 앱이 전달한 기본 작업 디렉터리를 사용합니다."
        placeholder="Codex 설정 상속"
      />
      <FieldCombobox
        v-model="sandbox"
        label="샌드박스"
        description="파일 시스템 접근 범위를 실행별로 덮어씁니다."
        :options="[
          { label: 'Codex 설정 상속', value: inheritValue },
          { label: '읽기 전용', value: 'readOnly' },
          { label: '워크스페이스 쓰기', value: 'workspaceWrite' },
          { label: '전체 접근', value: 'dangerFullAccess' },
        ]"
      />
      <FieldCombobox
        v-model="approvalPolicy"
        label="승인 정책"
        description="명령 실행 전에 사용자 승인이 필요한 조건을 정합니다."
        :options="[
          { label: 'Codex 설정 상속', value: inheritValue },
          { label: '신뢰되지 않은 명령만', value: 'unlessTrusted' },
          { label: '요청 시', value: 'onRequest' },
          { label: '승인 안 함', value: 'never' },
        ]"
      />
      <FieldCombobox
        v-model="approvalsReviewer"
        label="승인 검토자"
        description="사용자가 직접 검토할지 Codex 자동 검토를 사용할지 정합니다."
        :options="[
          { label: 'Codex 설정 상속', value: inheritValue },
          { label: '사용자', value: 'user' },
          { label: '자동 검토', value: 'auto_review' },
        ]"
      />
    </div>
  </ProviderAdvancedSettings>
</template>
