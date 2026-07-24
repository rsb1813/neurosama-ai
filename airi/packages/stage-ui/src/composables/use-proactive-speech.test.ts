import { describe, expect, it, vi } from 'vitest'

import { createProactiveScheduler, PROACTIVE_NUDGE } from './use-proactive-speech'

// 주입식 가짜 타이머: setTimer가 준 콜백을 수동으로 실행해 시간 경과를 흉내낸다.
function fakeTimers() {
  const cbs = new Map<number, () => void>()
  let id = 0
  return {
    setTimer: (cb: () => void, _ms: number) => {
      const h = ++id
      cbs.set(h, cb)
      return h
    },
    clearTimer: (h: unknown) => { cbs.delete(h as number) },
    fireLatest: () => {
      const last = [...cbs.keys()].at(-1)
      if (last != null) {
        const cb = cbs.get(last)!
        cbs.delete(last)
        cb()
      }
    },
    pending: () => cbs.size,
  }
}

function makeOpts(over: Partial<Parameters<typeof createProactiveScheduler>[0]> = {}) {
  const t = fakeTimers()
  const trigger = vi.fn(async () => {})
  return { t, trigger, opts: { idleDelayMs: 1000, enabled: true, isBusy: () => false, trigger, setTimer: t.setTimer, clearTimer: t.clearTimer, ...over } }
}

// trigger()의 프로미스 체인(.catch().finally())이 settle되고 스케줄러가 arm()으로
// 타이머를 재무장할 때까지 마이크로태스크를 비운다. 단일 await로는 부족하다(§리뷰 finding 참고).
async function settle() {
  for (let i = 0; i < 5; i++)
    await Promise.resolve()
}

describe('createProactiveScheduler', () => {
  it('fires the trigger after the idle delay', async () => {
    const { t, trigger, opts } = makeOpts()
    createProactiveScheduler(opts)
    t.fireLatest() // idle window elapses
    await Promise.resolve()
    expect(trigger).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire while neru is busy (sending/speaking)', async () => {
    const { t, trigger, opts } = makeOpts({ isBusy: () => true })
    createProactiveScheduler(opts)
    t.fireLatest()
    await Promise.resolve()
    expect(trigger).not.toHaveBeenCalled()
  })

  it('stops after maxConsecutive un-answered fires', async () => {
    const { t, trigger, opts } = makeOpts({ maxConsecutive: 2 })
    createProactiveScheduler(opts)
    t.fireLatest()
    await settle() // fire 1
    expect(trigger).toHaveBeenCalledTimes(1)
    expect(t.pending()).toBe(1) // 아직 상한 미도달 — 재무장됨

    t.fireLatest()
    await settle() // fire 2 → 상한 도달
    expect(trigger).toHaveBeenCalledTimes(2)
    expect(t.pending()).toBe(0) // arm()이 상한 도달로 재무장을 거부함 — 진짜 상한 보증

    // 이후 시간이 더 지나도(타이머가 없으므로) 절대 발동하지 않는다.
    t.fireLatest()
    await settle()
    expect(trigger).toHaveBeenCalledTimes(2)
  })

  it('defaults to one un-answered fire and resets after user activity', async () => {
    const { t, trigger, opts } = makeOpts()
    const c = createProactiveScheduler(opts)

    t.fireLatest()
    await settle()
    expect(trigger).toHaveBeenCalledTimes(1)
    expect(t.pending()).toBe(0)

    c.recordUserActivity()
    expect(t.pending()).toBe(1)

    t.fireLatest()
    await settle()
    expect(trigger).toHaveBeenCalledTimes(2)
    expect(t.pending()).toBe(0)
  })

  it('recordUserActivity resets the counter and re-enables firing', async () => {
    const { t, trigger, opts } = makeOpts({ maxConsecutive: 1 })
    const c = createProactiveScheduler(opts)
    t.fireLatest()
    await settle() // fire 1 → 상한(1) 도달
    expect(trigger).toHaveBeenCalledTimes(1)
    expect(t.pending()).toBe(0) // 상한 도달로 타이머 없음

    c.recordUserActivity() // 사용자 발화 → 리셋 + 재무장
    expect(t.pending()).toBe(1)

    t.fireLatest()
    await settle() // 리셋 후 다시 발동
    expect(trigger).toHaveBeenCalledTimes(2)
  })

  it('does nothing when disabled', async () => {
    const { t, trigger, opts } = makeOpts({ enabled: false })
    createProactiveScheduler(opts)
    expect(t.pending()).toBe(0)
    t.fireLatest()
    await Promise.resolve()
    expect(trigger).not.toHaveBeenCalled()
  })

  it('dispose clears pending timers', () => {
    const { t, opts } = makeOpts()
    const c = createProactiveScheduler(opts)
    expect(t.pending()).toBe(1)
    c.dispose()
    expect(t.pending()).toBe(0)
  })
})

describe('proactiveNudge', () => {
  it('instructs unprompted, brief, in-character speech and no searching', () => {
    expect(PROACTIVE_NUDGE).toMatch(/on your own|unprompted/i)
    expect(PROACTIVE_NUDGE).toMatch(/short|brief/i)
    expect(PROACTIVE_NUDGE).toMatch(/do not search|don't search/i)
  })
})
