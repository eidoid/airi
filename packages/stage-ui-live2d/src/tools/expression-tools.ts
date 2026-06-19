import type { ExpressionToolResult } from '../stores/expression-store'

import { tool } from '@xsai/tool'
import { z } from 'zod'

import { useExpressionStore } from '../stores/expression-store'

const DEFAULT_RESET_SECONDS_WITHOUT_SPEECH = 10
const RESET_AFTER_SPEECH_DELAY_MS = 2000

export interface ExpressionToolsOptions {
  /**
   * Returns whether AIRI has speech output configured for the current stage.
   *
   * When this returns `true`, LLM-triggered expressions wait for a speech
   * output completion signal before resetting. When it returns `false`, tools
   * use a fixed 10 second reset window.
   */
  isSpeechConfigured?: () => boolean
  /**
   * Subscribes to the stage-level "speech output ended" signal.
   *
   * The callback is expected to fire after the full speech intent has finished
   * playing, not after a single audio chunk. The returned function unsubscribes
   * the listener.
   */
  onSpeechOutputEnd?: (callback: () => void) => () => void
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function ensureModelLoaded(): ExpressionToolResult | null {
  const store = useExpressionStore()
  if (!store.modelId || store.expressions.size === 0) {
    return { success: false, error: 'No Live2D model is currently loaded.' }
  }
  return null
}

function exposedExpressionNames(): string[] {
  const store = useExpressionStore()
  return Array.from(store.expressionGroups.keys()).filter(name => store.isExposedToLlm(name))
}

function ensureExpressionExposed(name: string): ExpressionToolResult | null {
  const available = exposedExpressionNames()
  if (available.includes(name))
    return null

  return {
    success: false,
    error: `Live2D expression "${name}" is not exposed to LLM tools.`,
    available,
  }
}

function serialize(result: ExpressionToolResult): string {
  return JSON.stringify(result)
}

function logToolResult(toolName: string, input: Record<string, unknown>, result: ExpressionToolResult) {
  console.info(`[live2d-expressions] ${toolName} executed.`, {
    input,
    result,
  })
}

function shouldAutoResetValue(value: boolean | number): boolean {
  return typeof value === 'boolean' ? value : value !== 0
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function createTools(options: ExpressionToolsOptions) {
  let pendingSpeechResetCleanup: (() => void) | undefined

  function clearPendingSpeechReset() {
    pendingSpeechResetCleanup?.()
    pendingSpeechResetCleanup = undefined
  }

  function waitForSpeechOutputThenReset() {
    const store = useExpressionStore()
    let resetTimer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe: (() => void) | undefined

    unsubscribe = options.onSpeechOutputEnd?.(() => {
      unsubscribe?.()
      unsubscribe = undefined
      resetTimer = setTimeout(() => {
        pendingSpeechResetCleanup = undefined
        store.resetAll()
      }, RESET_AFTER_SPEECH_DELAY_MS)
    })

    if (!unsubscribe)
      return

    pendingSpeechResetCleanup = () => {
      unsubscribe?.()
      unsubscribe = undefined
      if (resetTimer != null)
        clearTimeout(resetTimer)
    }
  }

  function resetDurationFor(duration: number | undefined, shouldAutoReset: boolean): number | undefined {
    if (duration != null)
      return duration
    if (!shouldAutoReset)
      return undefined
    if (options.isSpeechConfigured?.() && options.onSpeechOutputEnd)
      return undefined
    return DEFAULT_RESET_SECONDS_WITHOUT_SPEECH
  }

  function scheduleResetIfNeeded(result: ExpressionToolResult, duration: number | undefined, shouldAutoReset: boolean) {
    if (!result.success)
      return

    clearPendingSpeechReset()
    if (duration != null || !shouldAutoReset)
      return
    if (!options.isSpeechConfigured?.() || !options.onSpeechOutputEnd)
      return

    waitForSpeechOutputThenReset()
  }

  return [
  // ----- expression.set ----------------------------------------------------
    tool({
      name: 'expression_set',
      description: [
        'Set a Live2D expression that was exposed in AIRI model settings.',
        'Use a boolean (true/false) to activate or deactivate an expression, or a number (0.0-1.0) for weighted control.',
        'Optionally provide a duration in seconds for auto-reset.',
        'When duration is omitted, AIRI resets after speech finishes when speech is configured, otherwise after 10 seconds.',
        'Use this when matching AIRI facial expression to the conversation tone.',
        'Examples: expression_set("happy", true), expression_set("sad", true, 3)',
      ].join(' '),
      execute: async ({ name, value, duration }) => {
        const err = ensureModelLoaded()
        if (err)
          return serialize(err)

        const exposureError = ensureExpressionExposed(name)
        if (exposureError)
          return serialize(exposureError)

        const shouldAutoReset = shouldAutoResetValue(value)
        const resetDuration = resetDurationFor(duration, shouldAutoReset)
        const store = useExpressionStore()
        const result = store.set(name, value, resetDuration)
        scheduleResetIfNeeded(result, duration, shouldAutoReset)
        logToolResult('expression_set', { duration, name, value }, result)
        return serialize(result)
      },
      parameters: z.object({
        name: z.string().describe('Exposed expression name from expression_get (for example "happy" or "sad")'),
        value: z.union([z.boolean(), z.number()]).describe('true/false for activation, or 0.0-1.0 for weighted control'),
        duration: z.number().optional().describe('Seconds until auto-reset to default. Omit to use AIRI default reset timing.'),
      }),
    }),

    // ----- expression.get ----------------------------------------------------
    tool({
      name: 'expression_get',
      description: [
        'Get current state for Live2D expressions exposed in AIRI model settings.',
        'Omit the name to list all exposed expressions available to the LLM.',
      ].join(' '),
      execute: async ({ name }) => {
        const err = ensureModelLoaded()
        if (err)
          return serialize(err)

        const available = exposedExpressionNames()
        const store = useExpressionStore()
        if (!name) {
          const result: ExpressionToolResult = {
            success: true,
            state: available.map(expressionName => ({
              name: expressionName,
              value: store.isGroupActive(expressionName) ? 1 : 0,
              default: 0,
              active: store.isGroupActive(expressionName),
            })),
            available,
          }
          logToolResult('expression_get', { name }, result)
          return serialize(result)
        }

        const exposureError = ensureExpressionExposed(name)
        if (exposureError)
          return serialize(exposureError)

        const result = store.get(name ?? undefined)
        logToolResult('expression_get', { name }, { ...result, available })
        return serialize({ ...result, available })
      },
      parameters: z.object({
        name: z.string().optional().describe('Exposed expression name. Omit to list all exposed expressions.'),
      }),
    }),

    // ----- expression.toggle -------------------------------------------------
    tool({
      name: 'expression_toggle',
      description: [
        'Toggle a Live2D expression exposed in AIRI model settings.',
        'Optionally provide a duration in seconds for auto-reset.',
        'When duration is omitted, activating an expression resets after speech finishes when speech is configured, otherwise after 10 seconds.',
      ].join(' '),
      execute: async ({ name, duration }) => {
        const err = ensureModelLoaded()
        if (err)
          return serialize(err)

        const exposureError = ensureExpressionExposed(name)
        if (exposureError)
          return serialize(exposureError)

        const store = useExpressionStore()
        const shouldAutoReset = !store.isGroupActive(name)
        const resetDuration = resetDurationFor(duration, shouldAutoReset)
        const result = store.toggle(name, resetDuration)
        scheduleResetIfNeeded(result, duration, shouldAutoReset)
        logToolResult('expression_toggle', { duration, name }, result)
        return serialize(result)
      },
      parameters: z.object({
        name: z.string().describe('Exposed expression name to toggle'),
        duration: z.number().optional().describe('Seconds until auto-reset. Omit to use AIRI default reset timing.'),
      }),
    }),
  ]
}

/**
 * Export all expression tools as a resolved promise array, matching the
 * pattern used by other tool modules in the AIRI codebase.
 */
export const expressionTools = async (options: ExpressionToolsOptions = {}) => Promise.all(createTools(options))
