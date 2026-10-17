import type { Ref } from 'vue'

import type { ChatHistoryItem } from '@proj-airi/core-agent'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'

// Every dependency of the store is replaced: the module only coordinates the
// chat runtime, the session, the card and the speech pipeline.
const deps = vi.hoisted(() => ({
  ingest: vi.fn<(text: string, options: unknown, sessionId?: string) => Promise<void>>(async () => undefined),
  getChatProviderInstance: vi.fn(async () => ({ generation: vi.fn() })),
  emitTextOutput: vi.fn(async () => undefined),
  appendSessionMessage: vi.fn(),
  getSessionMessages: vi.fn<() => unknown[]>(() => []),
  getSessionGenerationValue: vi.fn(() => 1),
  activeCard: { value: { name: 'ReLU', greetings: ['Hello there!'] } as { name?: string, greetings?: string[] } | undefined },
  speechConfigured: { value: true },
  refs: {} as {
    sending?: Ref<boolean>
    activeSessionId?: Ref<string | undefined>
    activeProvider?: Ref<string>
    activeModel?: Ref<string>
  },
}))

vi.mock('../chat', async () => {
  const { ref } = await import('vue')
  deps.refs.sending = ref(false)
  return { useChatStore: () => ({ ingest: deps.ingest, sending: deps.refs.sending }) }
})

vi.mock('../providers/provider', () => ({
  useProviderStore: () => ({ getChatProviderInstance: deps.getChatProviderInstance }),
}))

vi.mock('../character', () => ({
  useCharacterStore: () => ({ emitTextOutput: deps.emitTextOutput }),
}))

vi.mock('./airi-card', () => ({
  useAiriCardStore: () => ({ get activeCard() { return deps.activeCard.value } }),
}))

vi.mock('./speech', () => ({
  useSpeechStore: () => ({ get configured() { return deps.speechConfigured.value } }),
}))

vi.mock('./consciousness', async () => {
  const { ref } = await import('vue')
  deps.refs.activeProvider = ref('provider')
  deps.refs.activeModel = ref('model')
  return { useConsciousnessStore: () => ({ activeProvider: deps.refs.activeProvider, activeModel: deps.refs.activeModel }) }
})

vi.mock('../chat/session-store', async () => {
  const { ref } = await import('vue')
  deps.refs.activeSessionId = ref<string | undefined>('session-1')
  return {
    useChatSessionStore: () => ({
      activeSessionId: deps.refs.activeSessionId,
      getSessionMessages: deps.getSessionMessages,
      appendSessionMessage: deps.appendSessionMessage,
      getSessionGenerationValue: deps.getSessionGenerationValue,
    }),
  }
})

vi.mock('@proj-airi/stage-shared/composables', () => ({
  useLocalStorageManualReset: <T>(_key: string, initial: T) => {
    const value = shallowRef(initial) as unknown as { value: T, reset: () => void }
    value.reset = () => { value.value = initial }
    return value
  },
}))

const { useProactiveSpeechStore } = await import('./proactive-speech')
const { useSettingsProactiveSpeech } = await import('../settings/proactive-speech')

function message(role: ChatHistoryItem['role'], extra: Partial<ChatHistoryItem> = {}): ChatHistoryItem {
  return { role, content: '', slices: [], tool_results: [], id: `id-${Math.random()}`, ...extra } as ChatHistoryItem
}

describe('proactive speech store', () => {
  let settings: ReturnType<typeof useSettingsProactiveSpeech>
  let store: ReturnType<typeof useProactiveSpeechStore>
  let sessionMessages: ChatHistoryItem[]

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    sessionMessages = []
    deps.getSessionMessages.mockImplementation(() => sessionMessages)
    deps.ingest.mockImplementation(async () => undefined)
    deps.getChatProviderInstance.mockResolvedValue({ generation: vi.fn() })
    deps.activeCard.value = { name: 'ReLU', greetings: ['Hello there!'] }
    deps.speechConfigured.value = true
    deps.refs.activeSessionId!.value = 'session-1'
    deps.refs.sending!.value = false
    deps.refs.activeProvider!.value = 'provider'
    deps.refs.activeModel!.value = 'model'

    settings = useSettingsProactiveSpeech()
    store = useProactiveSpeechStore()
    store.stop()
  })

  it('does not trigger when disabled and not requested manually', async () => {
    settings.enabled = false

    await expect(store.trigger()).resolves.toBeNull()
    expect(deps.ingest).not.toHaveBeenCalled()
    expect(deps.emitTextOutput).not.toHaveBeenCalled()
  })

  it('runs a manual trigger while disabled', async () => {
    settings.enabled = false

    const outcome = await store.trigger({ manual: true })

    expect(outcome?.skippedReason).toBeUndefined()
    expect(deps.emitTextOutput).toHaveBeenCalledWith('Hello there!')
  })

  it('skips while the user is actively chatting', async () => {
    settings.enabled = true
    sessionMessages = [message('user', { createdAt: Date.now() })]

    const outcome = await store.trigger({ manual: true })

    expect(outcome?.skippedReason).toBe('user is active')
    expect(deps.ingest).not.toHaveBeenCalled()
  })

  it('speaks the card greeting of a fresh session instead of calling the LLM', async () => {
    settings.enabled = true
    sessionMessages = [message('system')]

    const outcome = await store.trigger({ manual: true })

    expect(outcome?.text).toBe('Hello there!')
    expect(deps.ingest).not.toHaveBeenCalled()
    expect(deps.appendSessionMessage).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ role: 'assistant', content: 'Hello there!' }),
    )
    expect(deps.emitTextOutput).toHaveBeenCalledWith('Hello there!')
  })

  it('generates through the chat runtime as a notice and speaks the proactive reply', async () => {
    settings.enabled = true
    sessionMessages = [message('user'), message('assistant')]
    const generated = message('assistant', {
      content: 'The room is quiet.',
      proactive: { turnId: 'turn-1', source: 'proactive-speech' },
    } as Partial<ChatHistoryItem>)
    deps.ingest.mockImplementation(async () => {
      sessionMessages = [...sessionMessages, generated]
    })

    const outcome = await store.trigger({ manual: true })

    expect(deps.ingest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ model: 'model', notice: { source: 'proactive-speech' } }),
      'session-1',
    )
    expect(outcome?.text).toBe('The room is quiet.')
    // The chat runtime speaks the notice reply through the voice host; the
    // store must not speak it a second time.
    expect(deps.emitTextOutput).not.toHaveBeenCalled()

    // The runtime calls `chatProvider.generation()`, so the store must pass the
    // generation wrapper rather than the raw provider instance.
    const options = deps.ingest.mock.calls[0]![1] as { chatProvider: { generation?: unknown } }
    expect(typeof options.chatProvider.generation).toBe('function')
  })

  it('skips generation without a chat model', async () => {
    settings.enabled = true
    deps.refs.activeModel!.value = ''
    sessionMessages = [message('user'), message('assistant')]

    const outcome = await store.trigger({ manual: true })

    expect(outcome?.skippedReason).toBe('no chat model configured')
    expect(deps.ingest).not.toHaveBeenCalled()
  })

  it('keeps the greeting when no speech pipeline is configured', async () => {
    settings.enabled = true
    deps.speechConfigured.value = false
    sessionMessages = [message('system')]

    const outcome = await store.trigger({ manual: true })

    expect(outcome?.text).toBe('Hello there!')
    expect(deps.emitTextOutput).not.toHaveBeenCalled()
    expect(deps.appendSessionMessage).toHaveBeenCalled()
  })
})
