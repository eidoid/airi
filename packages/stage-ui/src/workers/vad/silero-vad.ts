import type { AudioWindow } from '@proj-airi/pipelines-audio'

import type { SileroVadRequest, SileroVadResponse } from './silero-vad-protocol'

import { errorMessageFrom } from '@moeru/std'

import { toMonoSamples } from '../../libs/voice/mono-samples'
import { SILERO_SAMPLE_RATE, SILERO_WINDOW_SAMPLES } from './silero-vad-protocol'

interface PendingScore {
  resolve: (score: number) => void
  reject: (error: Error) => void
}

/** Creates the worker that owns the model. A test supplies a stand-in. */
export type SileroVadWorkerFactory = () => Worker

function createDetectionWorker(): Worker {
  return new Worker(new URL('./silero-vad.worker.ts', import.meta.url), { type: 'module' })
}

/** Keeps the reason that the caller aborted with, because it names the stage that cancelled the window. */
function abortError(signal: AbortSignal) {
  const reason = signal.reason
  if (reason instanceof Error)
    return reason
  return new Error(typeof reason === 'string' && reason ? reason : 'Speech detection was cancelled')
}

/**
 * Scores audio windows with Silero VAD.
 *
 * The model runs in a worker, so a window costs the caller one copy and one message. Windows keep their order:
 * the caller may issue several, and the worker answers each in turn. Aborting a request drops its answer.
 *
 * Use when:
 * - A voice pipeline needs a speech probability for each 32 ms window at 16 kHz.
 *
 * Returns:
 * - `score` resolves with the speech probability of one window.
 *   A closed model or a failed worker rejects instead, so a broken detector cannot pass for silence.
 */
export class SileroVad {
  private readonly worker: Worker
  private readonly pending = new Map<number, PendingScore>()
  private nextId = 0
  private closed = false
  /** Set when the worker died. Every later score rejects with the same reason. */
  private failure: Error | undefined

  constructor(createWorker: SileroVadWorkerFactory = createDetectionWorker) {
    this.worker = createWorker()
    this.worker.addEventListener('message', this.onMessage)
    this.worker.addEventListener('error', this.onError)
  }

  score(window: AudioWindow, signal: AbortSignal): Promise<number> {
    signal.throwIfAborted()
    if (this.closed)
      return Promise.reject(new Error('Speech detection is closed'))
    if (this.failure)
      return Promise.reject(this.failure)
    if (window.sampleRate !== SILERO_SAMPLE_RATE || window.channels[0]?.length !== SILERO_WINDOW_SAMPLES)
      return Promise.reject(new Error('Silero VAD requires 512 samples at 16 kHz'))

    // Only the mono copy crosses the boundary. The window's blocks stay with the audio input and its other readers.
    const samples = toMonoSamples(window)
    const id = this.nextId++

    return new Promise<number>((resolve, reject) => {
      const settle = (apply: () => void) => {
        signal.removeEventListener('abort', abort)
        this.pending.delete(id)
        apply()
      }

      function abort() {
        settle(() => reject(abortError(signal)))
      }

      this.pending.set(id, {
        resolve: score => settle(() => resolve(score)),
        reject: error => settle(() => reject(error)),
      })
      signal.addEventListener('abort', abort, { once: true })
      const request: SileroVadRequest = { type: 'score', id, samples, discontinuity: window.discontinuity }
      this.worker.postMessage(request, [samples.buffer])
    })
  }

  async close(): Promise<void> {
    if (this.closed)
      return
    this.closed = true
    this.worker.removeEventListener('message', this.onMessage)
    this.worker.removeEventListener('error', this.onError)
    for (const pending of [...this.pending.values()])
      pending.reject(new Error('Speech detection is closed'))
    this.pending.clear()
    this.worker.terminate()
  }

  private readonly onMessage = (event: MessageEvent<SileroVadResponse>) => {
    const response = event.data
    const pending = this.pending.get(response.id)
    if (!pending)
      return

    if (response.type === 'score')
      pending.resolve(response.score)
    else
      pending.reject(new Error(response.message))
  }

  private readonly onError = (event: ErrorEvent) => {
    const message = errorMessageFrom(event.error) ?? errorMessageFrom(event.message) ?? 'unknown error'
    const failure = new Error(`Speech detection failed: ${message}`)
    this.failure = failure
    for (const pending of [...this.pending.values()])
      pending.reject(failure)
  }
}
