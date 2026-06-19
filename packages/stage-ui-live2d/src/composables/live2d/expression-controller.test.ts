import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useExpressionStore } from '../../stores/expression-store'
import { useExpressionController } from './expression-controller'

type CoreModel = Parameters<ReturnType<typeof useExpressionController>['applyExpressions']>[0]

function createCoreModel(initialValues: Record<string, number> = {}) {
  const values = new Map(Object.entries(initialValues))
  const model = {
    getParameterValueById: vi.fn((id: string) => values.get(id) ?? 0),
    setParameterValueById: vi.fn((id: string, value: number) => {
      values.set(id, value)
    }),
  } as unknown as CoreModel & {
    values: Map<string, number>
    setParameterValueById: ReturnType<typeof vi.fn>
  }
  model.values = values
  return model
}

function advanceExpressionFrames(controller: ReturnType<typeof useExpressionController>, model: CoreModel, frames: number) {
  for (let i = 0; i < frames; i += 1) {
    vi.advanceTimersByTime(16)
    controller.applyExpressions(model)
  }
}

describe('expression controller', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('eases expression parameter changes instead of snapping immediately', () => {
    const store = useExpressionStore()
    const controller = useExpressionController({ internalModel: ref(undefined) })
    const model = createCoreModel({ ParamMouthForm: 0 })

    store.registerExpressions(
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

    store.set('happy', true)
    controller.applyExpressions(model)

    const firstFrameValue = model.values.get('ParamMouthForm') ?? 0
    expect(firstFrameValue).toBeGreaterThan(0)
    expect(firstFrameValue).toBeLessThan(1)

    advanceExpressionFrames(controller, model, 24)

    expect(model.values.get('ParamMouthForm')).toBeCloseTo(1, 1)

    store.resetAll()
    vi.advanceTimersByTime(16)
    controller.applyExpressions(model)

    const firstResetFrameValue = model.values.get('ParamMouthForm') ?? 0
    expect(firstResetFrameValue).toBeGreaterThan(0)
    expect(firstResetFrameValue).toBeLessThan(1)

    advanceExpressionFrames(controller, model, 24)

    expect(model.values.get('ParamMouthForm')).toBeCloseTo(0, 1)
  })
})
