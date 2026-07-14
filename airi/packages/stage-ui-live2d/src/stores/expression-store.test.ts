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
})
