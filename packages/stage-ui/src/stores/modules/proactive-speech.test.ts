import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

/**
 * Only vi.fn() mocks live in vi.hoisted() — ref() is not available yet.
 */
const {
  generateAssistantMock,
  getProviderInstanceMock,
  emitTextOutputMock,
  appendSessionMessageMock,
  getSessionMessagesMock,
} = vi.hoisted(() => {
  return {
    generateAssistantMock: vi.fn(),
    getProviderInstanceMock: vi.fn(),
    emitTextOutputMock: vi.fn(),
    appendSessionMessageMock: vi.fn(),
    getSessionMessagesMock: vi.fn<() => any[]>(() => []),
  }
})

// ── Reactive state for stores accessed via storeToRefs() ──

const consciousnessState = {
  activeProvider: ref('openai-compatible'),
  activeModel: ref('gpt-4o-mini'),
}

const settingsState = {
  enabled: ref(false),
  intervalMinMs: ref(60_000),
  intervalMaxMs: ref(120_000),
  promptTemplate: ref('It is {{now}}, last at {{lastTriggeredAt}}, as {{cardName}}.'),
  systemPromptOverride: ref(''),
  maxTokens: ref(200),
  showStageTimer: ref(true),
}

const chatSessionGeneration = ref(0)
const chatSessionMessages = ref<any[]>([])

const chatSessionState = {
  activeSessionId: ref('test-session'),
  getSessionMessages: getSessionMessagesMock,
  getSessionGeneration: () => chatSessionGeneration.value,
  appendSessionMessage: appendSessionMessageMock,
}

const chatOrchestratorState = {
  sending: ref(false),
}

// ── Plain-value state for stores accessed directly (Pinia auto-unwraps) ──

const cardState = {
  activeCard: { name: 'Test Character' } as any,
  systemPrompt: 'You are a friendly character.',
}

const speechConfigured = ref(true)

// ── Mock storeToRefs: passthrough values that are already refs ──

vi.mock('pinia', async () => {
  const actual = await vi.importActual<typeof import('pinia')>('pinia')
  return {
    ...actual,
    storeToRefs: (store: any) => {
      const result: Record<string, any> = {}
      for (const key of Object.keys(store)) {
        const val = store[key]
        result[key] = (val && typeof val === 'object' && 'value' in val)
          ? val
          : val
      }
      return result
    },
  }
})

vi.mock('../providers', () => ({
  useProvidersStore: () => ({ getProviderInstance: getProviderInstanceMock }),
}))
vi.mock('../character', () => ({
  useCharacterStore: () => ({ emitTextOutput: emitTextOutputMock }),
}))
vi.mock('./consciousness', () => ({
  useConsciousnessStore: () => consciousnessState,
}))
vi.mock('./speech', () => ({
  useSpeechStore: () => ({
    get configured() { return speechConfigured.value },
  }),
}))
vi.mock('./airi-card', () => ({
  useAiriCardStore: () => cardState,
}))
vi.mock('../settings/proactive-speech', () => ({
  useSettingsProactiveSpeech: () => settingsState,
}))
vi.mock('../chat/session-store', () => ({
  useChatSessionStore: () => chatSessionState,
}))
vi.mock('../chat', () => ({
  useChatOrchestratorStore: () => ({
    ...chatOrchestratorState,
    generateAssistant: generateAssistantMock,
  }),
}))

function seedAssistant(text: string) {
  generateAssistantMock.mockResolvedValueOnce({
    role: 'assistant',
    content: text,
    slices: [{ type: 'text', text }],
    tool_results: [],
  })
}

function resetDefaults() {
  settingsState.enabled.value = false
  settingsState.intervalMinMs.value = 60_000
  settingsState.intervalMaxMs.value = 120_000
  settingsState.promptTemplate.value = 'It is {{now}}, last at {{lastTriggeredAt}}, as {{cardName}}.'
  settingsState.systemPromptOverride.value = ''
  settingsState.maxTokens.value = 200
  settingsState.showStageTimer.value = true
  consciousnessState.activeProvider.value = 'openai-compatible'
  consciousnessState.activeModel.value = 'gpt-4o-mini'
  speechConfigured.value = true
  chatSessionGeneration.value = 0
  chatSessionMessages.value = []
  cardState.activeCard = { name: 'Test Character' }
  cardState.systemPrompt = 'You are a friendly character.'
  chatSessionState.activeSessionId.value = 'test-session'
  chatOrchestratorState.sending.value = false
  getSessionMessagesMock.mockReset().mockImplementation(() => chatSessionMessages.value)
  generateAssistantMock.mockReset()
  getProviderInstanceMock.mockReset()
  emitTextOutputMock.mockReset()
  appendSessionMessageMock.mockReset().mockImplementation((_sessionId: string, message: any) => {
    chatSessionMessages.value = [...chatSessionMessages.value, message]
  })
  getProviderInstanceMock.mockResolvedValue({ chat: () => ({ baseURL: 'https://example.com/' }) })
}

let pinia: ReturnType<typeof createPinia>

describe('useProactiveSpeechStore', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    resetDefaults()
    pinia = createPinia()
    setActivePinia(pinia)
  })
  afterEach(() => {
    disposePinia(pinia)
    vi.useRealTimers()
  })

  it('does not arm a timer when enabled is false on boot', async () => {
    const mod = await import('./proactive-speech')
    const store = mod.useProactiveSpeechStore()
    expect(store.isRunning).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('arms a single timer when enabled flips to true', async () => {
    settingsState.intervalMinMs.value = 1_000
    settingsState.intervalMaxMs.value = 1_000
    settingsState.enabled.value = true
    const mod = await import('./proactive-speech')
    const store = mod.useProactiveSpeechStore()
    await nextTick()
    expect(store.isRunning).toBe(true)
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1)
  })

  it('clears timer when enabled flips back to false', async () => {
    settingsState.enabled.value = true
    const mod = await import('./proactive-speech')
    const store = mod.useProactiveSpeechStore()
    await nextTick()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    settingsState.enabled.value = false
    await nextTick()
    expect(store.isRunning).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('delegates generated proactive ticks to the chat runtime', async () => {
    settingsState.intervalMinMs.value = 1_000
    settingsState.intervalMaxMs.value = 1_000
    settingsState.enabled.value = true
    const mod = await import('./proactive-speech')
    mod.useProactiveSpeechStore()
    await nextTick()

    seedAssistant('hello')
    // Advance past the first interval. The greeting may fire first
    // (session-change watch at 2.5s) but since card has no greetings,
    // it falls through to the chat runtime. Or just the interval timer fires.
    await vi.advanceTimersByTimeAsync(3_000)
    expect(generateAssistantMock).toHaveBeenCalled()
    expect(appendSessionMessageMock).not.toHaveBeenCalled()
    expect(emitTextOutputMock).not.toHaveBeenCalled()
  })

  it('passes proactive options to assistant-initiated chat runtime calls', async () => {
    settingsState.enabled.value = true
    settingsState.maxTokens.value = 64
    settingsState.systemPromptOverride.value = 'Override character rules.'
    const mod = await import('./proactive-speech')
    const store = mod.useProactiveSpeechStore()
    await nextTick()

    seedAssistant('short')
    await store.trigger()

    expect(generateAssistantMock).toHaveBeenCalledWith(
      expect.stringContaining('Test Character'),
      expect.objectContaining({
        model: 'gpt-4o-mini',
        maxTokens: 64,
        systemPromptOverride: 'Override character rules.',
        systemPromptSupplement: expect.stringContaining('return only the final text that should be spoken aloud'),
      }),
    )
  })

  it('exposes a manual trigger through the chat runtime', async () => {
    settingsState.enabled.value = true
    const mod = await import('./proactive-speech')
    const store = mod.useProactiveSpeechStore()
    await nextTick()
    seedAssistant('manual')
    const outcome = await store.trigger()
    expect(outcome?.text).toBe('manual')
    expect(generateAssistantMock).toHaveBeenCalled()
    expect(emitTextOutputMock).not.toHaveBeenCalled()
  })

  it('lets manual triggers run when scheduled proactive speech is disabled', async () => {
    settingsState.enabled.value = false
    const mod = await import('./proactive-speech')
    const store = mod.useProactiveSpeechStore()
    await nextTick()
    seedAssistant('manual while disabled')
    const outcome = await store.trigger({ manual: true })
    expect(outcome?.text).toBe('manual while disabled')
    expect(generateAssistantMock).toHaveBeenCalled()
    expect(emitTextOutputMock).not.toHaveBeenCalled()
  })

  it('lets generated manual triggers run through chat runtime when speech synthesis is not configured', async () => {
    settingsState.enabled.value = false
    speechConfigured.value = false
    const mod = await import('./proactive-speech')
    const store = mod.useProactiveSpeechStore()
    await nextTick()
    seedAssistant('manual without speech')
    const outcome = await store.trigger({ manual: true })
    expect(outcome?.text).toBe('manual without speech')
    expect(generateAssistantMock).toHaveBeenCalled()
    expect(appendSessionMessageMock).not.toHaveBeenCalled()
    expect(emitTextOutputMock).not.toHaveBeenCalled()
  })

  it('prevents overlapping ticks', async () => {
    settingsState.intervalMinMs.value = 1_000
    settingsState.intervalMaxMs.value = 1_000
    settingsState.enabled.value = true
    const mod = await import('./proactive-speech')
    mod.useProactiveSpeechStore()
    await nextTick()

    // Let the greeting/initial trigger fire first, then reset call count.
    await vi.advanceTimersByTimeAsync(3_000)
    generateAssistantMock.mockClear()

    // Now set up a slow runtime call that hangs until released.
    let r: (() => void) | undefined
    generateAssistantMock.mockImplementationOnce(() => {
      return new Promise<void>((resolve) => {
        r = () => {
          resolve()
        }
      }) as any
    })
    // Advance one tick → runtime starts and hangs.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(generateAssistantMock).toHaveBeenCalledTimes(1)
    // Advance another tick → runtime is still thinking, should NOT call again.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(generateAssistantMock).toHaveBeenCalledTimes(1)
    r?.()
    await Promise.resolve()
  })
})

describe('useProactiveSpeechStore · card greetings', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    resetDefaults()
    cardState.activeCard = { name: 'Test Character', greetings: ['Hello from card!', 'Hey there'] }
    pinia = createPinia()
    setActivePinia(pinia)
  })
  afterEach(() => {
    disposePinia(pinia)
    vi.useRealTimers()
  })

  it('speaks card greeting on first trigger without LLM', async () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.3)
    settingsState.intervalMinMs.value = 1_000
    settingsState.intervalMaxMs.value = 1_000
    settingsState.enabled.value = true
    const mod = await import('./proactive-speech')
    mod.useProactiveSpeechStore()
    await nextTick()
    try {
      await vi.advanceTimersByTimeAsync(2_500)
      expect(generateAssistantMock).not.toHaveBeenCalled()
      expect(emitTextOutputMock).toHaveBeenCalledWith('Hello from card!')
      expect(appendSessionMessageMock).toHaveBeenCalledTimes(1)
    }
    finally { spy.mockRestore() }
  })

  it('speaks card greeting on startup before the first long proactive interval', async () => {
    // ROOT CAUSE:
    //
    // On app startup the active session id and enabled state can already be
    // present before the session-change watcher observes any transition. The
    // regular proactive interval may be minutes away, so the initial card
    // greeting never runs at startup.
    //
    // We fixed this by scheduling the same delayed greeting from start() when
    // the current session still needs a card greeting.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.3)
    settingsState.intervalMinMs.value = 60_000
    settingsState.intervalMaxMs.value = 60_000
    settingsState.enabled.value = true
    const mod = await import('./proactive-speech')
    mod.useProactiveSpeechStore()
    await nextTick()

    try {
      await vi.advanceTimersByTimeAsync(2_500)
      expect(generateAssistantMock).not.toHaveBeenCalled()
      expect(emitTextOutputMock).toHaveBeenCalledWith('Hello from card!')
      expect(appendSessionMessageMock).toHaveBeenCalledTimes(1)
    }
    finally { spy.mockRestore() }
  })

  it('speaks card greeting again after the active session history is cleared', async () => {
    // ROOT CAUSE:
    //
    // Clearing chat history keeps the same session id but bumps the session
    // generation and resets messages to only the system prompt.
    // The previous greeting guard only remembered the session id, so the
    // cleared empty history was still treated as already greeted.
    //
    // We fixed this by recording greeted session generations and scheduling
    // the delayed greeting when the active session generation changes.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.3)
    settingsState.enabled.value = true
    const mod = await import('./proactive-speech')
    const store = mod.useProactiveSpeechStore()
    await nextTick()

    try {
      const firstOutcome = await store.trigger()
      expect(firstOutcome?.text).toBe('Hello from card!')
      expect(emitTextOutputMock).toHaveBeenCalledWith('Hello from card!')
      expect(appendSessionMessageMock).toHaveBeenCalledTimes(1)

      emitTextOutputMock.mockClear()
      appendSessionMessageMock.mockClear()
      chatSessionGeneration.value += 1
      getSessionMessagesMock.mockReturnValue([
        { role: 'system', content: 'system prompt', createdAt: Date.now() },
      ])
      await nextTick()

      await vi.advanceTimersByTimeAsync(2_500)
      expect(generateAssistantMock).not.toHaveBeenCalled()
      expect(emitTextOutputMock).toHaveBeenCalledWith('Hello from card!')
      expect(appendSessionMessageMock).toHaveBeenCalledTimes(1)
    }
    finally { spy.mockRestore() }
  })

  it('speaks card greeting again when a synced cleanup clears messages without a generation update', async () => {
    // ROOT CAUSE:
    //
    // Follower windows receive chat-sync snapshots with updated messages, but
    // session generations are local-only. A cleanup from another authority can
    // therefore turn history back into only the system prompt without changing
    // the follower's generation value.
    //
    // We fixed this by watching for the current session to transition from
    // having conversation messages to only system messages.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.3)
    settingsState.enabled.value = true
    const mod = await import('./proactive-speech')
    const store = mod.useProactiveSpeechStore()
    await nextTick()

    try {
      const firstOutcome = await store.trigger()
      expect(firstOutcome?.text).toBe('Hello from card!')

      chatSessionMessages.value = [
        { role: 'system', content: 'system prompt' },
        {
          role: 'assistant',
          content: 'Hello from card!',
          slices: [{ type: 'text', text: 'Hello from card!' }],
          tool_results: [],
        },
      ]
      await nextTick()

      emitTextOutputMock.mockClear()
      appendSessionMessageMock.mockClear()
      chatSessionMessages.value = [
        { role: 'system', content: 'system prompt', createdAt: Date.now() },
      ]
      await nextTick()

      await vi.advanceTimersByTimeAsync(2_500)
      expect(generateAssistantMock).not.toHaveBeenCalled()
      expect(emitTextOutputMock).toHaveBeenCalledWith('Hello from card!')
      expect(appendSessionMessageMock).toHaveBeenCalledTimes(1)
    }
    finally { spy.mockRestore() }
  })

  it('writes card greeting without direct speech when speech synthesis is not configured', async () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.3)
    settingsState.intervalMinMs.value = 1_000
    settingsState.intervalMaxMs.value = 1_000
    settingsState.enabled.value = true
    speechConfigured.value = false
    const mod = await import('./proactive-speech')
    const store = mod.useProactiveSpeechStore()
    await nextTick()

    try {
      const outcome = await store.trigger()
      expect(outcome?.text).toBe('Hello from card!')
      expect(generateAssistantMock).not.toHaveBeenCalled()
      expect(appendSessionMessageMock).toHaveBeenCalledTimes(1)
      expect(emitTextOutputMock).not.toHaveBeenCalled()
    }
    finally { spy.mockRestore() }
  })

  it('cancels pending new-session greeting when proactive speech is disabled', async () => {
    settingsState.enabled.value = true
    const mod = await import('./proactive-speech')
    const store = mod.useProactiveSpeechStore()
    await nextTick()

    chatSessionState.activeSessionId.value = 'next-session'
    await nextTick()
    settingsState.enabled.value = false
    await nextTick()

    await vi.advanceTimersByTimeAsync(3_000)
    expect(store.isRunning).toBe(false)
    expect(generateAssistantMock).not.toHaveBeenCalled()
    expect(appendSessionMessageMock).not.toHaveBeenCalled()
    expect(emitTextOutputMock).not.toHaveBeenCalled()
  })
})

describe('useProactiveSpeechStore · user activity', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    resetDefaults()
    pinia = createPinia()
    setActivePinia(pinia)
  })
  afterEach(() => {
    disposePinia(pinia)
    vi.useRealTimers()
  })

  it('skips when orchestrator is sending', async () => {
    settingsState.intervalMinMs.value = 1_000
    settingsState.intervalMaxMs.value = 1_000
    settingsState.enabled.value = true
    chatOrchestratorState.sending.value = true
    const mod = await import('./proactive-speech')
    mod.useProactiveSpeechStore()
    await nextTick()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(generateAssistantMock).not.toHaveBeenCalled()
  })

  it('skips when recent user message in cooldown', async () => {
    settingsState.intervalMinMs.value = 1_000
    settingsState.intervalMaxMs.value = 1_000
    settingsState.enabled.value = true
    const mod = await import('./proactive-speech')
    mod.useProactiveSpeechStore()
    await nextTick()
    getSessionMessagesMock.mockReturnValue([{ role: 'user', content: 'hey', createdAt: Date.now() - 5_000 }] as any)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(generateAssistantMock).not.toHaveBeenCalled()
  })
})
