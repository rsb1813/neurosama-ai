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
  return { t, trigger, opts: { idleDelayMs: 1000, maxConsecutive: 2, enabled: true, isBusy: () => false, trigger, setTimer: t.setTimer, clearTimer: t.clearTimer, ...over } }
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
    await Promise.resolve() // 1
    t.fireLatest()
    await Promise.resolve() // 2
    t.fireLatest()
    await Promise.resolve() // capped — no 3rd
    expect(trigger).toHaveBeenCalledTimes(2)
  })

  it('recordUserActivity resets the counter and re-enables firing', async () => {
    const { t, trigger, opts } = makeOpts({ maxConsecutive: 1 })
    const c = createProactiveScheduler(opts)
    t.fireLatest()
    await Promise.resolve() // 1 (now capped)
    t.fireLatest()
    await Promise.resolve() // capped
    expect(trigger).toHaveBeenCalledTimes(1)
    c.recordUserActivity() // user spoke → reset
    t.fireLatest()
    await Promise.resolve()
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
