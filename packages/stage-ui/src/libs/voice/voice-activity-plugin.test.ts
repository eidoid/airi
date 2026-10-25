import type { SpeechInputAttempt, TranscriptionEvent } from '@proj-airi/core-agent'
import type { PcmBlock } from '@proj-airi/pipelines-audio'

import { VoiceController } from '@proj-airi/core-agent'
import { AudioInput, createPushStream, Playback } from '@proj-airi/pipelines-audio'
import { expect, it, vi } from 'vitest'

import { listensContinuously, startsInputOnSpeech } from '../../stores/modules/hearing'
import { createVoiceActivityPlugin } from './voice-activity-plugin'

it('accepts a wake word without the echo rejection gate', async () => {
  const source = createPushStream<PcmBlock>()
  const audio = new AudioInput({ live: true, open: () => source.stream }, { historyMs: 360 })
  const acceptSpeech = vi.fn(async () => false)
  const controller = new VoiceController({
    audio,
    submit: vi.fn(),
    transcriber: () => ({ transcribe: () => new ReadableStream<TranscriptionEvent>({ start() {} }) }),
  })
  controller.use(createVoiceActivityPlugin({
    detect: async () => 1,
    target: () => ({ sessionId: 'alice', interruptTurns: [] }),
    detectWakeWord: async () => ({ sessionId: 'alice', interruptTurns: [] }),
    acceptSpeech,
    minSpeechMs: 32,
    silenceMs: 64,
  }), { grants: ['input-control', 'cancel-input'] })
  await Promise.resolve()
  source.write({ range: { sourceId: 'mic', startFrame: 0, endFrame: 32 }, sampleRate: 1000, channels: [new Float32Array(32)] })

  await expect.poll(() => controller.activeInput?.sessionId).toBe('alice')
  expect(acceptSpeech).not.toHaveBeenCalled()
  await controller.close()
})

it('rejects ordinary speech when the echo gate denies it', async () => {
  const source = createPushStream<PcmBlock>()
  const audio = new AudioInput({ live: true, open: () => source.stream }, { historyMs: 360 })
  const acceptSpeech = vi.fn(async () => false)
  const controller = new VoiceController({ audio, submit: vi.fn(), transcriber: vi.fn() })
  controller.use(createVoiceActivityPlugin({
    detect: async () => 1,
    target: () => ({ sessionId: 'alice', interruptTurns: [] }),
    acceptSpeech,
    minSpeechMs: 32,
    silenceMs: 64,
  }), { grants: ['input-control', 'cancel-input'] })
  await Promise.resolve()
  source.write({ range: { sourceId: 'mic', startFrame: 0, endFrame: 32 }, sampleRate: 1000, channels: [new Float32Array(32)] })

  await expect.poll(() => acceptSpeech.mock.calls.length).toBe(1)
  expect(controller.activeInput).toBeUndefined()
  await controller.close()
})

it('names the reason when a paused input drops a wake word', async () => {
  const source = createPushStream<PcmBlock>()
  const audio = new AudioInput({ live: true, open: () => source.stream }, { historyMs: 360 })
  const onWakeDropped = vi.fn()
  const controller = new VoiceController({ audio, submit: vi.fn(), transcriber: vi.fn() })
  controller.use(createVoiceActivityPlugin({
    detect: async () => 0,
    target: () => ({ sessionId: 'alice', interruptTurns: [] }),
    detectWakeWord: async () => ({ sessionId: 'alice', interruptTurns: [] }),
    enabled: () => false,
    pauseReason: () => 'another window holds the microphone',
    onWakeDropped,
    minSpeechMs: 32,
    silenceMs: 64,
  }), { grants: ['input-control', 'cancel-input'] })
  await Promise.resolve()
  source.write({ range: { sourceId: 'mic', startFrame: 0, endFrame: 32 }, sampleRate: 1000, channels: [new Float32Array(32)] })

  await vi.waitFor(() => expect(onWakeDropped).toHaveBeenCalledWith('Automatic input is paused: another window holds the microphone'))
  await controller.close()
})

it('uses ordered VAD signals to capture, stream transcription, and submit to the accepted session', async () => {
  const source = createPushStream<PcmBlock>()
  const audio = new AudioInput({ live: true, open: () => source.stream }, { historyMs: 360 })
  const received: number[] = []
  const submit = vi.fn(async () => ({ status: 'committed' as const, messageId: 'accepted' }))
  let sessionId = 'alice'
  let attempt: SpeechInputAttempt | undefined
  const activity = vi.fn()
  const causes = vi.fn()
  const controller = new VoiceController({ audio, submit, transcriber: () => ({
    transcribe: (request) => {
      const media = request.audio
      return new ReadableStream<TranscriptionEvent>({ async start(output) {
        for await (const block of media)
          received.push(...block.channels[0])
        output.enqueue({ type: 'update', revision: 1, segments: [{ id: 'words', revision: 1, text: 'Hello', final: true, tokens: [] }] })
        output.enqueue({ type: 'complete', revision: 1 })
        output.close()
      } })
    },
  }) })
  controller.use(createVoiceActivityPlugin({
    detect: async window => window.channels[0][0],
    target: () => ({ sessionId, interruptTurns: [] }),
    onInput: () => { attempt = controller.activeInput },
    onActivity: activity,
    beforeBeginInput: causes,
    minSpeechMs: 32,
    silenceMs: 64,
  }), { grants: ['input-control', 'cancel-input'] })
  await Promise.resolve()
  source.write({ range: { sourceId: 'mic', startFrame: 0, endFrame: 32 }, sampleRate: 1000, channels: [new Float32Array(32).fill(1)] })
  await expect.poll(() => attempt?.state.phase).toBe('capturing')
  sessionId = 'bob'
  source.write({ range: { sourceId: 'mic', startFrame: 32, endFrame: 96 }, sampleRate: 1000, channels: [new Float32Array(64)] })
  expect(await attempt!.done).toEqual({ status: 'committed', messageId: 'accepted' })
  expect(received).toHaveLength(96)
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'alice', text: 'Hello' }), expect.any(AbortSignal))
  // Each noted window reaches the host trace in order.
  expect(activity.mock.calls.map(([event]) => [event.inputId, event.speech, event.durationMs])).toEqual([
    [attempt!.id, true, 32],
    [attempt!.id, false, 32],
    [attempt!.id, false, 32],
  ])
  expect(causes.mock.calls).toEqual([['speech']])
  await controller.close()
})

it('starts and transcribes a second input after the first input settles', async () => {
  const source = createPushStream<PcmBlock>()
  const audio = new AudioInput({ live: true, open: () => source.stream }, { historyMs: 360 })
  const submit = vi.fn(async () => ({ status: 'drafted' as const, draftId: 'draft' }))
  let transcriptionCount = 0
  const attempts: SpeechInputAttempt[] = []
  const detectionResets: boolean[] = []
  const controller = new VoiceController({ audio, submit, transcriber: () => ({ transcribe: request => new ReadableStream<TranscriptionEvent>({ async start(output) {
    await request.audio.pipeTo(new WritableStream())
    transcriptionCount += 1
    output.enqueue({ type: 'update', revision: 1, segments: [{ id: 'text', revision: 1, text: `Speech ${transcriptionCount}`, final: true, tokens: [] }] })
    output.enqueue({ type: 'complete', revision: 1 })
    output.close()
  } }) }) })
  controller.use(createVoiceActivityPlugin({
    detect: async (window) => {
      detectionResets.push(window.discontinuity)
      return window.channels[0][0]
    },
    detectWakeWord: async () => ({ sessionId: 'alice', interruptTurns: [] }),
    target: () => undefined,
    onInput: () => attempts.push(controller.activeInput!),
    minSpeechMs: 32,
    silenceMs: 64,
  }), { grants: ['input-control', 'cancel-input'] })
  await Promise.resolve()
  function push(frame: number, value: number) {
    source.write({ range: { sourceId: 'mic', startFrame: frame, endFrame: frame + 32 }, sampleRate: 1000, channels: [new Float32Array(32).fill(value)] })
  }

  push(0, 1)
  await expect.poll(() => attempts.length).toBe(1)
  push(32, 1)
  await expect.poll(() => attempts[0]!.state.phase).toBe('capturing')
  push(64, 1)
  push(96, 0)
  push(128, 0)
  expect(await attempts[0]!.done).toEqual({ status: 'drafted', draftId: 'draft' })

  await expect.poll(() => controller.activeInput).toBeUndefined()
  push(160, 1)
  await expect.poll(() => attempts.length).toBe(2)
  push(192, 1)
  await expect.poll(() => attempts[1]!.state.phase).toBe('capturing')
  push(224, 1)
  push(256, 0)
  push(288, 0)
  expect(await attempts[1]!.done).toMatchObject({ status: 'drafted' })
  expect(submit).toHaveBeenCalledTimes(2)
  expect(submit).toHaveBeenNthCalledWith(2, expect.objectContaining({ text: 'Speech 2' }), expect.any(AbortSignal))
  expect(detectionResets.filter(Boolean).length).toBeGreaterThanOrEqual(2)
  await controller.close()
})

it('ends an input that never sees silence and keeps its words', async () => {
  const frames = createPushStream<PcmBlock>()
  const audio = new AudioInput({ live: true, open: () => frames.stream }, { historyMs: 360 })
  const submit = vi.fn(async () => ({ status: 'committed' as const, messageId: 'long-message' }))
  const controller = new VoiceController({ audio, submit, transcriber: () => ({ transcribe: request => new ReadableStream<TranscriptionEvent>({ async start(output) {
    await request.audio.pipeTo(new WritableStream())
    output.enqueue({ type: 'update', revision: 1, segments: [{ id: 'text', revision: 1, text: 'Hello', final: true, tokens: [] }] })
    output.enqueue({ type: 'complete', revision: 1 })
    output.close()
  } }) }) })
  controller.use(createVoiceActivityPlugin({
    // A noise floor above the lowered threshold keeps every window speech, so silence never ends this input.
    detect: async () => 1,
    target: () => ({ sessionId: 'alice', interruptTurns: [] }),
    minSpeechMs: 32,
    maxInputMs: 128,
    silenceMs: 64,
  }), { grants: ['input-control', 'cancel-input'] })
  await Promise.resolve()
  let frame = 0
  async function push(count = 1) {
    for (let index = 0; index < count; index++) {
      frames.write({ range: { sourceId: 'mic', startFrame: frame, endFrame: frame + 32 }, sampleRate: 1000, channels: [new Float32Array(32).fill(1)] })
      frame += 32
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }

  await push(8)
  await expect.poll(() => controller.activeInput?.state.phase, { timeout: 3000 }).toBe('capturing')
  await push(10)

  // The input ends at its limit instead of blocking every later input of the session.
  await vi.waitFor(() => expect(submit).toHaveBeenCalled(), { timeout: 3000 })
  await controller.close()
})

it('interrupts playback on a wake word without asking the echo gate', async () => {
  const frames = createPushStream<PcmBlock>()
  const audio = new AudioInput({ live: true, open: () => frames.stream })
  const fading = Promise.withResolvers<{ throughMs: number }>()
  const played = vi.fn()
  const fade = vi.fn(() => fading.promise)
  const playback = new Playback({ nowMs: () => 0, play: () => {
    played()
    return { done: new Promise<{ throughMs: number }>(() => {}), stop: fade }
  } })
  const received: number[] = []
  const submit = vi.fn(async () => ({ status: 'committed' as const, messageId: 'wake-message' }))
  const interrupted = vi.fn(async () => ({ status: 'queued' as const }))
  const controller = new VoiceController({ audio, submit, recordInterruption: interrupted, speech: () => ({ playback, synthesize: async () => new Blob(['Speaking']) }), transcriber: () => ({ transcribe(request) {
    const stream = request.audio
    return new ReadableStream<TranscriptionEvent>({ async start(output) {
      for await (const block of stream)
        received.push(...block.channels[0])
      output.enqueue({ type: 'update', revision: 1, segments: [{ id: 'text', revision: 1, text: 'Question', final: true, tokens: [] }] })
      output.enqueue({ type: 'complete', revision: 1 })
      output.close()
    } })
  } }) })
  const turn = { sessionId: 'alice', turnId: 'answer' }
  const response = controller.openResponse(turn)
  const speech = response.openSpeech({ purpose: 'answer' })
  await speech.write('Speaking.')
  speech.end()
  await expect.poll(() => played).toHaveBeenCalledOnce()
  const detected = vi.fn(async () => ({ sessionId: 'alice', interruptTurns: [turn] }))
  const gate = vi.fn(async () => false)
  const causes = vi.fn()
  const onWakeDropped = vi.fn()
  controller.use(createVoiceActivityPlugin({
    detect: async window => window.channels[0][0],
    detectWakeWord: async window => window.range.startFrame === 0 ? detected() : undefined,
    acceptSpeech: gate,
    beforeBeginInput: causes,
    onWakeDropped,
    target: () => ({ sessionId: 'other', interruptTurns: [] }),
    minSpeechMs: 32,
    silenceMs: 32,
  }), { grants: ['input-control', 'cancel-input'] })
  await Promise.resolve()
  function push(startFrame: number, value: number) {
    frames.write({ range: { sourceId: 'mic', startFrame, endFrame: startFrame + 32 }, sampleRate: 1000, channels: [new Float32Array(32).fill(value)] })
  }
  push(0, 1)
  await expect.poll(() => fade).toHaveBeenCalledOnce()
  expect(gate).not.toHaveBeenCalled()
  expect(onWakeDropped).not.toHaveBeenCalled()
  expect(causes.mock.calls).toEqual([['wake-word']])
  const attempt = controller.activeInput!
  expect(attempt.state).toEqual({ phase: 'pending', waitingFor: 'silence' })
  push(32, 1)
  push(64, 1)
  expect(detected).toHaveBeenCalledOnce()
  fading.resolve({ throughMs: 100 })
  // Capture runs during the fade, so speech spoken before playback becomes silent is still transcribed.
  await expect.poll(() => attempt.state.phase).toBe('capturing')
  await expect.poll(() => received.length).toBe(64)
  push(96, 0)
  expect(await attempt.done).toEqual({ status: 'committed', messageId: 'wake-message' })
  expect(received).toHaveLength(96)
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'alice', text: 'Question' }), expect.any(AbortSignal))
  await expect.poll(() => interrupted).toHaveBeenCalledOnce()
  await controller.close()
})

it('starts an input in wake word mode only after a wake word', async () => {
  const frames = createPushStream<PcmBlock>()
  const audio = new AudioInput({ live: true, open: () => frames.stream })
  const submit = vi.fn(async () => ({ status: 'committed' as const, messageId: 'wake-message' }))
  const controller = new VoiceController({ audio, submit, transcriber: () => ({ transcribe: request => new ReadableStream<TranscriptionEvent>({ async start(output) {
    // The test needs only the transcript, so the captured audio is drained and dropped.
    await request.audio.pipeTo(new WritableStream())
    output.enqueue({ type: 'update', revision: 1, segments: [{ id: 'text', revision: 1, text: 'Hello', final: true, tokens: [] }] })
    output.enqueue({ type: 'complete', revision: 1 })
    output.close()
  } }) }) })
  let wake = false
  const target = vi.fn(() => startsInputOnSpeech('wake-word') ? { sessionId: 'active', interruptTurns: [] } : undefined)
  controller.use(createVoiceActivityPlugin({
    detect: async window => window.channels[0][0],
    detectWakeWord: async () => wake ? { sessionId: 'alice', interruptTurns: [] } : undefined,
    target,
    minSpeechMs: 32,
    silenceMs: 64,
  }), { grants: ['input-control', 'cancel-input'] })
  await Promise.resolve()
  function push(startFrame: number, value: number) {
    frames.write({ range: { sourceId: 'mic', startFrame, endFrame: startFrame + 32 }, sampleRate: 1000, channels: [new Float32Array(32).fill(value)] })
  }

  // Speech without a wake word asks for a target, gets none, and starts no input.
  push(0, 1)
  push(32, 1)
  await expect.poll(() => target).toHaveBeenCalledTimes(2)
  expect(controller.activeInput).toBeUndefined()

  wake = true
  push(64, 1)
  await expect.poll(() => controller.activeInput?.sessionId).toBe('alice')
  expect(startsInputOnSpeech('always-on')).toBe(true)
  expect(startsInputOnSpeech('push-to-talk')).toBe(false)
  expect(listensContinuously('wake-word')).toBe(true)
  await controller.close()
})
