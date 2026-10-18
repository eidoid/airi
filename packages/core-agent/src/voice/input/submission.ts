import type { PcmBlock } from '@proj-airi/pipelines-audio'

import type { SpeakerEvidence, SpeechSnapshot } from './snapshot'
import type { TranscriptionEvent, TranscriptPatch, TranscriptSnapshot } from './transcript'

/**
 * A provider request consumes PCM and produces transcription concurrently.
 *
 * The PCM stream closes when the input ends. Adapters that need a file or a MediaStream convert it themselves.
 */
export interface StreamingTranscriber {
  transcribe: (request: { audio: ReadableStream<PcmBlock>, signal: AbortSignal }) => ReadableStream<TranscriptionEvent>
}

/** Submission identity is stable across transport retries. The adapter owns persistence. */
export interface SpeechSubmission {
  readonly submissionId: string
  readonly sessionId: string
  readonly text: string
  readonly transcript: {
    readonly raw: TranscriptSnapshot
    readonly corrected: TranscriptSnapshot
    readonly history: readonly TranscriptSnapshot[]
    readonly patches: readonly TranscriptPatch[]
  }
  readonly context: SpeechSnapshot['context']
  readonly speakers?: SpeakerEvidence
}

/** External operations that one speech input uses. The controller supplies them from its options. */
export interface SpeechInputPorts {
  /**
   * The longest time that admission waits for playback silence, and then for the first audio block.
   *
   * A microphone that delivers nothing would otherwise hold the input as `pending` forever, and every later
   * automatic input yields to it. Permission prompts stay inside this budget, so the value must allow a slow user.
   *
   * @default 20000
   */
  readonly admissionTimeoutMs?: number
  readonly transcriber?: (sessionId: string) => StreamingTranscriber
  readonly submit?: (submission: SpeechSubmission, signal: AbortSignal) => Promise<{ status: 'committed', messageId: string } | { status: 'drafted', draftId: string }>
  readonly conversationContext?: (sessionId: string) => { readonly revision: number, readonly messages: readonly { role: string, text: string }[] }
}
