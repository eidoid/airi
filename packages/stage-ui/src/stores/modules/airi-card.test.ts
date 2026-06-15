import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OFFICIAL_SPEECH_PROVIDER_ID } from '../../libs/providers/providers/official'
import { useSettingsStageModel } from '../settings/stage-model'
import { useAiriCardStore } from './airi-card'

vi.mock('./artistry', async () => {
  const { defineStore } = await import('pinia')

  return {
    useArtistryStore: defineStore('artistry', {
      state: () => ({
        globalProvider: 'mock-artistry-provider',
        globalModel: 'mock-artistry-model',
        globalPromptPrefix: 'mock-artistry-prefix',
        globalProviderOptions: {},
        activeProvider: 'mock-artistry-provider',
        activeModel: 'mock-artistry-model',
        defaultPromptPrefix: 'mock-artistry-prefix',
        providerOptions: {},
      }),
      actions: {
        resetToGlobal() {},
      },
    }),
  }
})

vi.mock('./consciousness', async () => {
  const { defineStore } = await import('pinia')

  return {
    useConsciousnessStore: defineStore('consciousness', {
      state: () => ({
        activeProvider: 'mock-consciousness-provider',
        activeModel: 'mock-consciousness-model',
      }),
    }),
  }
})

vi.mock('./speech', async () => {
  const { defineStore } = await import('pinia')

  return {
    useSpeechStore: defineStore('speech', {
      state: () => ({
        activeSpeechProvider: 'mock-speech-provider',
        activeSpeechModel: 'mock-speech-model',
        activeSpeechVoiceId: 'mock-speech-voice',
      }),
    }),
  }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

/**
 * @example
 * describe('airi-card store', () => {})
 */
describe('airi-card store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  /**
   * @example
   * it('persists selected display model on active card', () => {})
   */
  it('persists selected display model on active card', () => {
    const stageModelStore = useSettingsStageModel()
    stageModelStore.stageModelSelected = 'preset-live2d-1'

    const cardStore = useAiriCardStore()
    cardStore.initialize()

    const updated = cardStore.updateActiveCardDisplayModel('display-model-iru-v2')

    expect(updated).toBe(true)
    expect(cardStore.activeCard?.extensions.airi.modules.displayModelId).toBe('display-model-iru-v2')
    expect(stageModelStore.stageModelSelected).toBe('preset-live2d-1')
  })

  /**
   * @example
   * it('freezes a Voice Pack snapshot on the active card', () => {})
   */
  it('freezes a Voice Pack snapshot on the active card', () => {
    const cardStore = useAiriCardStore()
    cardStore.initialize()

    const pack = {
      id: 'vp-1',
      name: 'Neuro Sama',
      provider: 'volcengine',
      model: 'seed-tts-2.0',
      voiceId: 'voice-neuro',
      ttsModelId: 'volcengine/neuro-pool',
      params: { pitch: '+20%', volume: '+5%' },
      costMultiplier: 1.5,
    }

    const bound = cardStore.bindVoicePackToActiveCard(pack)

    expect(bound).toBe(true)
    expect(cardStore.activeCard?.extensions.airi.modules.speech).toMatchObject({
      provider: OFFICIAL_SPEECH_PROVIDER_ID,
      model: 'volcengine/neuro-pool',
      voice_id: 'voice-neuro',
      voicePack: {
        packId: 'vp-1',
        name: 'Neuro Sama',
        provider: 'volcengine',
        model: 'seed-tts-2.0',
        voiceId: 'voice-neuro',
        ttsModelId: 'volcengine/neuro-pool',
        params: { pitch: '+20%', volume: '+5%' },
        costMultiplier: 1.5,
      },
    })
  })

  /**
   * @example
   * it('keeps the frozen Voice Pack independent from later library edits', () => {})
   */
  it('keeps the frozen Voice Pack independent from later library edits', () => {
    const cardStore = useAiriCardStore()
    cardStore.initialize()

    const params = { pitch: '+20%' }
    cardStore.bindVoicePackToActiveCard({
      id: 'vp-1',
      name: 'Frozen',
      provider: 'volcengine',
      model: 'seed-tts-2.0',
      voiceId: 'voice-a',
      ttsModelId: 'volcengine/pool-a',
      params,
      costMultiplier: 1,
    })

    params.pitch = '-10%'

    expect(cardStore.activeCard?.extensions.airi.modules.speech.voicePack?.params).toEqual({ pitch: '+20%' })
    expect(cardStore.activeCard?.extensions.airi.modules.speech.voicePack?.voiceId).toBe('voice-a')
  })

  /**
   * @example
   * it('exports a normalized AIRI card payload', () => {})
   */
  it('exports a normalized AIRI card payload', () => {
    const cardStore = useAiriCardStore()
    cardStore.initialize()

    const cardId = cardStore.addCard({
      name: 'Exportable',
      version: '1.2.3',
      description: 'A card with AIRI module settings.',
      greetings: ['Hello'],
      extensions: {
        airi: {
          modules: {
            consciousness: {
              provider: 'provider-a',
              model: 'model-a',
            },
            speech: {
              provider: 'provider-b',
              model: 'model-b',
              voice_id: 'voice-b',
            },
          },
          agents: {},
        },
      },
    })

    const exported = cardStore.exportCard(cardId)

    expect(exported).toMatchObject({
      format: 'airi-card:v1',
      card: {
        name: 'Exportable',
        version: '1.2.3',
        greetings: ['Hello'],
        extensions: {
          airi: {
            modules: {
              consciousness: {
                provider: 'provider-a',
                model: 'model-a',
              },
              speech: {
                provider: 'provider-b',
                model: 'model-b',
                voice_id: 'voice-b',
              },
            },
          },
        },
      },
    })
    expect(exported?.exportedAt).toEqual(expect.any(String))
  })

  /**
   * @example
   * it('imports an AIRI card export payload', () => {})
   */
  it('imports an AIRI card export payload', () => {
    const cardStore = useAiriCardStore()
    cardStore.initialize()

    const importedId = cardStore.importCard({
      format: 'airi-card:v1',
      exportedAt: '2026-06-15T00:00:00.000Z',
      card: {
        name: 'Imported AIRI',
        version: '2.0.0',
        greetings: ['Hi'],
        extensions: {
          airi: {
            modules: {
              consciousness: {
                provider: 'provider-a',
                model: 'model-a',
              },
              speech: {
                provider: 'provider-b',
                model: 'model-b',
                voice_id: 'voice-b',
              },
            },
            agents: {},
          },
        },
      },
    })

    expect(cardStore.getCard(importedId)).toMatchObject({
      name: 'Imported AIRI',
      version: '2.0.0',
      greetings: ['Hi'],
      extensions: {
        airi: {
          modules: {
            consciousness: {
              provider: 'provider-a',
              model: 'model-a',
            },
            speech: {
              provider: 'provider-b',
              model: 'model-b',
              voice_id: 'voice-b',
            },
          },
        },
      },
    })
  })

  /**
   * @example
   * it('keeps CCV3 JSON import compatibility', () => {})
   */
  it('keeps CCV3 JSON import compatibility', () => {
    const cardStore = useAiriCardStore()
    cardStore.initialize()

    const importedId = cardStore.importCard({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Imported CCV3',
        character_version: '3.0.0',
        description: 'CCV3 description',
        first_mes: 'Hello from CCV3',
        alternate_greetings: ['Alt hello'],
        group_only_greetings: [],
        creator: '',
        creator_notes: '',
        personality: '',
        scenario: '',
        system_prompt: '',
        post_history_instructions: '',
        mes_example: '',
        tags: [],
        extensions: {},
      },
    })

    expect(cardStore.getCard(importedId)).toMatchObject({
      name: 'Imported CCV3',
      version: '3.0.0',
      description: 'CCV3 description',
      greetings: ['Hello from CCV3', 'Alt hello'],
    })
  })
})
