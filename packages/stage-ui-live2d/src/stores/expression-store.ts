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

export type ExpressionLlmMode = 'all' | 'none' | 'custom'

interface ExpressionRegistrationSnapshot {
  modelId: string
  expressions: Map<string, ExpressionEntry>
  expressionGroups: Map<string, ExpressionGroupDefinition>
  activeExpressionGroups: Set<string>
}

interface PersistedLlmExposure {
  mode: ExpressionLlmMode
  exposed: Record<string, boolean>
}

// ---------------------------------------------------------------------------
// Persistence helpers  (localStorage – no extra dependency needed)
// ---------------------------------------------------------------------------

function persistenceKey(modelId: string): string {
  return `expression-defaults:${modelId}`
}

function llmExposurePersistenceKey(modelId: string): string {
  return `expression-llm-exposure:${modelId}`
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

function isExpressionLlmMode(value: unknown): value is ExpressionLlmMode {
  return value === 'all' || value === 'none' || value === 'custom'
}

function loadPersistedLlmExposure(modelId: string): PersistedLlmExposure | null {
  try {
    const raw = localStorage.getItem(llmExposurePersistenceKey(modelId))
    if (!raw)
      return null

    const parsed = JSON.parse(raw) as Partial<PersistedLlmExposure>
    if (!isExpressionLlmMode(parsed.mode))
      return null

    return {
      mode: parsed.mode,
      exposed: parsed.exposed && typeof parsed.exposed === 'object' ? parsed.exposed : {},
    }
  }
  catch {
    return null
  }
}

function savePersistedLlmExposure(modelId: string, mode: ExpressionLlmMode, exposed: Map<string, boolean>): void {
  try {
    localStorage.setItem(llmExposurePersistenceKey(modelId), JSON.stringify({
      mode,
      exposed: Object.fromEntries(exposed),
    }))
  }
  catch (err) {
    console.warn('[expression-store] Failed to persist LLM exposure:', err)
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

  /**
   * Named expression groups parsed from model3.json + exp3.json.
   * Keyed by expression name.
   */
  const expressionGroups = ref<Map<string, ExpressionGroupDefinition>>(new Map())

  /**
   * Expression group explicitly activated through AIRI's expression store.
   *
   * This is separate from parameter values because Live2D exp3 groups often
   * share parameters. Deriving UI toggle state from parameter equality makes
   * unrelated expression checkboxes appear selected when their exp3 values
   * overlap. The set shape is kept because snapshots are already keyed by
   * group name, but normal expression selection is single-active.
   */
  const activeExpressionGroups = ref<Set<string>>(new Set())

  /** LLM exposure mode: 'all' exposes everything, 'none' exposes nothing, 'custom' uses per-group map. */
  const llmMode = ref<ExpressionLlmMode>('none')

  /** Per-group LLM exposure flags (only used when llmMode === 'custom'). */
  const llmExposed = ref<Map<string, boolean>>(new Map())

  const activeOwnerId = ref<string>('')
  const registrations = new Map<string, ExpressionRegistrationSnapshot>()

  // ---- internal helpers ----------------------------------------------------

  function clearTimers(entries: Iterable<ExpressionEntry>) {
    for (const entry of entries) {
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
    return Array.from(new Set([
      ...expressionGroups.value.keys(),
      ...expressions.value.keys(),
    ]))
  }

  function activateRegistration(ownerId: string, snapshot: ExpressionRegistrationSnapshot) {
    activeOwnerId.value = ownerId
    modelId.value = snapshot.modelId
    expressions.value = snapshot.expressions
    expressionGroups.value = snapshot.expressionGroups
    activeExpressionGroups.value = snapshot.activeExpressionGroups
  }

  function clearActiveRegistration() {
    activeOwnerId.value = ''
    expressions.value = new Map()
    expressionGroups.value = new Map()
    activeExpressionGroups.value = new Set()
    modelId.value = ''
  }

  function deactivateRegistration(ownerId: string) {
    const snapshot = registrations.get(ownerId)
    if (!snapshot)
      return

    clearTimers(snapshot.expressions.values())
    registrations.delete(ownerId)

    if (activeOwnerId.value !== ownerId)
      return

    const fallback = Array.from(registrations.entries()).pop()
    if (fallback) {
      activateRegistration(fallback[0], fallback[1])
      return
    }

    clearActiveRegistration()
    llmMode.value = 'none'
    llmExposed.value = new Map()
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
    ownerId = id,
  ) {
    if (groups.length === 0 && parameterEntries.length === 0) {
      // Failed exp3 reads can otherwise register an empty owner last and make
      // the settings panel report "No expressions available" even when another
      // loaded instance has valid expression metadata.
      deactivateRegistration(ownerId)
      return
    }

    const previous = registrations.get(ownerId)
    if (previous)
      clearTimers(previous.expressions.values())

    const nextExpressions = new Map<string, ExpressionEntry>()
    const nextExpressionGroups = new Map<string, ExpressionGroupDefinition>()

    // Register expression groups
    for (const group of groups) {
      nextExpressionGroups.set(group.name, group)
    }

    // Register individual parameter entries
    for (const entry of parameterEntries) {
      nextExpressions.set(entry.name, { ...entry })
    }

    // Restore persisted defaults
    const persisted = loadPersistedDefaults(id)
    if (persisted) {
      for (const [name, defaultVal] of Object.entries(persisted)) {
        const entry = nextExpressions.get(name)
        if (entry) {
          entry.defaultValue = defaultVal
          entry.currentValue = defaultVal
        }
      }
    }

    const snapshot: ExpressionRegistrationSnapshot = {
      modelId: id,
      expressions: nextExpressions,
      expressionGroups: nextExpressionGroups,
      activeExpressionGroups: new Set(),
    }
    registrations.set(ownerId, snapshot)
    activateRegistration(ownerId, snapshot)
    restoreLlmExposure(id, nextExpressionGroups)
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

    if (resolved.kind === 'group') {
      const states: ExpressionState[] = []
      if (isActivatingGroup(value))
        states.push(...deactivateActiveGroupsExcept(name))

      for (const param of resolved.group.parameters) {
        const entry = expressions.value.get(param.parameterId)
        if (entry) {
          applyValue(entry, groupParameterValue(param, entry, value), duration, () => {
            activeExpressionGroups.value.delete(name)
          })
          states.push(toState(entry))
        }
      }
      updateGroupActiveState(name, value)
      return { success: true, state: states }
    }

    // Direct parameter
    const numericValue = typeof value === 'boolean'
      ? (value ? resolved.entry.targetValue : inactiveValue(resolved.entry))
      : value
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
      return { success: true, state: states, available: allNames() }
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
      const isActive = activeExpressionGroups.value.has(name)
      const states: ExpressionState[] = []
      if (!isActive)
        states.push(...deactivateActiveGroupsExcept(name))

      for (const param of resolved.group.parameters) {
        const entry = expressions.value.get(param.parameterId)
        if (entry) {
          const newValue = isActive ? entry.modelDefault : param.value
          applyValue(entry, newValue, duration, () => {
            activeExpressionGroups.value.delete(name)
          })
          states.push(toState(entry))
        }
      }
      updateGroupActiveState(name, !isActive)
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
    clearTimers(expressions.value.values())
    const states: ExpressionState[] = []
    for (const entry of expressions.value.values()) {
      entry.currentValue = entry.modelDefault
      states.push(toState(entry))
    }
    activeExpressionGroups.value.clear()
    return { success: true, state: states }
  }

  /**
   * Full cleanup when a model is unloaded.
   */
  function dispose(ownerId?: string) {
    if (!ownerId) {
      for (const snapshot of registrations.values()) {
        clearTimers(snapshot.expressions.values())
      }
      registrations.clear()
      clearActiveRegistration()
      llmMode.value = 'none'
      llmExposed.value = new Map()
      return
    }

    deactivateRegistration(ownerId)
  }

  // ---- LLM exposure --------------------------------------------------------

  function setLlmMode(mode: ExpressionLlmMode) {
    llmMode.value = mode
    persistCurrentLlmExposure()
  }

  function setLlmExposed(name: string, value: boolean) {
    llmExposed.value.set(name, value)
    persistCurrentLlmExposure()
  }

  function setLlmExposure(mode: ExpressionLlmMode, exposed: Iterable<readonly [string, boolean]>) {
    llmMode.value = mode
    llmExposed.value = new Map(exposed)
    persistCurrentLlmExposure()
  }

  function isGroupActive(name: string): boolean {
    return activeExpressionGroups.value.has(name)
  }

  function setActiveExpressionGroups(names: Iterable<string>) {
    activeExpressionGroups.value = new Set(names)
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

  function applyValue(entry: ExpressionEntry, value: number, duration?: number, onReset?: () => void) {
    // Cancel existing timer
    if (entry.resetTimer != null) {
      clearTimeout(entry.resetTimer)
      entry.resetTimer = undefined
    }

    entry.currentValue = value

    // Schedule auto-reset if duration > 0
    if (duration && duration > 0) {
      const resetTo = entry.defaultValue
      entry.resetTimer = setTimeout(() => {
        entry.currentValue = resetTo
        entry.resetTimer = undefined
        onReset?.()
      }, duration * 1000)
    }
  }

  function updateGroupActiveState(name: string, value: boolean | number) {
    if (typeof value === 'boolean') {
      if (value) {
        activeExpressionGroups.value.clear()
        activeExpressionGroups.value.add(name)
      }
      else {
        activeExpressionGroups.value.delete(name)
      }
      return
    }

    if (value === 0) {
      activeExpressionGroups.value.delete(name)
    }
    else {
      activeExpressionGroups.value.clear()
      activeExpressionGroups.value.add(name)
    }
  }

  function isActivatingGroup(value: boolean | number): boolean {
    return typeof value === 'boolean' ? value : value !== 0
  }

  function deactivateActiveGroupsExcept(nextName: string): ExpressionState[] {
    const states: ExpressionState[] = []
    for (const activeName of activeExpressionGroups.value) {
      if (activeName === nextName)
        continue

      const activeGroup = expressionGroups.value.get(activeName)
      if (!activeGroup)
        continue

      for (const param of activeGroup.parameters) {
        const entry = expressions.value.get(param.parameterId)
        if (!entry)
          continue

        applyValue(entry, inactiveValue(entry))
        states.push(toState(entry))
      }
    }
    return states
  }

  function groupParameterValue(
    param: ExpressionGroupDefinition['parameters'][number],
    entry: ExpressionEntry,
    value: boolean | number,
  ): number {
    if (typeof value === 'boolean')
      return value ? param.value : inactiveValue(entry)

    switch (entry.blend) {
      case 'Add':
        return param.value * value
      case 'Multiply':
        return 1 + (param.value - 1) * value
      default:
        return entry.modelDefault + (param.value - entry.modelDefault) * value
    }
  }

  function inactiveValue(entry: ExpressionEntry): number {
    switch (entry.blend) {
      case 'Add':
        return 0
      case 'Multiply':
        return 1
      default:
        return entry.modelDefault
    }
  }

  function restoreLlmExposure(id: string, groups: Map<string, ExpressionGroupDefinition>) {
    const persisted = loadPersistedLlmExposure(id)
    if (!persisted) {
      llmMode.value = 'none'
      llmExposed.value = new Map()
      return
    }

    llmMode.value = persisted.mode
    llmExposed.value = new Map(
      Array.from(groups.keys()).map(name => [name, persisted.exposed[name] ?? false] as const),
    )
  }

  function persistCurrentLlmExposure() {
    if (!modelId.value)
      return

    savePersistedLlmExposure(modelId.value, llmMode.value, llmExposed.value)
  }

  return {
    // State (read-only externally, but reactive)
    expressions,
    modelId,
    expressionGroups,
    activeExpressionGroups,
    activeOwnerId,
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
    dispose,
    setLlmMode,
    setLlmExposed,
    setLlmExposure,
    setActiveExpressionGroups,
    isGroupActive,
    isExposedToLlm,
  }
})
