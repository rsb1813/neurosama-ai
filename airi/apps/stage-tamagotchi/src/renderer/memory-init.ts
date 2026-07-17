// 앱 시작 시 MEMORY.md를 읽어 useMemoryStore에 채운다 — 회상 provider(동기)가 즉시 읽을 수 있도록.
import { useMemoryStore } from '@proj-airi/stage-ui/stores/modules/memory'

import { readMemoryText } from './memory-io'

export async function initMemory(): Promise<void> {
  try {
    const text = await readMemoryText()
    useMemoryStore().setMemoryText(text)
  }
  catch {
    // 파일이 없거나 IPC 실패 시 빈 상태 유지 — 회상은 no-op, 첫 remember가 파일을 만든다.
  }
}
