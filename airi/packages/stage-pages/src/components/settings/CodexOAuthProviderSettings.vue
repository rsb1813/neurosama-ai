<!-- Codex Device OAuth 로그인과 제공자 선택 상태를 표시한다. -->
<script setup lang="ts">
import { useCodexAccountStore } from '@proj-airi/stage-ui/stores/codex-account'
import { Button } from '@proj-airi/ui'
import { computed } from 'vue'

const account = useCodexAccountStore()
const canUseCodex = computed(() => account.status.authMode === 'chatgpt')
</script>

<template>
  <section class="flex flex-col gap-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
    <div class="flex flex-col gap-1">
      <h3 class="text-base font-semibold">Codex 계정</h3>
      <p class="text-sm text-neutral-500">
        Codex CLI의 Device OAuth 로그인으로 연결합니다. 토큰은 Neru가 읽거나 저장하지 않습니다.
      </p>
    </div>
    <p v-if="account.status.error" class="text-sm text-red-600 dark:text-red-400">
      {{ account.status.error }}
    </p>
    <template v-if="account.login">
      <p class="text-sm">브라우저에서 아래 코드를 입력하세요.</p>
      <code class="rounded bg-neutral-100 px-2 py-1 font-mono dark:bg-neutral-800">{{ account.login.userCode }}</code>
      <a :href="account.login.verificationUrl" target="_blank" rel="noreferrer" class="text-sm text-primary-600 underline">로그인 페이지 열기</a>
      <Button size="sm" variant="secondary" @click="account.cancelLogin">취소</Button>
    </template>
    <template v-else-if="canUseCodex">
      <p class="text-sm text-emerald-700 dark:text-emerald-400">로그인됨. {{ account.status.planType || 'ChatGPT' }} 플랜.</p>
      <div class="flex gap-2">
        <Button size="sm" @click="account.selectCodex">Codex 사용</Button>
        <Button size="sm" variant="secondary" @click="account.logout">로그아웃</Button>
      </div>
    </template>
    <template v-else>
      <p class="text-sm text-neutral-500">CLI 상태. {{ account.status.cli }}</p>
      <Button size="sm" :disabled="account.status.cli === 'unsupported'" @click="account.startLogin">Device OAuth 로그인</Button>
    </template>
  </section>
</template>
