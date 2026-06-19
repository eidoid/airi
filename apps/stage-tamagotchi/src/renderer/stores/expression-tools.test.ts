import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { useLlmToolsStore } from '@proj-airi/stage-ui/stores/llm-tools'
import { useLlmToolsetPromptsStore } from '@proj-airi/stage-ui/stores/llm-toolset-prompts'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import { useTamagotchiExpressionToolsStore } from './expression-tools'

describe('useTamagotchiExpressionToolsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function registerLive2DExpressions() {
    const expressionStore = useExpressionStore()
    expressionStore.registerExpressions(
      'mita-main',
      [{ name: 'happy', parameters: [{ parameterId: 'ParamMouthForm', blend: 'Add', value: 1 }] }],
      [{
        name: 'ParamMouthForm',
        parameterId: 'ParamMouthForm',
        blend: 'Add',
        currentValue: 0,
        defaultValue: 0,
        modelDefault: 0,
        targetValue: 1,
      }],
      'main-stage',
    )
    return expressionStore
  }

  it('registers Live2D expression tools only when expressions are exposed to the LLM', async () => {
    const expressionStore = registerLive2DExpressions()
    const llmToolsStore = useLlmToolsStore()
    const llmToolsetPromptsStore = useLlmToolsetPromptsStore()
    const store = useTamagotchiExpressionToolsStore()

    await store.refresh()
    expect(llmToolsStore.toolsByProvider['live2d-expressions']).toBeUndefined()

    expressionStore.setLlmMode('all')
    await nextTick()
    await llmToolsStore.awaitPendingRegistrations()

    expect(llmToolsStore.toolsByProvider['live2d-expressions']?.map(tool => tool.function.name)).toEqual([
      'expression_set',
      'expression_get',
      'expression_toggle',
    ])
    expect(llmToolsetPromptsStore.activeToolsetPrompt).toContain('match AIRI\'s face')

    expressionStore.setLlmMode('none')
    await nextTick()

    expect(llmToolsStore.toolsByProvider['live2d-expressions']).toBeUndefined()
    expect(llmToolsetPromptsStore.promptsByProvider['live2d-expressions']).toBeUndefined()
  })
})
