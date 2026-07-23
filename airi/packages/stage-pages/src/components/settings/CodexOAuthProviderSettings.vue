<!-- Codex Device OAuth 계정과 직접 전송 설정을 관리합니다. -->
<script setup lang="ts">
import { ProviderBasicSettings } from '@proj-airi/stage-ui/components'
import { useCodexAccountStore } from '@proj-airi/stage-ui/stores/codex-account'
import { Button, FieldCombobox } from '@proj-airi/ui'
import { computed, onMounted } from 'vue'

const inheritValue = '__codex_inherit__'
const account = useCodexAccountStore()
const canUseCodex = computed(() => account.status.connection === 'connected' && account.status.authMode === 'chatgpt')
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

const modelOptions = computed(() => [
  { label: 'Codex 기본값 사용', value: inheritValue },
  ...account.models.map(item => ({ label: item.name, value: item.id })),
])
const effortOptions = computed(() => [
  { label: 'Codex 기본값 사용', value: inheritValue },
  ...(selectedModel.value?.supportedReasoningEfforts ?? []).map(item => ({ label: item.label, value: item.value })),
])
const serviceTierOptions = computed(() => [
  { label: 'Codex 기본값 사용', value: inheritValue },
  ...(selectedModel.value?.serviceTiers ?? []).map(value => ({ label: value, value })),
])

onMounted(() => void account.refreshModels())

function inherited(value: string) {
  return value === inheritValue ? undefined : value
}

function optionalOverride(key: 'effort' | 'serviceTier') {
  return computed({
    get: () => account.overrides[key] ?? inheritValue,
    set: (value: string) => account.overrides[key] = inherited(value),
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
    description="ChatGPT 계정으로 로그인하고 Codex 응답에 사용할 모델을 선택합니다."
    :on-reset="resetSettings"
  >
    <div class="flex flex-col gap-3 rounded-lg bg-neutral-50 p-4 dark:bg-neutral-800">
      <div>
        <div class="text-sm font-medium">
          Codex 계정
        </div>
        <p class="text-xs text-neutral-500 dark:text-neutral-400">
          Neru가 Device OAuth로 직접 연결합니다. OAuth 토큰은 Windows 사용자 범위로 암호화됩니다.
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
          연결 상태. {{ account.status.connection }}.
        </p>
        <Button class="w-fit" size="sm" @click="account.startLogin">
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
        description="설정하지 않으면 Codex 기본 모델을 사용합니다."
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
        description="설정하지 않으면 Codex 기본 서비스 티어를 사용합니다."
        :options="serviceTierOptions"
      />
    </div>
  </ProviderBasicSettings>
</template>
