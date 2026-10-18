import type { TurnRef, VoicePlugin } from '@proj-airi/core-agent'
import type { AudioRange, AudioWindow } from '@proj-airi/pipelines-audio'

import { createSpeechActivityRule, inputActivitySignal, speechActivitySignal } from '@proj-airi/core-agent'

/** Application policy chooses the destination. The model only supplies scores for ordered windows. */
export interface VoiceActivityOptions {
  readonly detect: (window: AudioWindow, signal: AbortSignal) => Promise<number>
  readonly target: () => { sessionId: string, interruptTurns: readonly TurnRef[] } | undefined
  /**
   * External KWS adapters resolve pronunciation ownership and the character session before returning a wake signal.
   * `activity` is the VAD result of the same window, before an active input lowers the threshold. An adapter that
   * reads another input uses it to find pauses.
   */
  readonly detectWakeWord?: (window: AudioWindow, signal: AbortSignal, activity: { speech: boolean, durationMs: number }) => Promise<{ sessionId: string, interruptTurns: readonly TurnRef[] } | undefined>
  /** Echo rejection runs after detection. Detectors remain active while the assistant speaks. */
  readonly acceptSpeech?: (window: AudioWindow, signal: AbortSignal) => Promise<boolean>
  readonly enabled?: () => boolean
<<<<<<< HEAD
=======
  /**
   * Names the reason that `enabled` is false, for example a voice message that records.
   *
   * A paused input drops a wake without an input, so the stage needs the reason.
   */
  readonly pauseReason?: () => string | undefined
  readonly onInput?: () => void
>>>>>>> 015a1ba4e (fix(stage-ui): name a paused input that drops a wake word)
  /**
   * Receives the reason when a wake word is consumed without starting an input.
   *
   * A wake is the only signal in a wake word mode, so a silent drop leaves the user with no feedback at all.
   */
  readonly onWakeDropped?: (reason: string) => void
  /**
   * Receives the VAD result of each window that the plugin noted on its input, in window order.
   * The voice host traces speech segments with it, and speaker recognition counts only speech with it.
   * It never changes how the input starts or ends.
   */
  readonly onActivity?: (activity: { inputId: string, range: AudioRange, speech: boolean, durationMs: number }) => void
  /** @default 0.6. A live input uses 30 percent of this score to keep speech active. */
  readonly threshold?: number
  /** @default 300. Shorter speech is discarded when silence ends an input. */
  readonly minSpeechMs?: number
  /**
   * This much silence ends an accepted input. A function is read on each window, so a setting change applies at once.
   *
   * @default 1200
   */
  readonly silenceMs?: number | (() => number)
  /** @default 360. Speech onset retains this much audio before the detected window. */
  readonly preRollMs?: number
}

/**
 * Measures voice activity and lets the speech activity rule decide.
 *
 * The plugin runs the VAD model, the wake word adapter, and the echo gate on each window, then emits one
 * `speech-activity` signal. The rule from `createSpeechActivityRule` begins, seals, and cancels inputs from these
 * signals. The begun input carries its cause, `speech` or `wake-word`, in `SpeechInputAttempt.cause`.
 * It owns no recorder, source, transcription request, or playback nodes.
 */
export function createVoiceActivityPlugin(options: VoiceActivityOptions): VoicePlugin {
  // The observer keeps the pre-roll of setup time. The threshold and the silence limit are read on each window.
  const preRollMs = options.preRollMs ?? 360

  return { name: 'voice-activity', setup(scope) {
    // The rule receives the options object itself. A spread would read the getters of a live setting only once.
    scope.rule(createSpeechActivityRule(options))
    scope.on(inputActivitySignal, activity => options.onActivity?.(activity))

    // NOTICE:
    // SileroVad requires 512 samples at 16 kHz, so each window lasts 32 ms.
    // The constraint is in workers/vad/silero-vad.ts.
    // Remove this fixed size when detectors supply their own window requirements.
    scope.input.observe({ windowMs: 32, hopMs: 32, scheduling: 'ordered', preRollMs }, async (ctx) => {
      const { window } = ctx
      const score = await options.detect(window, ctx.signal)
      const durationMs = (window.range.endFrame - window.range.startFrame) * 1000 / window.sampleRate
      const threshold = options.threshold ?? 0.6
      const wake = await options.detectWakeWord?.(window, ctx.signal, { speech: score >= threshold, durationMs })
      ctx.signal.throwIfAborted()

      // The echo gate can cost a model call, so it runs only for a window that can begin an input.
      const active = ctx.controls.activeInput()
      const canBegin = (wake && wake.sessionId !== active?.sessionId) || (!active && score >= threshold)
      const accepted = canBegin ? (options.acceptSpeech ? await options.acceptSpeech(window, ctx.signal) : true) : undefined
      ctx.signal.throwIfAborted()
      if (wake && active && !canBegin)
        options.onWakeDropped?.('Another input is already active')
      if (wake && accepted === false)
        options.onWakeDropped?.('AIRI is speaking')

<<<<<<< HEAD
      scope.emit(speechActivitySignal, {
        range: window.range,
        durationMs,
        score,
        discontinuity: window.discontinuity,
        ...(accepted === undefined ? {} : { accepted }),
        ...(wake ? { wake } : {}),
      })
=======
      let input = ctx.controls.activeInput()

      // A manual control owns its interval until release. VAD continues inference without ending that input.
      if (input && input.id !== inputId) {
        if (wake)
          options.onWakeDropped?.('Another input is already active')
        return
      }

      if (options.enabled && !options.enabled()) {
        input?.cancel('Automatic speech input is paused')
        inputId = undefined
        if (wake) {
          const reason = options.pauseReason?.()
          options.onWakeDropped?.(reason ? `Automatic input is paused: ${reason}` : 'Automatic input is paused')
        }
        return
      }

      // The session already receives this input, so a further wake changes nothing.
      if (wake && input && wake.sessionId === input.sessionId)
        options.onWakeDropped?.('An input is already open for this session')

      const speech = score >= (input ? (options.threshold ?? 0.6) * 0.3 : options.threshold ?? 0.6)
      if ((wake && wake.sessionId !== input?.sessionId) || (!input && speech)) {
        if (options.acceptSpeech && !await options.acceptSpeech(ctx.window, ctx.signal)) {
          if (wake)
            options.onWakeDropped?.('AIRI is speaking')
          return
        }

        ctx.signal.throwIfAborted()
        const target = wake ?? options.target()
        if (!target) {
          if (wake)
            options.onWakeDropped?.('No character session is available')
          return
        }

        options.beforeBeginInput?.(wake ? 'wake-word' : 'speech')
        const result = ctx.controls.beginInput({ ...target, start: wake
          ? { kind: 'after-silence' }
          : { kind: 'speech-onset', at: { sourceId: ctx.window.range.sourceId, frame: ctx.window.range.startFrame }, preRollMs: options.preRollMs ?? 360 } })
        if (result.status !== 'started') {
          if (wake)
            options.onWakeDropped?.(`The input did not start: ${result.status}`)
          return
        }

        input = result.input
        inputId = input.id
        speechMs = 0
        silenceMs = 0
        options.onInput?.()
      }

      if (!input)
        return

      if (!input.noteActivity({ range: ctx.window.range, speech }))
        return
      options.onActivity?.({ inputId: input.id, range: ctx.window.range, speech, durationMs: duration })

      speechMs += speech ? duration : 0
      silenceMs = speech ? 0 : silenceMs + duration
      const silenceLimit = typeof options.silenceMs === 'function' ? options.silenceMs() : options.silenceMs ?? 1200
      if (silenceMs >= silenceLimit) {
        if (speechMs < (options.minSpeechMs ?? 300))
          input.cancel('Speech segment was too short')
        else
          input.end()

        inputId = undefined
      }
>>>>>>> 015a1ba4e (fix(stage-ui): name a paused input that drops a wake word)
    })

    return undefined
  } }
}
