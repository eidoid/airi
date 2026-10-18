/**
 * The message contract between the voice pipeline and the speech detection worker.
 *
 * One `score` request carries one mono window. The worker answers with the score of the same id,
 * so the caller can match answers even when it aborts a window before the model runs.
 */

/** The model reads windows of this length at this rate. */
export const SILERO_WINDOW_SAMPLES = 512
export const SILERO_SAMPLE_RATE = 16000

export interface SileroVadRequest {
  readonly type: 'score'
  readonly id: number
  /** Mono samples at {@link SILERO_SAMPLE_RATE}. The worker owns the buffer after the transfer. */
  readonly samples: Float32Array
  /** The source played this window after a gap, so the model starts a new stream. */
  readonly discontinuity: boolean
}

export type SileroVadResponse = {
  readonly type: 'score'
  readonly id: number
  /** Speech probability between 0 and 1. */
  readonly score: number
} | {
  readonly type: 'failed'
  readonly id: number
  readonly message: string
}
