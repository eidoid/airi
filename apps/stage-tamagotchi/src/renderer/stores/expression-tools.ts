import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { expressionTools } from '@proj-airi/stage-ui-live2d/tools/expression-tools'
import { getSpeechBusContext, speechOutputEndEvent } from '@proj-airi/stage-ui/services/speech/bus'
import { useLlmToolsStore } from '@proj-airi/stage-ui/stores/llm-tools'
import { useLlmToolsetPromptsStore } from '@proj-airi/stage-ui/stores/llm-toolset-prompts'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { defineStore } from 'pinia'
import { watch } from 'vue'

const provider = 'live2d-expressions'

/**
 * Registers Live2D expression controls as LLM tools for the active Tamagotchi renderer.
 *
 * The expression store owns the actual model state, while this store only
 * publishes tools when the loaded model has expressions explicitly exposed to
 * the LLM.
 */
export const useTamagotchiExpressionToolsStore = defineStore('tamagotchi-expression-tools', () => {
  const expressionStore = useExpressionStore()
  const llmToolsStore = useLlmToolsStore()
  const llmToolsetPromptsStore = useLlmToolsetPromptsStore()
  const speechBusContext = getSpeechBusContext()

  function hasExposedExpressions(): boolean {
    if (!expressionStore.modelId || expressionStore.expressionGroups.size === 0)
      return false

    if (expressionStore.llmMode === 'all')
      return true

    if (expressionStore.llmMode === 'none')
      return false

    return Array.from(expressionStore.expressionGroups.keys()).some(name => expressionStore.isExposedToLlm(name))
  }

  async function refresh() {
    if (!hasExposedExpressions()) {
      llmToolsStore.clearTools(provider)
      llmToolsetPromptsStore.clearToolsetPrompts(provider)
      console.info('[live2d-expressions] LLM tools cleared: no exposed Live2D expressions.')
      return []
    }

    const exposedExpressions = Array.from(expressionStore.expressionGroups.keys())
      .filter(name => expressionStore.isExposedToLlm(name))

    llmToolsetPromptsStore.registerToolsetPrompts(provider, [{
      id: 'live2d-expressions',
      title: 'Live2D Expressions',
      content: [
        'Use the Live2D expression tools to match AIRI\'s face to the emotional tone of the reply.',
        'Call expression_get when you need the available expression names.',
        'Before or during a cheerful reply, activate a happy or smile expression if one is exposed.',
        'Before or during sad, angry, surprised, or neutral replies, choose the closest exposed expression.',
        'Only use expression names returned by expression_get; unavailable expressions are intentionally hidden by user settings.',
      ].join(' '),
    }])

    const tools = await llmToolsStore.registerTools(provider, expressionTools({
      isSpeechConfigured: () => useSpeechStore().configured,
      onSpeechOutputEnd: (callback) => {
        const dispose = speechBusContext.on(speechOutputEndEvent, () => callback())
        return dispose
      },
    }))
    console.info('[live2d-expressions] LLM tools registered.', {
      exposedExpressions,
      tools: tools.map(tool => tool.function.name),
    })
    return tools
  }

  const stopWatchingExposure = watch(
    () => ({
      exposed: Array.from(expressionStore.llmExposed.entries()),
      groups: Array.from(expressionStore.expressionGroups.keys()),
      mode: expressionStore.llmMode,
      modelId: expressionStore.modelId,
    }),
    () => {
      void refresh()
    },
    { deep: true },
  )

  function dispose() {
    stopWatchingExposure()
    llmToolsStore.clearTools(provider)
    llmToolsetPromptsStore.clearToolsetPrompts(provider)
  }

  return {
    dispose,
    refresh,
  }
})
