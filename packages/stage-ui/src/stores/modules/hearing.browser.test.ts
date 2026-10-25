import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import { useHearingStore } from './hearing'

const contexts: Array<{ app: ReturnType<typeof createApp>, pinia: ReturnType<typeof createPinia>, runtime: SyncedPiniaRuntime }> = []

function createSyncedContext<T>(namespace: string, leadership: LeadershipMode, useStore: () => T) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ callTimeout: 1000, leadership, namespace })
  pinia.use(runtime.plugin)
  setActivePinia(pinia)
  let store!: T
  const app = createApp({ setup() {
    store = useStore()
    return () => null
  } })
  app.use(createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false })).use(pinia)
  app.mount(document.createElement('div'))
  contexts.push({ app, pinia, runtime })
  return { pinia, runtime, store }
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.app.unmount()
    context.runtime.dispose()
    disposePinia(context.pinia)
  }
  localStorage.clear()
})

it('applies the end-of-speech wait from the leader without publishing it again', async () => {
  const namespace = `hearing:${crypto.randomUUID()}`
  const leaderContext = createSyncedContext(namespace, 'leader-only', useHearingStore)
  await vi.waitFor(() => expect(leaderContext.runtime.isLeader()).toBe(true))
  const leader = leaderContext.store

  const followerContext = createSyncedContext(namespace, 'follower-only', useHearingStore)
  const follower = followerContext.store
  await vi.waitFor(() => expect(followerContext.runtime.getLeaderId()).toBe(leaderContext.runtime.participantId))

  let leaderMutations = 0
  let followerMutations = 0
  leader.$subscribe(() => leaderMutations++, { flush: 'sync' })
  follower.$subscribe(() => followerMutations++, { flush: 'sync' })

  expect(leader.endJudgeWaitMs).toBe(3000)
  leader.endJudgeWaitMs = 1500
  await vi.waitFor(() => expect(follower.endJudgeWaitMs).toBe(1500))
  await new Promise(resolve => setTimeout(resolve, 50))

  expect(leaderMutations).toBe(1)
  expect(followerMutations).toBe(1)
  expect(localStorage.getItem('settings/hearing/end-judge-wait')).toBe('1500')
})
