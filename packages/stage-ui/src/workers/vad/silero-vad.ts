import type { AudioWindow } from '@proj-airi/pipelines-audio'

import type { SileroVadRequest, SileroVadResponse } from './silero-vad-protocol'

import { errorMessageFrom } from '@moeru/std'

import { toMonoSamples } from '../../libs/voice/mono-samples'
import { SILERO_SAMPLE_RATE, SILERO_WINDOW_SAMPLES } from './silero-vad-protocol'

interface PendingScore {
  resolve: (score: number) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface WorkerConnection {
  readonly worker: Worker
  readonly onMessage: (event: MessageEvent<SileroVadResponse>) => void
  readonly onError: (event: ErrorEvent) => void
}

/** Creates the worker that owns the model. A test supplies a stand-in. */
export type SileroVadWorkerFactory = () => Worker

export interface SileroVadOptions {
  /** The longest time that one worker request can stay unanswered. */
  requestTimeoutMs?: number
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

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
 *   A closed model rejects instead, so a broken detector cannot pass for silence.
 *   A worker failure rejects its pending windows. The next score replaces the worker, so one failed
 *   inference cannot leave the listening session without speech detection.
 */
export class SileroVad {
  private connection: WorkerConnection | undefined
  private readonly pending = new Map<number, PendingScore>()
  private nextId = 0
  private closed = false

  private readonly requestTimeoutMs: number

  constructor(private readonly createWorker: SileroVadWorkerFactory = createDetectionWorker, options: SileroVadOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0)
      throw new Error('Speech detection timeout must be finite and positive')
  }

  score(window: AudioWindow, signal: AbortSignal): Promise<number> {
    signal.throwIfAborted()
    if (this.closed)
      return Promise.reject(new Error('Speech detection is closed'))
    if (window.sampleRate !== SILERO_SAMPLE_RATE || window.channels[0]?.length !== SILERO_WINDOW_SAMPLES)
      return Promise.reject(new Error('Silero VAD requires 512 samples at 16 kHz'))

    // Only the mono copy crosses the boundary. The window's blocks stay with the audio input and its other readers.
    const samples = toMonoSamples(window)
    const id = this.nextId++
    let connection: WorkerConnection
    try {
      connection = this.connection ?? this.openWorker()
    }
    catch (cause) {
      return Promise.reject(cause)
    }

    return new Promise<number>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      const settle = (apply: () => void) => {
        clearTimeout(timeout)
        signal.removeEventListener('abort', abort)
        this.pending.delete(id)
        apply()
      }

      function abort() {
        settle(() => reject(abortError(signal)))
      }

      timeout = setTimeout(() => {
        if (this.connection === connection)
          this.retireWorker(connection, new Error(`Speech detection timed out after ${this.requestTimeoutMs} ms`))
      }, this.requestTimeoutMs)
      this.pending.set(id, {
        resolve: score => settle(() => resolve(score)),
        reject: error => settle(() => reject(error)),
        timeout,
      })
      signal.addEventListener('abort', abort, { once: true })
      const request: SileroVadRequest = { type: 'score', id, samples, discontinuity: window.discontinuity }
      try {
        connection.worker.postMessage(request, [samples.buffer])
      }
      catch (cause) {
        this.retireWorker(connection, cause instanceof Error ? cause : new Error('Speech detection failed', { cause }))
      }
    })
  }

  async close(): Promise<void> {
    if (this.closed)
      return
    this.closed = true
    if (this.connection)
      this.retireWorker(this.connection, new Error('Speech detection is closed'))
  }

  private openWorker(): WorkerConnection {
    const worker = this.createWorker()
    const connection: WorkerConnection = {
      worker,
      onMessage: (event) => {
        if (this.connection !== connection)
          return

        const response = event.data
        const pending = this.pending.get(response.id)
        if (!pending)
          return

        if (response.type === 'score') {
          pending.resolve(response.score)
          return
        }

        // The worker cannot recover a failed model load or inference on its own. Replace it on the next score.
        this.retireWorker(connection, new Error(response.message))
      },
      onError: (event) => {
        if (this.connection !== connection)
          return

        const message = errorMessageFrom(event.error) ?? errorMessageFrom(event.message) ?? 'unknown error'
        this.retireWorker(connection, new Error(`Speech detection failed: ${message}`))
      },
    }

    worker.addEventListener('message', connection.onMessage)
    worker.addEventListener('error', connection.onError)
    this.connection = connection
    return connection
  }

  private retireWorker(connection: WorkerConnection, error: Error) {
    if (this.connection !== connection)
      return

    this.connection = undefined
    connection.worker.removeEventListener('message', connection.onMessage)
    connection.worker.removeEventListener('error', connection.onError)
    connection.worker.terminate()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
