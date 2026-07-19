<!-- Codex가 요청한 명령·파일·권한 작업을 사용자가 명시적으로 승인한다. -->
<script setup lang="ts">
import { useCodexApprovalsStore } from '../stores/codex-approvals'

const approvals = useCodexApprovalsStore()
</script>

<template>
  <div v-if="approvals.current" class="fixed inset-0 z-9999 flex items-center justify-center bg-black/50 p-4">
    <section class="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl dark:bg-neutral-900">
      <h2 class="text-lg font-semibold">Codex 작업 승인</h2>
      <p class="mt-2 text-sm text-neutral-500">{{ approvals.current.approvalType }} 작업을 요청했습니다.</p>
      <pre class="mt-3 max-h-56 overflow-auto rounded bg-neutral-100 p-3 text-xs dark:bg-neutral-800">{{ JSON.stringify(approvals.current.request, null, 2) }}</pre>
      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <button class="rounded bg-neutral-200 px-3 py-2 text-sm dark:bg-neutral-700" @click="approvals.resolveCurrent('decline')">거절</button>
        <button class="rounded bg-amber-600 px-3 py-2 text-sm text-white" @click="approvals.resolveCurrent('accept')">이번만 허용</button>
        <button class="rounded bg-primary-600 px-3 py-2 text-sm text-white" @click="approvals.resolveCurrent('acceptForSession')">세션 동안 허용</button>
      </div>
    </section>
  </div>
</template>
