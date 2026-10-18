import type { AudioWindow } from '@proj-airi/pipelines-audio'

import { describe, expect, it, vi } from 'vitest'

import { SileroVad } from './silero-vad'

function createFakeWorker() {
  // The stand-in carries the members that SileroVad calls, so it can pass for a worker without an assertion.
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    onerror: null,
    onmessage: null,
    onmessageerror: null,
  }

  /** The listener that SileroVad registered for `type`, because a test answers messages by hand. */
  function listenerOf(type: string) {
    for (const call of worker.addEventListener.mock.calls) {
      if (call[0] === type)
        return call[1] as (event: unknown) => void
    }
  }

  const answer = (data: unknown) => listenerOf('message')?.({ data })
  const fail = (error: Error) => listenerOf('error')?.({ error, message: error.message })
  return { worker, answer, fail }
}

function windowOf(fill: number, channels = 1): AudioWindow {
  return {
    range: { sourceId: 'mic', startFrame: 0, endFrame: 512 },
    sampleRate: 16000,
    channels: Array.from({ length: channels }, () => new Float32Array(512).fill(fill)),
    discontinuity: false,
  }
}

function createVad() {
  const fake = createFakeWorker()
  const vad = new SileroVad(() => fake.worker)
  return { ...fake, vad }
}

describe('sileroVad', () => {
  it('sends one mono window with its id and resolves with the score of that id', async () => {
    const { worker, answer, vad } = createVad()
    const pending = vad.score(windowOf(0.5, 2), new AbortController().signal)

    expect(worker.postMessage).toHaveBeenCalledOnce()
    const [request, transfer] = worker.postMessage.mock.calls[0]
    expect(request).toMatchObject({ type: 'score', id: 0, discontinuity: false })
    expect(request.samples).toEqual(new Float32Array(512).fill(0.5))
    // The window belongs to the audio input, so only the mono copy crosses the boundary.
    expect(transfer).toEqual([request.samples.buffer])

    answer({ type: 'score', id: 0, score: 0.75 })
    await expect(pending).resolves.toBe(0.75)
    await vad.close()
  })

  it('rejects a window that the model cannot read', async () => {
    const { worker, vad } = createVad()
    const wrongSize = { ...windowOf(0), channels: [new Float32Array(256)] }

    await expect(vad.score(wrongSize, new AbortController().signal)).rejects.toThrow('512 samples')
    expect(worker.postMessage).not.toHaveBeenCalled()
    await vad.close()
  })

  it('rejects a pending window when the caller aborts and drops its late answer', async () => {
    const { answer, vad } = createVad()
    const abort = new AbortController()
    const pending = vad.score(windowOf(0), abort.signal)

    abort.abort('Voice pipeline closed')
    await expect(pending).rejects.toThrow('Voice pipeline closed')
    // A late answer must not throw after the caller stopped waiting.
    answer({ type: 'score', id: 0, score: 0.9 })
    expect(abort.signal.aborted).toBe(true)
    await vad.close()
  })

  it('rejects every window after the worker failed', async () => {
    const { fail, vad } = createVad()
    const pending = vad.score(windowOf(0), new AbortController().signal)

    fail(new Error('model unavailable'))
    await expect(pending).rejects.toThrow('model unavailable')
    await expect(vad.score(windowOf(0), new AbortController().signal)).rejects.toThrow('Speech detection failed: model unavailable')
    await vad.close()
  })

  it('stops the worker and rejects later windows once closed', async () => {
    const { worker, vad } = createVad()

    await vad.close()

    expect(worker.terminate).toHaveBeenCalledOnce()
    await expect(vad.score(windowOf(0), new AbortController().signal)).rejects.toThrow('closed')
  })
})
