import type { ExpressionLlmMode } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import type {
  ModelSettingsRuntimeSnapshot,
} from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'

import type { ModelSettingsRuntimeChannelEvent } from '../../shared/model-settings-runtime'

import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import {
  createEmptyModelSettingsRuntimeSnapshot,
} from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'
import { useBroadcastChannel } from '@vueuse/core'
import { onMounted, onUnmounted, ref, watch } from 'vue'

import {
  modelSettingsRuntimeSnapshotChannelName,
} from '../../shared/model-settings-runtime'

export function useModelSettingsRuntimeSnapshot() {
  const runtimeSnapshot = ref<ModelSettingsRuntimeSnapshot>(createEmptyModelSettingsRuntimeSnapshot())
  const expressionStore = useExpressionStore()
  const { data, post } = useBroadcastChannel<ModelSettingsRuntimeChannelEvent, ModelSettingsRuntimeChannelEvent>({
    name: modelSettingsRuntimeSnapshotChannelName,
  })

  const requestCurrent = () => {
    post({ type: 'request-current' })
  }

  const syncFromOwner = () => {
    requestCurrent()
  }
  const syncFromOwnerWhenVisible = () => {
    if (document.visibilityState === 'visible')
      requestCurrent()
  }
  const expressionOwnerId = (ownerInstanceId: string) => `model-settings-runtime:${ownerInstanceId}`
  let lastMirroredLlmSettingsKey = ''
  let lastMirroredPreviewKey = ''

  function llmSettingsKey(
    ownerInstanceId: string,
    mode: ExpressionLlmMode,
    exposed: Array<{ name: string, exposed: boolean }>,
  ): string {
    return JSON.stringify({
      ownerInstanceId,
      mode,
      exposed: [...exposed].sort((a, b) => a.name.localeCompare(b.name)),
    })
  }

  function currentLlmSettingsKey(): string {
    return llmSettingsKey(
      runtimeSnapshot.value.ownerInstanceId,
      expressionStore.llmMode,
      Array.from(expressionStore.llmExposed.entries()).map(([name, exposed]) => ({ name, exposed })),
    )
  }

  function previewKey(ownerInstanceId: string, activeGroups: string[]): string {
    return JSON.stringify({
      ownerInstanceId,
      activeGroups: [...activeGroups].sort(),
    })
  }

  function currentPreviewKey(): string {
    return previewKey(runtimeSnapshot.value.ownerInstanceId, Array.from(expressionStore.activeExpressionGroups))
  }

  function syncExpressionsFromOwner(event: ModelSettingsRuntimeChannelEvent) {
    if (event.type === 'owner-gone') {
      expressionStore.dispose(expressionOwnerId(event.ownerInstanceId))
      return
    }

    if (event.type !== 'snapshot')
      return

    const ownerId = expressionOwnerId(event.snapshot.ownerInstanceId)
    if (!event.live2dExpressions) {
      expressionStore.dispose(ownerId)
      return
    }

    expressionStore.registerExpressions(
      event.live2dExpressions.modelId,
      event.live2dExpressions.groups,
      event.live2dExpressions.entries,
      ownerId,
    )
    expressionStore.setLlmExposure(
      event.live2dExpressions.llmMode,
      event.live2dExpressions.llmExposed.map(({ name, exposed }) => [name, exposed] as const),
    )
    expressionStore.setActiveExpressionGroups(event.live2dExpressions.activeGroups)
    lastMirroredLlmSettingsKey = llmSettingsKey(
      event.snapshot.ownerInstanceId,
      event.live2dExpressions.llmMode,
      event.live2dExpressions.llmExposed,
    )
    lastMirroredPreviewKey = previewKey(
      event.snapshot.ownerInstanceId,
      event.live2dExpressions.activeGroups,
    )
  }

  onMounted(() => {
    requestCurrent()
    window.addEventListener('focus', syncFromOwner)
    document.addEventListener('visibilitychange', syncFromOwnerWhenVisible)
  })

  onUnmounted(() => {
    window.removeEventListener('focus', syncFromOwner)
    document.removeEventListener('visibilitychange', syncFromOwnerWhenVisible)
  })

  watch(data, (event) => {
    if (!event)
      return

    if (event.type === 'snapshot') {
      runtimeSnapshot.value = event.snapshot
      syncExpressionsFromOwner(event)
      return
    }

    if (event.type === 'owner-gone') {
      syncExpressionsFromOwner(event)
      if (runtimeSnapshot.value.ownerInstanceId !== event.ownerInstanceId)
        return

      runtimeSnapshot.value = createEmptyModelSettingsRuntimeSnapshot()
    }
  })

  watch(
    () => ({
      activeGroups: Array.from(expressionStore.activeExpressionGroups),
      exposed: Array.from(expressionStore.llmExposed.entries()),
      groups: Array.from(expressionStore.expressionGroups.keys()),
      mode: expressionStore.llmMode,
      ownerInstanceId: runtimeSnapshot.value.ownerInstanceId,
    }),
    () => {
      if (!runtimeSnapshot.value.ownerInstanceId || expressionStore.expressionGroups.size === 0)
        return

      const key = currentLlmSettingsKey()
      if (key === lastMirroredLlmSettingsKey)
        return

      lastMirroredLlmSettingsKey = key
      post({
        type: 'live2d-expression-llm-settings',
        ownerInstanceId: runtimeSnapshot.value.ownerInstanceId,
        llmMode: expressionStore.llmMode,
        llmExposed: Array.from(expressionStore.llmExposed.entries()).map(([name, exposed]) => ({
          name,
          exposed,
        })),
      })
    },
    { deep: true },
  )

  watch(
    () => ({
      activeGroups: Array.from(expressionStore.activeExpressionGroups),
      groups: Array.from(expressionStore.expressionGroups.keys()),
      ownerInstanceId: runtimeSnapshot.value.ownerInstanceId,
    }),
    () => {
      if (!runtimeSnapshot.value.ownerInstanceId || expressionStore.expressionGroups.size === 0)
        return

      const key = currentPreviewKey()
      if (key === lastMirroredPreviewKey)
        return

      lastMirroredPreviewKey = key
      post({
        type: 'live2d-expression-preview',
        ownerInstanceId: runtimeSnapshot.value.ownerInstanceId,
        name: Array.from(expressionStore.activeExpressionGroups)[0] ?? null,
      })
    },
    { deep: true },
  )

  return {
    runtimeSnapshot,
    requestCurrent,
  }
}
