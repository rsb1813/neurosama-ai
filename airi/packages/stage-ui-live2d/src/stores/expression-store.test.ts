// @vitest-environment jsdom
import type { ExpressionEntry, ExpressionGroupDefinition } from './expression-store'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useExpressionStore } from './expression-store'

// 두 감정 표정 그룹(angry=Param67, sad=Param68)을 modelDefault 0으로 시드한다.
function seed() {
  const groups: ExpressionGroupDefinition[] = [
    { name: 'angry', parameters: [{ parameterId: 'Param67', blend: 'Add', value: 30 }] },
    { name: 'sad', parameters: [{ parameterId: 'Param68', blend: 'Add', value: 30 }] },
  ]
  const entries: ExpressionEntry[] = [
    { name: 'Param67', parameterId: 'Param67', blend: 'Add', currentValue: 0, defaultValue: 0, modelDefault: 0, targetValue: 30 },
    { name: 'Param68', parameterId: 'Param68', blend: 'Add', currentValue: 0, defaultValue: 0, modelDefault: 0, targetValue: 30 },
  ]
  return { groups, entries }
}

describe('useExpressionStore.applyEmotion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('activates the mapped group params to their exp3 target values', () => {
    const store = useExpressionStore()
    const { groups, entries } = seed()
    store.registerExpressions('test', groups, entries)
    store.applyEmotion('angry')
    expect(store.expressions.get('Param67')!.currentValue).toBe(30)
  })

  it('resets the previous group when a new emotion arrives (one at a time)', () => {
    const store = useExpressionStore()
    const { groups, entries } = seed()
    store.registerExpressions('test', groups, entries)
    store.applyEmotion('angry')
    store.applyEmotion('sad')
    expect(store.expressions.get('Param67')!.currentValue).toBe(0)
    expect(store.expressions.get('Param68')!.currentValue).toBe(30)
  })

  it('undefined name resets the previous group and activates nothing', () => {
    const store = useExpressionStore()
    const { groups, entries } = seed()
    store.registerExpressions('test', groups, entries)
    store.applyEmotion('angry')
    store.applyEmotion(undefined)
    expect(store.expressions.get('Param67')!.currentValue).toBe(0)
  })

  it('unregistered expression name does not throw and activates nothing', () => {
    const store = useExpressionStore()
    const { groups, entries } = seed()
    store.registerExpressions('test', groups, entries)
    expect(() => store.applyEmotion('nonexistent')).not.toThrow()
    expect(store.expressions.get('Param67')!.currentValue).toBe(0)
  })

  it('auto-resets to neutral after holdSeconds', () => {
    vi.useFakeTimers()
    const store = useExpressionStore()
    const { groups, entries } = seed()
    store.registerExpressions('test', groups, entries)
    store.applyEmotion('angry', 4)
    expect(store.expressions.get('Param67')!.currentValue).toBe(30)
    vi.advanceTimersByTime(4000)
    expect(store.expressions.get('Param67')!.currentValue).toBe(0)
    vi.useRealTimers()
  })

  // ROOT CAUSE:
  // applyEmotion의 즉시-리셋은 modelDefault로 가는데, 타이머 자동-리셋은 applyValue 기본값인
  // defaultValue로 갔다. saveDefaults()가 감정 표정 활성 중 호출되면 defaultValue가 비중립으로
  // 저장돼 두 경로가 어긋난다. applyEmotion이 resetTo=modelDefault를 넘겨 항상 진짜 중립으로
  // 복귀하도록 고쳤다. 이 테스트는 defaultValue(15)≠modelDefault(0)에서 복귀가 0인지 고정한다.
  it('auto-resets emotion expressions to modelDefault even when defaultValue diverges', () => {
    vi.useFakeTimers()
    const store = useExpressionStore()
    const groups: ExpressionGroupDefinition[] = [
      { name: 'angry', parameters: [{ parameterId: 'Param67', blend: 'Add', value: 30 }] },
    ]
    // defaultValue를 modelDefault와 다르게(15) 시드 — saveDefaults로 비중립 기본값이 저장된 상황을 모사.
    const entries: ExpressionEntry[] = [
      { name: 'Param67', parameterId: 'Param67', blend: 'Add', currentValue: 15, defaultValue: 15, modelDefault: 0, targetValue: 30 },
    ]
    store.registerExpressions('test', groups, entries)
    store.applyEmotion('angry', 4)
    expect(store.expressions.get('Param67')!.currentValue).toBe(30)
    vi.advanceTimersByTime(4000)
    // defaultValue(15)가 아니라 modelDefault(0)로 복귀해야 한다.
    expect(store.expressions.get('Param67')!.currentValue).toBe(0)
    vi.useRealTimers()
  })
})
