/**
 * Speech detection worker.
 *
 * The model runs here, not in the window. A 32 ms window arrives about 31 times per second, and
 * its inference must not compete with rendering or with the rest of the voice pipeline.
 * Windows keep their order: each one continues the recurrent state of the one before it.
 */

import type { PreTrainedModel } from '@huggingface/transformers'

import type { SileroVadRequest, SileroVadResponse } from './silero-vad-protocol'

import { AutoModel, PretrainedConfig, Tensor } from '@huggingface/transformers'
import { errorMessageFrom } from '@moeru/std'

import { SILERO_SAMPLE_RATE, SILERO_WINDOW_SAMPLES } from './silero-vad-protocol'

const MODEL_ID = 'onnx-community/silero-vad'

function createState() {
  return new Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128])
}

let model: Promise<PreTrainedModel> | undefined
let state = createState()
/** The recurrent model reads one window at a time, in arrival order. */
let queue: Promise<void> = Promise.resolve()

function loadModel() {
  // NOTICE:
  // The pipeline configuration is not part of the model repository, so the caller supplies it.
  // Source: `onnx-community/silero-vad` expects a custom config for its recurrent inputs.
  // Removal condition: the model repository ships a config that transformers.js can read.
  model ??= AutoModel.from_pretrained(MODEL_ID, { config: new PretrainedConfig({ model_type: 'custom' }), dtype: 'fp32' })
  return model
}

async function score(request: Extract<SileroVadRequest, { type: 'score' }>): Promise<number> {
  if (request.samples.length !== SILERO_WINDOW_SAMPLES)
    throw new Error('Silero VAD requires 512 samples at 16 kHz')

  const loaded = await loadModel()
  if (request.discontinuity) {
    state.dispose()
    state = createState()
  }

  const input = new Tensor('float32', request.samples, [1, request.samples.length])
  const rate = new Tensor('int64', [SILERO_SAMPLE_RATE], [])
  try {
    const result = await loaded({ input, sr: rate, state })
    state.dispose()
    state = result.stateN
    const value = Number(result.output.data[0])
    result.output.dispose()
    return value
  }
  finally {
    input.dispose()
    rate.dispose()
  }
}

globalThis.addEventListener('message', (event: MessageEvent<SileroVadRequest>) => {
  const request = event.data
  if (request.type !== 'score')
    return

  queue = queue.then(async () => {
    try {
      const message: SileroVadResponse = { type: 'score', id: request.id, score: await score(request) }
      globalThis.postMessage(message)
    }
    catch (error) {
      // A failed window ends this worker. The caller reports it and starts a new listening session.
      const message: SileroVadResponse = { type: 'failed', id: request.id, message: errorMessageFrom(error) ?? 'Speech detection failed' }
      globalThis.postMessage(message)
      throw error
    }
  }).catch(() => {})
})
