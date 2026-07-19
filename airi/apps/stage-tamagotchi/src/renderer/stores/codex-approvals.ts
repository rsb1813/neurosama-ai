// Codex 위험 작업 승인 요청을 순서대로 보관하고 명시적 결정으로 해소한다.
import type { CodexApprovalDecision, CodexApprovalResolution, CodexJsonValue } from '../../shared/eventa/codex'

import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

export interface ApprovalRequest {
  type: 'approval-request'
  streamId: string
  threadId: string
  turnId: string
  requestId: string
  approvalType: 'command' | 'file' | 'permissions'
  request: CodexJsonValue
}

export const useCodexApprovalsStore = defineStore('codex-approvals', () => {
  const queue: ApprovalRequest[] = []
  let resolveApproval: ((payload: CodexApprovalResolution) => Promise<void>) | undefined
  const current = shallowRef<ApprovalRequest | null>(null)

  function setBridge(next: ((payload: CodexApprovalResolution) => Promise<void>) | undefined) {
    resolveApproval = next
  }

  function enqueue(request: ApprovalRequest) {
    if (!queue.some(entry => entry.requestId === request.requestId)) {
      queue.push(request)
      current.value ??= request
    }
  }

  async function resolveCurrent(type: CodexApprovalDecision['type']) {
    const request = current.value
    if (!request || !resolveApproval)
      return

    await resolveApproval({ requestId: request.requestId, decision: { type } })
    queue.shift()
    current.value = queue[0] ?? null
  }

  return { current, setBridge, enqueue, resolveCurrent }
})
