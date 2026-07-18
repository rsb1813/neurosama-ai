// neru 웹 검색을 렌더러에서 IPC로 감싼 얇은 래퍼 (도구가 사용, 테스트에서 모킹).
import type { ElectronWebSearchResult } from '../shared/eventa'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'

import { electronWebSearch } from '../shared/eventa'

export async function searchWeb(query: string): Promise<ElectronWebSearchResult> {
  const invoke = useElectronEventaInvoke(electronWebSearch)
  return invoke({ query })
}
