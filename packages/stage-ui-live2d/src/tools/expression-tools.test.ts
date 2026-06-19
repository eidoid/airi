import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useExpressionStore } from '../stores/expression-store'
import { expressionTools } from './expression-tools'

describe('expressionTools', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function setupTools(options?: Parameters<typeof expressionTools>[0]) {
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

    const tools = await expressionTools(options)

    const get = tools.find(tool => tool.function.name === 'expression_get')
    const set = tools.find(tool => tool.function.name === 'expression_set')
    const toggle = tools.find(tool => tool.function.name === 'expression_toggle')

    if (!get || !set || !toggle)
      throw new Error('Expected expression_get, expression_set, and expression_toggle tools to be registered.')

    store.setLlmMode('all')
    return { get, set, store, toggle }
  }

  it('only lists expressions exposed by the model settings mode', async () => {
    const { get, store } = await setupTools()
    const toolOptions = { messages: [], toolCallId: 'test-expression-get' }

    store.setLlmExposure('custom', [['happy', true], ['sad', false]])

    const result = JSON.parse(await get.execute({}, toolOptions) as string)

    expect(result.success).toBe(true)
    expect(result.available).toEqual(['happy'])
    expect(result.state).toEqual([
      {
        name: 'happy',
        value: 0,
        default: 0,
        active: false,
      },
    ])
  })

  it('rejects attempts to set expressions that are not exposed to LLM tools', async () => {
    const { set, store } = await setupTools()
    const toolOptions = { messages: [], toolCallId: 'test-expression-set' }

    store.setLlmExposure('custom', [['happy', true], ['sad', false]])

    const result = JSON.parse(await set.execute({ name: 'sad', value: true }, toolOptions) as string)

    expect(result.success).toBe(false)
    expect(result.error).toContain('not exposed')
    expect(result.available).toEqual(['happy'])
    expect(store.isGroupActive('sad')).toBe(false)
  })

  it('resets an LLM-triggered expression after 10 seconds when speech is not configured', async () => {
    vi.useFakeTimers()
    const { set, store } = await setupTools({
      isSpeechConfigured: () => false,
    })
    const toolOptions = { messages: [], toolCallId: 'test-expression-set' }

    const result = JSON.parse(await set.execute({ name: 'happy', value: true }, toolOptions) as string)

    expect(result.success).toBe(true)
    expect(store.isGroupActive('happy')).toBe(true)

    vi.advanceTimersByTime(9999)
    expect(store.isGroupActive('happy')).toBe(true)

    vi.advanceTimersByTime(1)
    expect(store.isGroupActive('happy')).toBe(false)
  })

  it('resets an LLM-triggered expression two seconds after speech output ends', async () => {
    vi.useFakeTimers()
    let speechOutputEnd: (() => void) | undefined
    const { set, store } = await setupTools({
      isSpeechConfigured: () => true,
      onSpeechOutputEnd: (callback) => {
        speechOutputEnd = callback
        return () => {
          speechOutputEnd = undefined
        }
      },
    })
    const toolOptions = { messages: [], toolCallId: 'test-expression-set' }

    const result = JSON.parse(await set.execute({ name: 'happy', value: true }, toolOptions) as string)

    expect(result.success).toBe(true)
    expect(store.isGroupActive('happy')).toBe(true)

    vi.advanceTimersByTime(10_000)
    expect(store.isGroupActive('happy')).toBe(true)

    speechOutputEnd?.()
    vi.advanceTimersByTime(1999)
    expect(store.isGroupActive('happy')).toBe(true)

    vi.advanceTimersByTime(1)
    expect(store.isGroupActive('happy')).toBe(false)
  })

  it('lets an explicit duration override the default speech-aware reset timing', async () => {
    vi.useFakeTimers()
    let speechOutputEnd: (() => void) | undefined
    const { set, store } = await setupTools({
      isSpeechConfigured: () => true,
      onSpeechOutputEnd: (callback) => {
        speechOutputEnd = callback
        return () => {
          speechOutputEnd = undefined
        }
      },
    })
    const toolOptions = { messages: [], toolCallId: 'test-expression-set' }

    const result = JSON.parse(await set.execute({ name: 'happy', value: true, duration: 3 }, toolOptions) as string)

    expect(result.success).toBe(true)
    expect(store.isGroupActive('happy')).toBe(true)
    expect(speechOutputEnd).toBeUndefined()

    vi.advanceTimersByTime(3000)
    expect(store.isGroupActive('happy')).toBe(false)
  })
})
