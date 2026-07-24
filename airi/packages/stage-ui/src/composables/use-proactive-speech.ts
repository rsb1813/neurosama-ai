// neru가 유휴 시 스스로 말을 걸게 하는 능동 발화 스케줄러 + 컴포저블.
import { onScopeDispose } from 'vue'

// 능동 발화의 "내용 정책"(교체 가능한 넛지). 트리거는 content-agnostic이라, 나중에 자율 검색/컴퓨터
// 사용(#7)을 열려면 아키텍처가 아니라 이 문자열/정책만 바꾸면 된다. v1: 리핑+기억, 검색 안 함.
export const PROACTIVE_NUDGE = 'The room has gone quiet. Say something on your own, unprompted — riff, react, or bring up something you remember about the user. Keep it short and in character. Do not search the web for this.'

export interface ProactiveSpeechOptions {
  /** 유휴 판정까지의 시간(ms). @default 45000 */
  idleDelayMs?: number
  /** 무응답 연속 능동 발화 상한. @default 1 */
  maxConsecutive?: number
  /** 기능 on/off. @default true */
  enabled?: boolean
  /** neru가 지금 바쁜지(전송/발화 중) — true면 발동을 건너뛴다. */
  isBusy: () => boolean
  /** 능동 턴 실행(넛지를 system 씨앗으로 ingest). 절대 throw하지 않아야 한다(내부에서 처리). */
  trigger: () => Promise<void>
  /** 테스트 주입용 타이머(기본 setTimeout/clearTimeout). */
  setTimer?: (cb: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
}

export interface ProactiveSpeechController {
  /** 사용자 활동(실제 전송 등) — 연속 카운터와 유휴 타이머를 리셋한다. */
  recordUserActivity: () => void
  /** 어떤 턴이 끝났을 때 — 유휴 타이머를 다시 무장한다. */
  noteTurnComplete: () => void
  /** 타이머 정리. */
  dispose: () => void
}

export function createProactiveScheduler(options: ProactiveSpeechOptions): ProactiveSpeechController {
  const idleDelayMs = options.idleDelayMs ?? 45000
  const maxConsecutive = options.maxConsecutive ?? 1
  const enabled = options.enabled ?? true
  const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms))
  const clearTimer = options.clearTimer ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>))

  let consecutive = 0
  let handle: unknown = null
  let firing = false

  function clear() {
    if (handle != null) {
      clearTimer(handle)
      handle = null
    }
  }

  function arm() {
    clear()
    if (!enabled || consecutive >= maxConsecutive)
      return
    handle = setTimer(onIdle, idleDelayMs)
  }

  function onIdle() {
    handle = null
    // 가드: 바쁘거나 상한 도달이거나 이미 발동 중이면 건너뛰고 재무장한다.
    if (firing || options.isBusy() || consecutive >= maxConsecutive) {
      arm()
      return
    }
    firing = true
    consecutive += 1
    // trigger는 throw하지 않기로 계약돼 있지만, 방어적으로 감싸 스케줄러가 죽지 않게 한다.
    // 동기 throw(반환값이 Promise가 되기 전에 던지는 경우)는 .catch()가 잡지 못하므로 try/catch로 이중 방어한다.
    try {
      options.trigger()
        .catch(() => {})
        .finally(() => {
          firing = false
          arm() // 다음 유휴 창을 무장(상한 도달 시 arm이 알아서 멈춤).
        })
    }
    catch {
      firing = false
      arm()
    }
  }

  arm()

  return {
    recordUserActivity() {
      consecutive = 0
      arm()
    },
    noteTurnComplete() {
      arm()
    },
    dispose() {
      clear()
    },
  }
}

export function useProactiveSpeech(options: ProactiveSpeechOptions): ProactiveSpeechController {
  const controller = createProactiveScheduler(options)
  onScopeDispose(() => controller.dispose())
  return controller
}
