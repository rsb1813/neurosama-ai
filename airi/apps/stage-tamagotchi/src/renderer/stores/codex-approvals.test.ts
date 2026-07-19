// Codex 승인 큐가 Eventa 계약의 제한된 결정값을 전달하는지 검증한다.
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCodexApprovalsStore } from './codex-approvals'

describe('Codex approvals store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('resolves the current request with an explicit bounded decision', async () => {
    const resolveApproval = vi.fn(async () => {})
    const store = useCodexApprovalsStore()
    store.setBridge(resolveApproval)
    store.enqueue({ type: 'approval-request', streamId: 'stream-1', threadId: 'thread-1', turnId: 'turn-1', requestId: '61', approvalType: 'command', request: { command: 'git status' } })

    await store.resolveCurrent('acceptForSession')

    expect(resolveApproval).toHaveBeenCalledWith({ requestId: '61', decision: { type: 'acceptForSession' } })
    expect(store.current).toBeNull()
  })
})
