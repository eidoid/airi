import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useExpressionStore } from './expression-store'

/**
 * @example
 * describe('expression store', () => {})
 */
describe('expression store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
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
})
