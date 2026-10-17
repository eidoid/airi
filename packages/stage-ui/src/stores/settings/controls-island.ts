import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsControlsIsland = defineStore('settings-controls-island', () => {
  const allowVisibleOnAllWorkspaces = useLocalStorageManualReset<boolean>('settings/allow-visible-on-all-workspaces', true)
  const alwaysOnTop = useLocalStorageManualReset<boolean>('settings/always-on-top', true)
  const controlsIslandIconSize = useLocalStorageManualReset<'auto' | 'large' | 'small'>('settings/controls-island/icon-size', 'auto')
  /** Hides the Island when the pointer leaves it. */
  const autoHide = useLocalStorageManualReset<boolean>('settings/controls-island/auto-hide', true)

  function resetState() {
    allowVisibleOnAllWorkspaces.reset()
    alwaysOnTop.reset()
    controlsIslandIconSize.reset()
    autoHide.reset()
  }

  return {
    allowVisibleOnAllWorkspaces,
    alwaysOnTop,
    controlsIslandIconSize,
    autoHide,
    resetState,
  }
})
