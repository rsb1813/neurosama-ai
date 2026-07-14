import { defineStore } from 'pinia'
import { ref } from 'vue'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExpressionBlendMode = 'Add' | 'Multiply' | 'Overwrite'

/**
 * A single expression parameter entry tracked by the store.
 *
 * Each entry maps to a Live2D parameter that is controlled through the
 * expression system (either via exp3 files or direct parameter access).
 */
export interface ExpressionEntry {
  /** Human-readable name (Expression name or raw parameter ID). */
  name: string
  /** Live2D parameter ID (e.g. "ParamWatermarkOFF"). */
  parameterId: string
  /** How this value is applied on top of the base value. */
  blend: ExpressionBlendMode
  /** Runtime value that will be applied every frame. */
  currentValue: number
  /** Application-level default (may be overridden by the user via saveDefaults). */
  defaultValue: number
  /** Original default baked into the moc3 / exp3 file. */
  modelDefault: number
  /**
   * The exp3-specified target value for this parameter (e.g. -1, 1, 10).
   * Used by toggle to know what value to set when activating.
   * For parameters referenced by multiple groups, this stores the first
   * non-zero value encountered.
   */
  targetValue: number
  /** Active auto-reset timer handle, if any. */
  resetTimer?: ReturnType<typeof setTimeout>
}

/**
 * Describes a named expression group loaded from model3.json / exp3.json.
 *
 * One expression group can contain multiple parameter entries (e.g. "Cry"
 * may set both "ParamTear" and "ParamEyeWet").
 */
export interface ExpressionGroupDefinition {
  /** Expression name as declared in model3.json Expressions[].Name. */
  name: string
  /** Parameter entries that belong to this expression group. */
  parameters: {
    parameterId: string
    blend: ExpressionBlendMode
    value: number
  }[]
}

/** Serialisable snapshot returned to the LLM. */
export interface ExpressionState {
  name: string
  value: number
  default: number
  active: boolean
  autoResetAt?: number
}

/** Unified tool result envelope. */
export interface ExpressionToolResult {
  success: boolean
  error?: string
  state?: ExpressionState | ExpressionState[]
  available?: string[]
}

// ---------------------------------------------------------------------------
// Persistence helpers  (localStorage – no extra dependency needed)
// ---------------------------------------------------------------------------

function persistenceKey(modelId: string): string {
  return `expression-defaults:${modelId}`
}

function loadPersistedDefaults(modelId: string): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(persistenceKey(modelId))
    if (!raw)
      return null
    return JSON.parse(raw) as Record<string, number>
  }
  catch {
    return null
  }
}

function savePersistedDefaults(modelId: string, defaults: Record<string, number>): void {
  try {
    localStorage.setItem(persistenceKey(modelId), JSON.stringify(defaults))
  }
  catch (err) {
    console.warn('[expression-store] Failed to persist defaults:', err)
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useExpressionStore = defineStore('live2d-expressions', () => {
  // ---- state ---------------------------------------------------------------

  /** Map keyed by expression/parameter name -> entry. */
  const expressions = ref<Map<string, ExpressionEntry>>(new Map())

  /** Currently loaded model ID (used for persistence scoping). */
  const modelId = ref<string>('')

  // 현재 활성 감정 표정 그룹 이름 — 새 감정이 오면 이전 것을 먼저 리셋해 "한 번에 하나"를 보장한다.
  const activeEmotionGroup = ref<string | null>(null)

  /**
   * Named expression groups parsed from model3.json + exp3.json.
   * Keyed by expression name.
   */
  const expressionGroups = ref<Map<string, ExpressionGroupDefinition>>(new Map())

  /** LLM exposure mode: 'all' exposes everything, 'none' exposes nothing, 'custom' uses per-group map. */
  const llmMode = ref<'all' | 'none' | 'custom'>('none')

  /** Per-group LLM exposure flags (only used when llmMode === 'custom'). */
  const llmExposed = ref<Map<string, boolean>>(new Map())

  // ---- internal helpers ----------------------------------------------------

  function clearAllTimers() {
    for (const entry of expressions.value.values()) {
      if (entry.resetTimer != null) {
        clearTimeout(entry.resetTimer)
        entry.resetTimer = undefined
      }
    }
  }

  function toState(entry: ExpressionEntry): ExpressionState {
    return {
      name: entry.name,
      value: entry.currentValue,
      default: entry.defaultValue,
      active: entry.currentValue !== entry.defaultValue,
      autoResetAt: entry.resetTimer != null ? Date.now() : undefined,
    }
  }

  function allNames(): string[] {
    return Array.from(expressions.value.keys())
  }

  // ---- public API ----------------------------------------------------------

  /**
   * Register all expression entries parsed from the model.
   * Called by the expression-controller after parsing exp3 data.
   */
  function registerExpressions(
    id: string,
    groups: ExpressionGroupDefinition[],
    parameterEntries: ExpressionEntry[],
  ) {
    clearAllTimers()
    expressions.value = new Map()
    expressionGroups.value = new Map()
    modelId.value = id

    // Register expression groups
    for (const group of groups) {
      expressionGroups.value.set(group.name, group)
    }

    // Register individual parameter entries
    for (const entry of parameterEntries) {
      expressions.value.set(entry.name, { ...entry })
    }

    // Restore persisted defaults
    const persisted = loadPersistedDefaults(id)
    if (persisted) {
      for (const [name, defaultVal] of Object.entries(persisted)) {
        const entry = expressions.value.get(name)
        if (entry) {
          entry.defaultValue = defaultVal
          entry.currentValue = defaultVal
        }
      }
    }
  }

  /**
   * Resolve a name to either an expression group or a direct parameter entry.
   * Returns `'group'`, `'param'`, or `null`.
   */
  function resolve(name: string): { kind: 'group', group: ExpressionGroupDefinition } | { kind: 'param', entry: ExpressionEntry } | null {
    const group = expressionGroups.value.get(name)
    if (group)
      return { kind: 'group', group }

    const entry = expressions.value.get(name)
    if (entry)
      return { kind: 'param', entry }

    return null
  }

  /**
   * Set an expression or parameter value.
   */
  function set(name: string, value: boolean | number, duration?: number): ExpressionToolResult {
    const resolved = resolve(name)

    if (!resolved) {
      return {
        success: false,
        error: `Expression or parameter "${name}" not found.`,
        available: allNames(),
      }
    }

    const numericValue = typeof value === 'boolean' ? (value ? 1 : 0) : value

    if (resolved.kind === 'group') {
      const states: ExpressionState[] = []
      for (const param of resolved.group.parameters) {
        const entry = expressions.value.get(param.parameterId)
        if (entry) {
          applyValue(entry, numericValue, duration)
          states.push(toState(entry))
        }
      }
      return { success: true, state: states }
    }

    // Direct parameter
    applyValue(resolved.entry, numericValue, duration)
    return { success: true, state: toState(resolved.entry) }
  }

  /**
   * Get expression state.
   */
  function get(name?: string): ExpressionToolResult {
    if (!name) {
      // Return all
      const states: ExpressionState[] = []
      for (const entry of expressions.value.values()) {
        states.push(toState(entry))
      }
      return { success: true, state: states }
    }

    const resolved = resolve(name)
    if (!resolved) {
      return {
        success: false,
        error: `Expression or parameter "${name}" not found.`,
        available: allNames(),
      }
    }

    if (resolved.kind === 'group') {
      const states: ExpressionState[] = []
      for (const param of resolved.group.parameters) {
        const entry = expressions.value.get(param.parameterId)
        if (entry)
          states.push(toState(entry))
      }
      return { success: true, state: states }
    }

    return { success: true, state: toState(resolved.entry) }
  }

  /**
   * Toggle an expression (flip between default and non-default).
   */
  function toggle(name: string, duration?: number): ExpressionToolResult {
    const resolved = resolve(name)
    if (!resolved) {
      return {
        success: false,
        error: `Expression or parameter "${name}" not found.`,
        available: allNames(),
      }
    }

    if (resolved.kind === 'group') {
      // A group is "active" when at least one of its non-zero (activation)
      // params is currently set to the exp3 value.  Zero-valued params are
      // "reset" instructions and are excluded from the active check.
      const isActive = resolved.group.parameters.some((p) => {
        if (p.value === 0)
          return false
        const entry = expressions.value.get(p.parameterId)
        return entry && entry.currentValue === p.value
      })
      const states: ExpressionState[] = []
      for (const param of resolved.group.parameters) {
        const entry = expressions.value.get(param.parameterId)
        if (entry) {
          const newValue = isActive ? entry.modelDefault : param.value
          applyValue(entry, newValue, duration)
          states.push(toState(entry))
        }
      }
      return { success: true, state: states }
    }

    // Direct parameter toggle: flip between modelDefault and exp3 target value
    const entry = resolved.entry
    const newValue = entry.currentValue !== entry.modelDefault ? entry.modelDefault : entry.targetValue
    applyValue(entry, newValue, duration)
    return { success: true, state: toState(entry) }
  }

  /**
   * Save current values as defaults (persisted across restarts).
   */
  function saveDefaults(): ExpressionToolResult {
    if (!modelId.value) {
      return { success: false, error: 'No model loaded.' }
    }

    const defaults: Record<string, number> = {}
    for (const [name, entry] of expressions.value) {
      entry.defaultValue = entry.currentValue
      defaults[name] = entry.currentValue
    }

    savePersistedDefaults(modelId.value, defaults)
    return { success: true }
  }

  /**
   * Reset all expressions to their default values.
   */
  function resetAll(): ExpressionToolResult {
    clearAllTimers()
    const states: ExpressionState[] = []
    for (const entry of expressions.value.values()) {
      entry.currentValue = entry.modelDefault
      states.push(toState(entry))
    }
    return { success: true, state: states }
  }

  /**
   * 감정에 매핑된 표정을 적용한다. 이전 감정 표정을 즉시 중립으로 되돌린 뒤,
   * 새 그룹의 각 파라미터를 그 그룹의 exp3 타깃값으로 활성화하고 holdSeconds 후 중립 복귀한다.
   * expressionName이 undefined이거나 미등록이면 이전 표정만 리셋한다(중립). 표정 미등록 모델에선 no-op.
   */
  function applyEmotion(expressionName: string | undefined, holdSeconds = 4): void {
    // 이전 감정 표정을 즉시 modelDefault로 되돌린다(한 번에 하나).
    if (activeEmotionGroup.value) {
      const prev = expressionGroups.value.get(activeEmotionGroup.value)
      if (prev) {
        for (const param of prev.parameters) {
          const entry = expressions.value.get(param.parameterId)
          if (entry)
            applyValue(entry, entry.modelDefault)
        }
      }
      activeEmotionGroup.value = null
    }

    // 중립/무매핑/미등록 → 리셋만 하고 종료.
    if (!expressionName)
      return
    const group = expressionGroups.value.get(expressionName)
    if (!group)
      return

    // 각 파라미터를 exp3 타깃값으로 활성화하고 hold 후 modelDefault(진짜 중립)로 자동 복귀한다.
    // resetTo=modelDefault를 명시해 즉시-리셋 경로(위, modelDefault)와 타이머 리셋 경로를 일치시킨다.
    for (const param of group.parameters) {
      const entry = expressions.value.get(param.parameterId)
      if (entry)
        applyValue(entry, param.value, holdSeconds, entry.modelDefault)
    }
    activeEmotionGroup.value = expressionName
  }

  /**
   * Full cleanup when a model is unloaded.
   */
  function dispose() {
    clearAllTimers()
    expressions.value = new Map()
    expressionGroups.value = new Map()
    llmMode.value = 'none'
    llmExposed.value = new Map()
    modelId.value = ''
    activeEmotionGroup.value = null
  }

  // ---- LLM exposure --------------------------------------------------------

  function setLlmMode(mode: 'all' | 'none' | 'custom') {
    llmMode.value = mode
  }

  function setLlmExposed(name: string, value: boolean) {
    llmExposed.value.set(name, value)
  }

  /** Check if a specific expression group is exposed to LLM tools. */
  function isExposedToLlm(name: string): boolean {
    if (llmMode.value === 'all')
      return true
    if (llmMode.value === 'none')
      return false
    return llmExposed.value.get(name) ?? false
  }

  // ---- private -------------------------------------------------------------

  function applyValue(entry: ExpressionEntry, value: number, duration?: number, resetTo?: number) {
    // Cancel existing timer
    if (entry.resetTimer != null) {
      clearTimeout(entry.resetTimer)
      entry.resetTimer = undefined
    }

    entry.currentValue = value

    // Schedule auto-reset if duration > 0
    if (duration && duration > 0) {
      // NOTICE:
      // 자동 복귀 대상은 기본적으로 defaultValue지만, 호출자가 resetTo를 주면 그 값으로 복귀한다.
      // 감정 표정(applyEmotion)은 항상 modelDefault(진짜 중립)로 복귀해야 하므로 resetTo=modelDefault를 넘긴다.
      // 이유: saveDefaults()(LLM 도구 expression_save_defaults / 설정 버튼)가 감정 표정이 활성인 동안 호출되면
      // defaultValue가 비중립 값으로 저장돼, defaultValue에만 의존하면 이후 감정 복귀가 그 값으로 오염된다.
      const target = resetTo ?? entry.defaultValue
      entry.resetTimer = setTimeout(() => {
        entry.currentValue = target
        entry.resetTimer = undefined
      }, duration * 1000)
    }
  }

  return {
    // State (read-only externally, but reactive)
    expressions,
    modelId,
    expressionGroups,
    llmMode,
    llmExposed,

    // Actions
    registerExpressions,
    resolve,
    set,
    get,
    toggle,
    saveDefaults,
    resetAll,
    applyEmotion,
    dispose,
    setLlmMode,
    setLlmExposed,
    isExposedToLlm,
  }
})
