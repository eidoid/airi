import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsDeveloper = defineStore('settings-developer', () => {
  const inspectUpdaterDiagnostics = useLocalStorageManualReset<boolean>('settings/developer/inspect-updater-diagnostics', false)
  // Chat tool calls show their arguments and results as a JSON tree, not as the formatted fields, and cards in replies
  // offer their program. Owners without it see only the cards.
  const showToolPayloadsAsJson = useLocalStorageManualReset<boolean>('settings/developer/show-tool-payloads-as-json', false)
  // The stage window samples its frame rate, heap, and voice state while this is on, and keeps the last 20 minutes.
  const stageDiagnostics = useLocalStorageManualReset<boolean>('settings/developer/stage-diagnostics', false)

  function resetState() {
    inspectUpdaterDiagnostics.reset()
    showToolPayloadsAsJson.reset()
    stageDiagnostics.reset()
  }

  return {
    inspectUpdaterDiagnostics,
    showToolPayloadsAsJson,
    stageDiagnostics,
    resetState,
  }
})
