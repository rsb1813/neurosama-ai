// neru MEMORY.md 파일 IO를 렌더러에서 IPC로 감싼 얇은 래퍼 (도구·startup가 공유, 테스트에서 모킹).
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'

import { electronMemoryReadText, electronMemoryWriteText } from '../shared/eventa'

export async function readMemoryText(): Promise<string> {
  const invoke = useElectronEventaInvoke(electronMemoryReadText)
  const res = await invoke()
  return res.text
}

export async function writeMemoryText(text: string): Promise<void> {
  const invoke = useElectronEventaInvoke(electronMemoryWriteText)
  await invoke({ text })
}
