import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsDeveloper = defineStore('settings-developer', () => {
  const inspectUpdaterDiagnostics = useLocalStorageManualReset<boolean>('settings/developer/inspect-updater-diagnostics', false)
  // The stage window samples its frame rate, heap, and voice state while this is on, and keeps the last 20 minutes.
  const stageDiagnostics = useLocalStorageManualReset<boolean>('settings/developer/stage-diagnostics', false)

  function resetState() {
    inspectUpdaterDiagnostics.reset()
    stageDiagnostics.reset()
  }

  return {
    inspectUpdaterDiagnostics,
    stageDiagnostics,
    resetState,
  }
})
