// 메인 창 DevTools가 명시적 디버그 요청에서만 열리는지 검증한다.
import { describe, expect, it } from 'vitest'

import { shouldOpenMainDevtools } from './devtools-policy'

describe('main window DevTools policy', () => {
  it('keeps DevTools closed without an explicit debug flag', () => {
    expect(shouldOpenMainDevtools({})).toBe(false)
  })

  it('opens DevTools for either explicit debug flag', () => {
    expect(shouldOpenMainDevtools({ MAIN_APP_DEBUG: '1' })).toBe(true)
    expect(shouldOpenMainDevtools({ APP_DEBUG: '1' })).toBe(true)
  })
})
