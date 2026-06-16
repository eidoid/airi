import type { StreamEvent } from '@proj-airi/core-agent'

import { errorMessageFrom } from '@moeru/std'
import { nanoid } from 'nanoid'
import { defineStore, storeToRefs } from 'pinia'
import { onScopeDispose, ref, watch } from 'vue'

import { useCharacterStore } from '../character'
import { useChatOrchestratorStore } from '../chat'
import { useChatSessionStore } from '../chat/session-store'
import { useLLM } from '../llm'
import { useProvidersStore } from '../providers'
import { useSettingsProactiveSpeech } from '../settings/proactive-speech'
import { useAiriCardStore } from './airi-card'
import { useConsciousnessStore } from './consciousness'
import { useSpeechStore } from './speech'

interface ProactiveSpeechTriggerOutcome {
  /** Wall-clock timestamp the trigger started. */
  startedAt: number
  /** Reason a turn was skipped (no provider configured, etc.). `undefined` means a real turn ran. */
  skippedReason?: string
  /** Wall-clock timestamp the trigger completed (skipped or spoken). */
  finishedAt: number
  /** Spoken reply text when not skipped. */
  text?: string
  /** Error message when the LLM call failed mid-turn. */
  error?: string
}

/**
 * Cooldown window after a user message before proactive speech resumes.
 * Prevents AIRI from interrupting an active conversation.
 */
const USER_ACTIVITY_COOLDOWN_MS = 30_000

/**
 * Delay before triggering a greeting on a new session so the UI has time
 * to settle (model loaded, lip-sync ready, etc.).
 */
const NEW_SESSION_GREETING_DELAY_MS = 2500

/**
 * Resolves `{{...}}` placeholders inside the configured prompt template.
 *
 * Before:
 * - 'It is {{now}}, last spoken at {{lastTriggeredAt}}, speak as {{cardName}}.'
 *
 * After (with `now = '14:32'`, `lastTriggeredAt = '14:27'`, `cardName = 'ReLU'`):
 * - 'It is 14:32, last spoken at 14:27, speak as ReLU.'
 */
function fillPromptTemplate(
  template: string,
  replacements: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return replacements[key] ?? match
  })
}

function formatLocalTimestamp(timestamp: number | null): string {
  if (timestamp === null)
    return '(never)'
  const date = new Date(timestamp)
  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function sampleIntervalMs(min: number, max: number): number {
  const safeMin = Math.max(0, Math.min(min, max))
  const safeMax = Math.max(safeMin, max)
  return safeMin + Math.random() * (safeMax - safeMin)
}

export const useProactiveSpeechStore = defineStore('proactive-speech', () => {
  const settings = useSettingsProactiveSpeech()
  const consciousness = useConsciousnessStore()
  const cardStore = useAiriCardStore()
  const speechStore = useSpeechStore()
  const providersStore = useProvidersStore()
  const characterStore = useCharacterStore()
  const llm = useLLM()
  const chatSessionStore = useChatSessionStore()
  const chatOrchestrator = useChatOrchestratorStore()

  const { enabled, intervalMinMs, intervalMaxMs, promptTemplate, systemPromptOverride } = storeToRefs(settings)
  const { activeProvider: activeChatProviderId, activeModel: activeChatModel } = storeToRefs(consciousness)
  const { activeSessionId } = storeToRefs(chatSessionStore)
  const { sending: isOrchestratorSending } = storeToRefs(chatOrchestrator)

  const isRunning = ref(false)
  const isThinking = ref(false)
  const lastTriggeredAt = ref<number | null>(null)
  const lastError = ref<string | null>(null)
  const lastOutcome = ref<ProactiveSpeechTriggerOutcome | null>(null)

  /** Wall-clock timestamp (Date.now()) when the next trigger will fire. `null` when no timer is armed. */
  const nextTriggerAt = ref<number | null>(null)

  /** Sessions that have already received a greeting (persisted across triggers, lost on page reload). */
  const greetedSessions = ref(new Set<string>())

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  function clearTimer() {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle)
      timeoutHandle = null
      nextTriggerAt.value = null
    }
  }

  function armTimer() {
    clearTimer()
    if (disposed)
      return
    if (!enabled.value)
      return
    const delay = sampleIntervalMs(intervalMinMs.value, intervalMaxMs.value)
    nextTriggerAt.value = Date.now() + delay
    timeoutHandle = setTimeout(() => {
      void runTrigger()
    }, delay)
  }

  function start() {
    if (isRunning.value)
      return
    isRunning.value = true
    lastError.value = null
    armTimer()
  }

  function stop() {
    isRunning.value = false
    clearTimer()
  }

  /**
   * Skip guard for prerequisites that are checked on every trigger so a stale
   * "always running" timer cannot call the LLM while the user is in the middle
   * of configuring providers, voice, or model selection.
   */
  function skipReason(): string | undefined {
    if (!activeChatProviderId.value)
      return 'no chat provider configured'
    if (!activeChatModel.value)
      return 'no chat model configured'
    if (!speechStore.configured)
      return 'speech synthesis is not configured'
    return undefined
  }

  /**
   * Picks a random greeting from the active card's greetings array.
   * Returns `undefined` when the card has no greetings configured.
   */
  function pickGreeting(): string | undefined {
    const greetings = cardStore.activeCard?.greetings
      ?.map(g => g.trim())
      .filter(Boolean) ?? []

    if (greetings.length === 0)
      return undefined

    return greetings[Math.floor(Math.random() * greetings.length)]
  }

  /**
   * Checks whether the user is currently active — either the orchestrator is
   * sending a message (LLM generating) or a user message was sent within the
   * cooldown window.
   *
   * Use when:
   * - Deciding whether to skip a proactive speech trigger.
   */
  function isUserActive(): boolean {
    if (isOrchestratorSending.value)
      return true

    const sessionId = activeSessionId.value
    if (!sessionId)
      return false

    const messages = chatSessionStore.getSessionMessages(sessionId)
    if (messages.length === 0)
      return false

    const lastMessage = messages[messages.length - 1]
    if (lastMessage.role === 'user' && Date.now() - (lastMessage.createdAt ?? 0) < USER_ACTIVITY_COOLDOWN_MS)
      return true

    return false
  }

  /**
   * Writes proactive speech output to the active session so the user can
   * review what AIRI said in the chat history.
   */
  function writeToSession(text: string) {
    const sessionId = activeSessionId.value
    if (!sessionId)
      return

    chatSessionStore.appendSessionMessage(sessionId, {
      role: 'assistant',
      content: text,
      slices: [{ type: 'text', text }],
      tool_results: [],
      id: nanoid(),
      createdAt: Date.now(),
    })
  }

  /**
   * Determines whether the current session should receive a card greeting
   * as its first proactive speech output.
   *
   * A session qualifies when it has not been greeted yet and the session's
   * messages do not already contain an assistant message (handles page
   * reloads where the in-memory Set is lost).
   */
  function needsGreeting(sessionId: string): boolean {
    if (greetedSessions.value.has(sessionId))
      return false

    const messages = chatSessionStore.getSessionMessages(sessionId)
    const hasAssistantMessage = messages.some(m => m.role === 'assistant')

    if (hasAssistantMessage) {
      // Already has assistant messages — mark as greeted so we don't
      // keep checking on every trigger.
      greetedSessions.value.add(sessionId)
      return false
    }

    return true
  }

  /**
   * Strips thinking/reasoning markup that some providers emit as text-delta.
   *
   * Before:
   * - "Let me think about that... responseHere is my response"
   *
   * After:
   * - "Here is my response"
   */
  function stripThinkingBlocks(text: string): string {
    return text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/<\/?think>/gi, '')
      .replace(/<\/?thinking>/gi, '')
      .replace(/<(?:think|thinking)\b[^>]*>[\s\S]*?<\/(?:think|thinking)>/gi, '')
      .trim()
  }

  async function generateReply(): Promise<string | undefined> {
    const providerInstance = await providersStore.getProviderInstance(activeChatProviderId.value)
    if (!providerInstance)
      throw new Error(`Chat provider "${activeChatProviderId.value}" is unavailable.`)

    const userPrompt = fillPromptTemplate(promptTemplate.value, {
      cardName: cardStore.activeCard?.name ?? 'AIRI',
      now: formatLocalTimestamp(Date.now()),
      lastTriggeredAt: formatLocalTimestamp(lastTriggeredAt.value),
    })

    const systemPrompt = systemPromptOverride.value.trim().length > 0
      ? systemPromptOverride.value
      : cardStore.systemPrompt

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ]

    let collected = ''
    await llm.stream(activeChatModel.value, providerInstance as Parameters<typeof llm.stream>[1], messages, {
      onStreamEvent: async (event: StreamEvent) => {
        if (event.type === 'text-delta')
          collected += event.text
      },
    })

    return stripThinkingBlocks(collected)
  }

  async function runTrigger(): Promise<ProactiveSpeechTriggerOutcome | null> {
    if (!enabled.value || disposed)
      return null
    if (isThinking.value) {
      armTimer()
      return null
    }

    // Arm the next timer immediately so the next trigger is always scheduled
    // while this trigger is in flight.
    armTimer()

    const startedAt = Date.now()
    isThinking.value = true

    try {
      // Suppress when the user is actively chatting.
      if (isUserActive()) {
        const outcome: ProactiveSpeechTriggerOutcome = {
          startedAt,
          finishedAt: Date.now(),
          skippedReason: 'user is active',
        }
        lastOutcome.value = outcome
        return outcome
      }

      const sessionId = activeSessionId.value
      let text: string | undefined

      // First trigger for a new session: prefer a card greeting.
      if (sessionId && needsGreeting(sessionId)) {
        text = pickGreeting()
        greetedSessions.value.add(sessionId)
      }

      // No greeting (or already greeted): generate via LLM.
      if (!text) {
        const reason = skipReason()
        if (reason) {
          const outcome: ProactiveSpeechTriggerOutcome = {
            startedAt,
            finishedAt: Date.now(),
            skippedReason: reason,
          }
          lastOutcome.value = outcome
          return outcome
        }

        try {
          text = await generateReply()
        }
        catch (error) {
          const outcome: ProactiveSpeechTriggerOutcome = {
            startedAt,
            finishedAt: Date.now(),
            error: errorMessageFrom(error) ?? 'Unknown error',
          }
          lastError.value = outcome.error ?? null
          lastOutcome.value = outcome
          return outcome
        }
      }

      if (!text) {
        const outcome: ProactiveSpeechTriggerOutcome = {
          startedAt,
          finishedAt: Date.now(),
          skippedReason: 'no text to speak',
        }
        lastOutcome.value = outcome
        return outcome
      }

      // Write to session history so the user can review what was said.
      writeToSession(text)

      // Route through the standard speech pipeline.
      await characterStore.emitTextOutput(text)

      lastTriggeredAt.value = Date.now()
      const outcome: ProactiveSpeechTriggerOutcome = {
        startedAt,
        finishedAt: lastTriggeredAt.value,
        text,
      }
      lastOutcome.value = outcome
      lastError.value = null
      return outcome
    }
    finally {
      isThinking.value = false
    }
  }

  // Re-arm the timer whenever the enabled toggle or interval window changes so
  // settings updates take effect on the next scheduled tick without restart.
  // `immediate: true` covers the persisted "enabled" state at app boot — the
  // store has no other entry point that fires on instantiation.
  watch(
    [enabled, intervalMinMs, intervalMaxMs],
    () => {
      if (!enabled.value) {
        stop()
        return
      }
      if (!isRunning.value) {
        start()
        return
      }
      armTimer()
    },
    { immediate: true },
  )

  // When the active session changes and proactive speech is enabled,
  // trigger an immediate greeting (card permitting) so the user hears
  // AIRI right away instead of waiting for the first timer tick.
  watch([activeSessionId, enabled], ([newId, isEnabled], [oldId]) => {
    if (!isEnabled || !newId || newId === oldId)
      return
    if (isThinking.value)
      return

    clearTimer()
    setTimeout(() => {
      void runTrigger()
    }, NEW_SESSION_GREETING_DELAY_MS)
  })

  onScopeDispose(() => {
    disposed = true
    clearTimer()
  })

  return {
    isRunning,
    isThinking,
    lastTriggeredAt,
    lastError,
    lastOutcome,
    nextTriggerAt,
    start,
    stop,
    trigger: runTrigger,
  }
})
