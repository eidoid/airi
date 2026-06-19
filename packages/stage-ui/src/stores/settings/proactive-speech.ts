import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

/**
 * Default interval window when proactive speech is enabled, in milliseconds.
 * AIRI will pick a uniformly-random delay in [min, max] between turns.
 */
export const PROACTIVE_SPEECH_DEFAULT_INTERVAL_MIN_MS = 3 * 60 * 1000
export const PROACTIVE_SPEECH_DEFAULT_INTERVAL_MAX_MS = 5 * 60 * 1000

/**
 * Default maximum output tokens for the proactive speech LLM call. Kept low so
 * the spoken reply stays short (one to a few sentences) and the latency stays
 * under the chosen interval window.
 */
export const PROACTIVE_SPEECH_DEFAULT_MAX_TOKENS = 200

/**
 * Default user-role prompt template sent to the LLM on every proactive trigger.
 *
 * Supported placeholders:
 * - `{{cardName}}` — active character's display name
 * - `{{now}}` — formatted local timestamp, e.g. `2026-06-16 14:32`
 * - `{{lastTriggeredAt}}` — formatted local timestamp of the previous trigger,
 *   or `(never)` for the very first one
 */
export const PROACTIVE_SPEECH_DEFAULT_PROMPT_TEMPLATE
  = 'It is {{now}} (last spoken at {{lastTriggeredAt}}). The user has been idle.'
    + ' Briefly speak aloud as {{cardName}} — one to three short sentences,'
    + ' no questions, no greetings, just an in-character thought or observation.'
    + ' Keep it under ~200 characters of spoken output.'

/**
 * Default value for the optional system-prompt override. Empty means the
 * active character's `systemPrompt` is used unchanged.
 */
export const PROACTIVE_SPEECH_DEFAULT_SYSTEM_PROMPT_OVERRIDE = ''

export const useSettingsProactiveSpeech = defineStore('settings-proactive-speech', () => {
  const enabled = useLocalStorageManualReset<boolean>(
    'settings/proactive-speech/enabled',
    false,
  )
  const intervalMinMs = useLocalStorageManualReset<number>(
    'settings/proactive-speech/interval-min-ms',
    PROACTIVE_SPEECH_DEFAULT_INTERVAL_MIN_MS,
  )
  const intervalMaxMs = useLocalStorageManualReset<number>(
    'settings/proactive-speech/interval-max-ms',
    PROACTIVE_SPEECH_DEFAULT_INTERVAL_MAX_MS,
  )
  const promptTemplate = useLocalStorageManualReset<string>(
    'settings/proactive-speech/prompt-template',
    PROACTIVE_SPEECH_DEFAULT_PROMPT_TEMPLATE,
  )
  const systemPromptOverride = useLocalStorageManualReset<string>(
    'settings/proactive-speech/system-prompt-override',
    PROACTIVE_SPEECH_DEFAULT_SYSTEM_PROMPT_OVERRIDE,
  )
  const maxTokens = useLocalStorageManualReset<number>(
    'settings/proactive-speech/max-tokens',
    PROACTIVE_SPEECH_DEFAULT_MAX_TOKENS,
  )
  const showStageTimer = useLocalStorageManualReset<boolean>(
    'settings/proactive-speech/show-stage-timer',
    true,
  )

  function resetState() {
    enabled.reset()
    intervalMinMs.reset()
    intervalMaxMs.reset()
    promptTemplate.reset()
    systemPromptOverride.reset()
    maxTokens.reset()
    showStageTimer.reset()
  }

  return {
    enabled,
    intervalMinMs,
    intervalMaxMs,
    promptTemplate,
    systemPromptOverride,
    maxTokens,
    showStageTimer,
    resetState,
  }
})
