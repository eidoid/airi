import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import HearingStatus from '../../components/scenarios/status/hearing-status.vue'

import { getSpeechBusContext, voiceSnapshotChanged } from '../../services/speech/bus'

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  localStorage.clear()
})

it('shows final transcription work and reports a provider failure through the host snapshot', async () => {
  const pinia = createPinia()
  cleanups.push(() => disposePinia(pinia))
  const view = render(HearingStatus, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })] } })
  const context = getSpeechBusContext()
  context.emit(voiceSnapshotChanged, { connected: true, drafts: [], input: { requestId: 'recording', sessionId: 'alice', trigger: 'wake-word', phase: 'capturing', text: '', segments: [] } })
  const wakeCapsule = view.getByRole('button', { name: 'Listening' })
  await expect.poll(() => wakeCapsule.element().closest('[data-status]')?.getAttribute('data-status')).toBe('wake')
  expect(wakeCapsule.element().querySelector('.basic-button-content > span')?.classList.contains('bg-emerald-100/85')).toBe(true)

  context.emit(voiceSnapshotChanged, { connected: true, drafts: [], input: { requestId: 'recording', sessionId: 'alice', trigger: 'wake-word', phase: 'finalizing', text: 'recognized words', segments: [{ id: 'speech-0', text: 'recognized words', final: true }] } })
  await expect.element(view.getByRole('status')).toHaveTextContent('Transcribing')
  const transcribingCapsule = view.getByRole('button', { name: 'Transcribing' })
  await expect.poll(() => transcribingCapsule.element().closest('[data-status]')?.getAttribute('data-status')).toBe('transcribing')
  expect(transcribingCapsule.element().querySelector('.basic-button-content > span')?.classList.contains('bg-violet-100/85')).toBe(true)

  context.emit(voiceSnapshotChanged, { connected: true, drafts: [], error: 'Provider timed out', input: { requestId: 'recording', sessionId: 'alice', trigger: 'wake-word', phase: 'settled', text: 'recognized words', segments: [{ id: 'speech-0', text: 'recognized words', final: true }] } })
  await expect.element(view.getByRole('status')).toHaveTextContent('Could not transcribe audio')
})
