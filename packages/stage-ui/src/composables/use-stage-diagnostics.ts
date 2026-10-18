import { errorMessageFrom } from '@moeru/std'
import { onScopeDispose, shallowRef, watch } from 'vue'

import { useSpeakingStore } from '../stores/audio'
import { useSettingsAudioDevice } from '../stores/settings/audio-device'
import { useSettingsDeveloper } from '../stores/settings/developer'
import { useVoiceStore } from '../stores/voice'
import { useVoiceCaptureLeaseStore } from '../stores/voice-capture-lease'
import { useVoiceMessagesStore } from '../stores/voice-messages'
import { useWakeWordDetectionStore } from '../stores/wake-word-detection'

/** One sample of the stage window. Small on purpose: the whole ring must stay far below a megabyte. */
export interface StageDiagnosticSample {
  /** Wall clock in milliseconds. */
  readonly at: number
  /** The window was not visible. Chromium throttles rendering and timers then. */
  readonly hidden: boolean
  /** Frames per second of the requestAnimationFrame loop. Null while the window is hidden. */
  readonly fps: number | null
  /** `performance.memory` values in megabytes. Chromium only, so a browser without it reports null. */
  readonly heapUsedMb: number | null
  readonly heapTotalMb: number | null
  readonly heapLimitMb: number | null
  readonly microphone: { readonly enabled: boolean, readonly ready: boolean }
  readonly input: { readonly phase: string, readonly waitingFor?: string } | null
  /** Preparation of the wake word detector. `unconfigured` means that only a wake can start an input. */
  readonly wake: string
  readonly speaking: boolean
  readonly responses: number
  readonly recording: boolean
  readonly lease: boolean
}

/** Samples that the ring keeps. At the default interval this covers twenty minutes. */
export const STAGE_DIAGNOSTIC_SAMPLES = 240
/** The ring lives in localStorage, so the next session can read what the last one saw. */
export const STAGE_DIAGNOSTIC_STORAGE_KEY = 'diagnostics/stage-samples'

interface MemoryReading {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

/** Reads `performance.memory` without assuming that the browser provides the Chromium extension. */
export function readHeap(): MemoryReading | undefined {
  const memory = (performance as Performance & { memory?: MemoryReading }).memory
  if (!memory)
    return undefined
  return memory
}

const toMegabytes = (bytes: number) => Math.round(bytes / 1024 / 1024)

/**
 * Appends a sample and drops the oldest ones past `limit`.
 *
 * A ring in one array keeps the newest samples in order, so a reader sees the last twenty minutes
 * without parsing a long log.
 */
export function appendSample(samples: readonly StageDiagnosticSample[], sample: StageDiagnosticSample, limit = STAGE_DIAGNOSTIC_SAMPLES) {
  return [...samples, sample].slice(-limit)
}

/** One line for the console. Reads like a log line so it can be copied out of devtools. */
export function formatSample(sample: StageDiagnosticSample) {
  const heap = sample.heapUsedMb === null ? 'heap=?' : `heap=${sample.heapUsedMb}/${sample.heapTotalMb}MB`
  const fps = sample.fps === null ? 'fps=?' : `fps=${sample.fps}`
  const input = sample.input ? `${sample.input.phase}${sample.input.waitingFor ? `(${sample.input.waitingFor})` : ''}` : 'none'
  return `[stage-diagnostics] ${fps} ${heap} mic=${sample.microphone.enabled ? 'on' : 'off'}/${sample.microphone.ready ? 'ready' : 'cold'} wake=${sample.wake} input=${input} speaking=${sample.speaking} responses=${sample.responses} recording=${sample.recording}${sample.lease ? ' lease' : ''}${sample.hidden ? ' hidden' : ''}`
}

function persist(samples: readonly StageDiagnosticSample[], storage: Pick<Storage, 'setItem'> | undefined) {
  try {
    storage?.setItem(STAGE_DIAGNOSTIC_STORAGE_KEY, JSON.stringify(samples))
  }
  catch (cause) {
    // A full or disabled storage must not stop the sampling. The console line below stays.
    console.warn('[stage-diagnostics] Sample ring was not stored', errorMessageFrom(cause))
  }
}

/**
 * Records the frame rate, the heap, and the voice state of the stage window while the developer setting is on.
 *
 * Use when:
 * - The window slows down or the microphone stops answering, and the reason must survive a restart.
 *
 * Expects:
 * - The caller owns the voice host, because the samples read its stores.
 *
 * Returns:
 * - A ring of the newest samples in `localStorage`, and one console line per sample.
 *   The observer watches `settings/developer/stage-diagnostics`, so turning it off stops the sampling.
 */
export function useStageDiagnostics(options: { intervalMs?: number } = {}) {
  const intervalMs = options.intervalMs ?? 5000
  const developer = useSettingsDeveloper()
  const devices = useSettingsAudioDevice()
  const voice = useVoiceStore()
  const wakeWordDetection = useWakeWordDetectionStore()
  const voiceMessages = useVoiceMessagesStore()
  const captureLease = useVoiceCaptureLeaseStore()
  const speaking = useSpeakingStore()

  const samples = shallowRef<readonly StageDiagnosticSample[]>([])
  let frames = 0
  let sampledAt = performance.now()
  /** Storage writes are batched, because the ring is the same size on every sample. */
  let persistedAt = 0
  let frameRequest: number | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  function countFrame() {
    frames += 1
    frameRequest = requestAnimationFrame(countFrame)
  }

  function stop() {
    clearInterval(timer)
    timer = undefined
    if (frameRequest !== undefined)
      cancelAnimationFrame(frameRequest)
    frameRequest = undefined
    frames = 0
  }

  function sample() {
    const now = performance.now()
    const hidden = document.visibilityState === 'hidden'
    const heap = readHeap()
    const attempt = voice.controller.activeInput
    const next: StageDiagnosticSample = {
      at: Date.now(),
      hidden,
      // A hidden window renders no frames, so its count says nothing about the app.
      fps: hidden ? null : Math.round(frames * 1000 / Math.max(1, now - sampledAt)),
      heapUsedMb: heap ? toMegabytes(heap.usedJSHeapSize) : null,
      heapTotalMb: heap ? toMegabytes(heap.totalJSHeapSize) : null,
      heapLimitMb: heap ? toMegabytes(heap.jsHeapSizeLimit) : null,
      microphone: { enabled: devices.enabled, ready: !!devices.stream },
      input: attempt ? { phase: attempt.state.phase, ...(attempt.state.phase === 'pending' ? { waitingFor: attempt.state.waitingFor } : {}) } : null,
      wake: wakeWordDetection.preparation,
      speaking: speaking.nowSpeaking,
      responses: voice.activeTurns.length,
      recording: voiceMessages.isRecording,
      lease: captureLease.held,
    }

    frames = 0
    sampledAt = now
    samples.value = appendSample(samples.value, next)
    // A crash can lose the newest half minute. That is cheaper than rewriting the ring every 5 seconds.
    if (next.at - persistedAt >= 30_000) {
      persistedAt = next.at
      persist(samples.value, globalThis.localStorage)
    }
    console.info(formatSample(next))
  }

  function start() {
    stop()
    frames = 0
    sampledAt = performance.now()
    frameRequest = requestAnimationFrame(countFrame)
    timer = setInterval(sample, intervalMs)
  }

  watch(() => developer.stageDiagnostics, (enabled) => {
    if (enabled)
      start()
    else
      stop()
  }, { immediate: true })

  onScopeDispose(() => {
    stop()
    if (samples.value.length)
      persist(samples.value, globalThis.localStorage)
  })

  return { samples, sample, start, stop }
}
