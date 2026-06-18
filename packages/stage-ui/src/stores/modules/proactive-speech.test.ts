import type { StreamOptions } from '@proj-airi/core-agent'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

/**
 * Only vi.fn() mocks live in vi.hoisted() — ref() is not available yet.
 */
const {
  streamMock,
  getProviderInstanceMock,
  emitTextOutputMock,
  appendSessionMessageMock,
  getSessionMessagesMock,
} = vi.hoisted(() => {
  return {
    streamMock: vi.fn(),
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
}

const chatSessionState = {
  activeSessionId: ref('test-session'),
  getSessionMessages: getSessionMessagesMock,
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

vi.mock('../llm', () => ({
  useLLM: () => ({ stream: streamMock }),
}))
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
  useChatOrchestratorStore: () => chatOrchestratorState,
}))

function seedStream(collectedText: string) {
  streamMock.mockImplementationOnce(async (_a: any, _b: any, _c: any, options?: StreamOptions) => {
    await options?.onStreamEvent?.({ type: 'text-delta', text: collectedText } as any)
    await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' } as any)
  })
}

function resetDefaults() {
  settingsState.enabled.value = false
  settingsState.intervalMinMs.value = 60_000
  settingsState.intervalMaxMs.value = 120_000
  settingsState.promptTemplate.value = 'It is {{now}}, last at {{lastTriggeredAt}}, as {{cardName}}.'
  settingsState.systemPromptOverride.value = ''
  settingsState.maxTokens.value = 200
  consciousnessState.activeProvider.value = 'openai-compatible'
  consciousnessState.activeModel.value = 'gpt-4o-mini'
  speechConfigured.value = true
  cardState.activeCard = { name: 'Test Character' }
  cardState.systemPrompt = 'You are a friendly character.'
  chatSessionState.activeSessionId.value = 'test-session'
  chatOrchestratorState.sending.value = false
  getSessionMessagesMock.mockReset().mockReturnValue([])
  streamMock.mockReset()
  getProviderInstanceMock.mockReset()
  emitTextOutputMock.mockReset()
  appendSessionMessageMock.mockReset()
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

  it('invokes the LLM and writes+speaks on tick', async () => {
    settingsState.intervalMinMs.value = 1_000
    settingsState.intervalMaxMs.value = 1_000
    settingsState.enabled.value = true
    const mod = await import('./proactive-speech')
    mod.useProactiveSpeechStore()
    await nextTick()

    seedStream('hello')
    // Advance past the first interval. The greeting may fire first
    // (session-change watch at 2.5s) but since card has no greetings,
    // it falls through to LLM. Or just the interval timer fires.
    // Either way, streamMock should be called.
    await vi.advanceTimersByTimeAsync(3_000)
    expect(streamMock).toHaveBeenCalled()
    expect(appendSessionMessageMock).toHaveBeenCalled()
    expect(emitTextOutputMock).toHaveBeenCalledWith('hello')
  })

  it('exposes a manual trigger', async () => {
    settingsState.enabled.value = true
    const mod = await import('./proactive-speech')
    const store = mod.useProactiveSpeechStore()
    await nextTick()
    seedStream('manual')
    const outcome = await store.trigger()
    expect(outcome?.text).toBe('manual')
    expect(emitTextOutputMock).toHaveBeenCalledWith('manual')
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
    streamMock.mockClear()

    // Now set up a slow LLM call that hangs until released.
    let r: (() => void) | undefined
    streamMock.mockImplementationOnce((_a: any, _b: any, _c: any, options?: StreamOptions) => {
      options?.onStreamEvent?.({ type: 'text-delta', text: 'first' } as any)
      return new Promise<void>((resolve) => {
        r = () => {
          options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' } as any)
          resolve()
        }
      })
    })
    // Advance one tick → LLM starts and hangs.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(streamMock).toHaveBeenCalledTimes(1)
    // Advance another tick → LLM is still thinking, should NOT call again.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(streamMock).toHaveBeenCalledTimes(1)
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
      // Advance just past the first interval tick but not the second,
      // so only the greeting fires (no fallback to LLM).
      await vi.advanceTimersByTimeAsync(1_500)
      expect(streamMock).not.toHaveBeenCalled()
      expect(emitTextOutputMock).toHaveBeenCalledWith('Hello from card!')
      expect(appendSessionMessageMock).toHaveBeenCalledTimes(1)
    }
    finally { spy.mockRestore() }
  })

  it('skips card greeting when speech synthesis is not configured', async () => {
    settingsState.intervalMinMs.value = 1_000
    settingsState.intervalMaxMs.value = 1_000
    settingsState.enabled.value = true
    speechConfigured.value = false
    const mod = await import('./proactive-speech')
    const store = mod.useProactiveSpeechStore()
    await nextTick()

    const outcome = await store.trigger()
    expect(outcome?.skippedReason).toBe('speech synthesis is not configured')
    expect(streamMock).not.toHaveBeenCalled()
    expect(appendSessionMessageMock).not.toHaveBeenCalled()
    expect(emitTextOutputMock).not.toHaveBeenCalled()
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
    expect(streamMock).not.toHaveBeenCalled()
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
    expect(streamMock).not.toHaveBeenCalled()
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
    expect(streamMock).not.toHaveBeenCalled()
  })
})
