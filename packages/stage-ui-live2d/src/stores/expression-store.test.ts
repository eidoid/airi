import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useExpressionStore } from './expression-store'

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key: string) {
      return values.get(key) ?? null
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null
    },
    removeItem(key: string) {
      values.delete(key)
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
  }
}

/**
 * @example
 * describe('expression store', () => {})
 */
describe('expression store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', createMemoryStorage())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /**
   * @example
   * it('keeps the previous model expressions when a later preview owner unmounts', () => {})
   */
  it('keeps the previous model expressions when a later preview owner unmounts', () => {
    const store = useExpressionStore()

    store.registerExpressions(
      'mita-main',
      [{ name: 'smile', parameters: [{ parameterId: 'ParamMouthForm', blend: 'Add', value: 1 }] }],
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

    store.registerExpressions(
      'mita-preview',
      [{ name: 'happy', parameters: [{ parameterId: 'ParamEyeLSmile', blend: 'Add', value: 1 }] }],
      [{
        name: 'ParamEyeLSmile',
        parameterId: 'ParamEyeLSmile',
        blend: 'Add',
        currentValue: 0,
        defaultValue: 0,
        modelDefault: 0,
        targetValue: 1,
      }],
      'settings-preview',
    )

    expect(store.expressionGroups.has('happy')).toBe(true)
    expect(store.activeOwnerId).toBe('settings-preview')

    store.dispose('settings-preview')

    expect(store.activeOwnerId).toBe('main-stage')
    expect(store.modelId).toBe('mita-main')
    expect(store.expressionGroups.has('smile')).toBe(true)
    expect(store.expressionGroups.has('happy')).toBe(false)
  })

  /**
   * @example
   * it('ignores dispose calls from inactive owners', () => {})
   */
  it('ignores dispose calls from inactive owners', () => {
    const store = useExpressionStore()

    store.registerExpressions(
      'mita-main',
      [{ name: 'smile', parameters: [] }],
      [],
      'main-stage',
    )
    store.registerExpressions(
      'mita-preview',
      [{ name: 'happy', parameters: [] }],
      [],
      'settings-preview',
    )

    store.dispose('main-stage')

    expect(store.activeOwnerId).toBe('settings-preview')
    expect(store.expressionGroups.has('happy')).toBe(true)
  })

  it('keeps the active expression owner when a later owner registers no parsed expressions', () => {
    const store = useExpressionStore()

    store.registerExpressions(
      'mita-main',
      [{ name: 'happy', parameters: [{ parameterId: 'ParamMouthOpenY', blend: 'Add', value: 0.3 }] }],
      [{
        name: 'ParamMouthOpenY',
        parameterId: 'ParamMouthOpenY',
        blend: 'Add',
        currentValue: 0,
        defaultValue: 0,
        modelDefault: 0,
        targetValue: 0.3,
      }],
      'main-stage',
    )

    store.registerExpressions('mita-preview', [], [], 'settings-preview')

    expect(store.activeOwnerId).toBe('main-stage')
    expect(store.expressionGroups.has('happy')).toBe(true)
  })

  it('clears an active owner when the same owner registers no parsed expressions', () => {
    const store = useExpressionStore()

    store.registerExpressions(
      'mita-preview',
      [{ name: 'happy', parameters: [{ parameterId: 'ParamMouthOpenY', blend: 'Add', value: 0.3 }] }],
      [{
        name: 'ParamMouthOpenY',
        parameterId: 'ParamMouthOpenY',
        blend: 'Add',
        currentValue: 0,
        defaultValue: 0,
        modelDefault: 0,
        targetValue: 0.3,
      }],
      'settings-preview',
    )

    store.registerExpressions('mita-preview', [], [], 'settings-preview')

    expect(store.activeOwnerId).toBe('')
    expect(store.expressionGroups.size).toBe(0)
  })

  it('lists expression group names as available expressions', () => {
    const store = useExpressionStore()

    store.registerExpressions(
      'mita-main',
      [{ name: 'happy', parameters: [{ parameterId: 'ParamMouthOpenY', blend: 'Add', value: 0.3 }] }],
      [{
        name: 'ParamMouthOpenY',
        parameterId: 'ParamMouthOpenY',
        blend: 'Add',
        currentValue: 0,
        defaultValue: 0,
        modelDefault: 0,
        targetValue: 0.3,
      }],
      'main-stage',
    )

    const result = store.get()

    expect(result.success).toBe(true)
    expect(result.available).toEqual(['happy', 'ParamMouthOpenY'])
  })

  it('applies expression group boolean values using exp3 parameter values', () => {
    const store = useExpressionStore()

    store.registerExpressions(
      'mita-main',
      [{
        name: 'happy',
        parameters: [
          { parameterId: 'ParamMouthOpenY', blend: 'Add', value: 0.3 },
          { parameterId: 'ParamEyeLOpen', blend: 'Multiply', value: 1.2 },
        ],
      }],
      [
        {
          name: 'ParamMouthOpenY',
          parameterId: 'ParamMouthOpenY',
          blend: 'Add',
          currentValue: 0,
          defaultValue: 0,
          modelDefault: 0,
          targetValue: 0.3,
        },
        {
          name: 'ParamEyeLOpen',
          parameterId: 'ParamEyeLOpen',
          blend: 'Multiply',
          currentValue: 1,
          defaultValue: 1,
          modelDefault: 1,
          targetValue: 1.2,
        },
      ],
      'main-stage',
    )

    store.set('happy', true)

    expect(store.expressions.get('ParamMouthOpenY')?.currentValue).toBe(0.3)
    expect(store.expressions.get('ParamEyeLOpen')?.currentValue).toBe(1.2)

    store.set('happy', false)

    expect(store.expressions.get('ParamMouthOpenY')?.currentValue).toBe(0)
    expect(store.expressions.get('ParamEyeLOpen')?.currentValue).toBe(1)
  })

  it('tracks active expression groups independently from shared parameter values', () => {
    const store = useExpressionStore()

    store.registerExpressions(
      'mita-main',
      [
        { name: 'smile', parameters: [{ parameterId: 'ParamMouthOpenY', blend: 'Add', value: 0.3 }] },
        { name: 'happy', parameters: [{ parameterId: 'ParamMouthOpenY', blend: 'Add', value: 0.3 }] },
      ],
      [{
        name: 'ParamMouthOpenY',
        parameterId: 'ParamMouthOpenY',
        blend: 'Add',
        currentValue: 0,
        defaultValue: 0,
        modelDefault: 0,
        targetValue: 0.3,
      }],
      'main-stage',
    )

    store.toggle('happy')

    expect(store.isGroupActive('happy')).toBe(true)
    expect(store.isGroupActive('smile')).toBe(false)

    store.toggle('happy')

    expect(store.isGroupActive('happy')).toBe(false)
    expect(store.isGroupActive('smile')).toBe(false)
  })

  it('keeps expression group preview selection single-active', () => {
    const store = useExpressionStore()

    store.registerExpressions(
      'mita-main',
      [
        { name: 'smile', parameters: [{ parameterId: 'ParamMouthForm', blend: 'Add', value: 1 }] },
        { name: 'sad', parameters: [{ parameterId: 'ParamBrowLY', blend: 'Add', value: -0.5 }] },
      ],
      [
        {
          name: 'ParamMouthForm',
          parameterId: 'ParamMouthForm',
          blend: 'Add',
          currentValue: 0,
          defaultValue: 0,
          modelDefault: 0,
          targetValue: 1,
        },
        {
          name: 'ParamBrowLY',
          parameterId: 'ParamBrowLY',
          blend: 'Add',
          currentValue: 0,
          defaultValue: 0,
          modelDefault: 0,
          targetValue: -0.5,
        },
      ],
      'main-stage',
    )

    store.toggle('smile')
    store.toggle('sad')

    expect(store.isGroupActive('smile')).toBe(false)
    expect(store.isGroupActive('sad')).toBe(true)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0)
    expect(store.expressions.get('ParamBrowLY')?.currentValue).toBe(-0.5)
  })

  it('clears active expression group state when duration auto-reset expires', () => {
    vi.useFakeTimers()
    const store = useExpressionStore()

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

    store.set('happy', true, 1)

    expect(store.isGroupActive('happy')).toBe(true)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(1)

    vi.advanceTimersByTime(1000)

    expect(store.isGroupActive('happy')).toBe(false)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0)
  })

  it('restores LLM exposure settings when the same model is registered again', () => {
    const store = useExpressionStore()

    store.registerExpressions(
      'mita-main',
      [
        { name: 'happy', parameters: [{ parameterId: 'ParamMouthForm', blend: 'Add', value: 1 }] },
        { name: 'sad', parameters: [{ parameterId: 'ParamBrowLY', blend: 'Add', value: -0.5 }] },
      ],
      [
        {
          name: 'ParamMouthForm',
          parameterId: 'ParamMouthForm',
          blend: 'Add',
          currentValue: 0,
          defaultValue: 0,
          modelDefault: 0,
          targetValue: 1,
        },
        {
          name: 'ParamBrowLY',
          parameterId: 'ParamBrowLY',
          blend: 'Add',
          currentValue: 0,
          defaultValue: 0,
          modelDefault: 0,
          targetValue: -0.5,
        },
      ],
      'main-stage',
    )
    store.setLlmMode('all')

    setActivePinia(createPinia())
    const reloadedStore = useExpressionStore()
    reloadedStore.registerExpressions(
      'mita-main',
      [
        { name: 'happy', parameters: [{ parameterId: 'ParamMouthForm', blend: 'Add', value: 1 }] },
        { name: 'sad', parameters: [{ parameterId: 'ParamBrowLY', blend: 'Add', value: -0.5 }] },
      ],
      [
        {
          name: 'ParamMouthForm',
          parameterId: 'ParamMouthForm',
          blend: 'Add',
          currentValue: 0,
          defaultValue: 0,
          modelDefault: 0,
          targetValue: 1,
        },
        {
          name: 'ParamBrowLY',
          parameterId: 'ParamBrowLY',
          blend: 'Add',
          currentValue: 0,
          defaultValue: 0,
          modelDefault: 0,
          targetValue: -0.5,
        },
      ],
      'main-stage',
    )

    expect(reloadedStore.llmMode).toBe('all')
    expect(reloadedStore.isExposedToLlm('happy')).toBe(true)
    expect(reloadedStore.isExposedToLlm('sad')).toBe(true)
  })

  it('restores custom LLM exposure settings for matching expression groups only', () => {
    const store = useExpressionStore()

    store.registerExpressions(
      'mita-main',
      [
        { name: 'happy', parameters: [{ parameterId: 'ParamMouthForm', blend: 'Add', value: 1 }] },
        { name: 'sad', parameters: [{ parameterId: 'ParamBrowLY', blend: 'Add', value: -0.5 }] },
      ],
      [
        {
          name: 'ParamMouthForm',
          parameterId: 'ParamMouthForm',
          blend: 'Add',
          currentValue: 0,
          defaultValue: 0,
          modelDefault: 0,
          targetValue: 1,
        },
        {
          name: 'ParamBrowLY',
          parameterId: 'ParamBrowLY',
          blend: 'Add',
          currentValue: 0,
          defaultValue: 0,
          modelDefault: 0,
          targetValue: -0.5,
        },
      ],
      'main-stage',
    )
    store.setLlmExposure('custom', [['happy', true], ['sad', false]])

    setActivePinia(createPinia())
    const reloadedStore = useExpressionStore()
    reloadedStore.registerExpressions(
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

    expect(reloadedStore.llmMode).toBe('custom')
    expect(reloadedStore.llmExposed).toEqual(new Map([['happy', true]]))
    expect(reloadedStore.isExposedToLlm('happy')).toBe(true)
    expect(reloadedStore.isExposedToLlm('sad')).toBe(false)
  })
})
