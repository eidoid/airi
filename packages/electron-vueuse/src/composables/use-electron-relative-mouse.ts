import type { UseMouseOptions } from '@vueuse/core'

import { defaultWindow, useEventListener, useMouse } from '@vueuse/core'
import { computed, shallowRef } from 'vue'

import { useElectronMouse } from './use-electron-mouse'
import { useElectronWindowBounds } from './use-electron-window-bounds'

export function useElectronRelativeMouse(options?: UseMouseOptions) {
  const mouse = useElectronMouse(options)
  const windowMouse = useMouse({ ...options, type: 'client' })
  const { x: windowX, y: windowY } = useElectronWindowBounds()

  const hasWindowPointer = shallowRef(false)
  const isPointerInsideWindow = shallowRef(true)

  // NOTICE:
  // Prefer renderer-local pointer coordinates once the floating window has received pointer
  // input. Native Wayland compositors can withhold or freeze the global cursor coordinates
  // that Electron reports through `screen.getCursorScreenPoint()`, while DOM pointer events
  // inside the renderer keep updating normally.
  // Source/context: apps/stage-tamagotchi/src/main/services/electron/screen.ts polls
  // `screen.getCursorScreenPoint()` for the Electron mouse stream.
  // Removal condition: Electron on native Wayland exposes reliable global cursor tracking
  // for transparent floating windows.
  const markWindowPointerAvailable = () => {
    hasWindowPointer.value = true
    isPointerInsideWindow.value = true
  }

  const markPointerOutsideWindow = () => {
    hasWindowPointer.value = true
    isPointerInsideWindow.value = false
  }

  useEventListener(defaultWindow, 'pointerenter', markWindowPointerAvailable, { passive: true })
  useEventListener(defaultWindow, 'pointermove', markWindowPointerAvailable, { passive: true })
  useEventListener(defaultWindow, 'touchmove', markWindowPointerAvailable, { passive: true })
  useEventListener(defaultWindow?.document, 'mouseleave', markPointerOutsideWindow, { passive: true })

  // Transform screen coordinates to window-relative coordinates, using the renderer-local
  // pointer position while the pointer is inside the window.
  const x = computed(() => {
    if (hasWindowPointer.value && isPointerInsideWindow.value)
      return windowMouse.x.value

    return mouse.x.value - windowX.value
  })
  const y = computed(() => {
    if (hasWindowPointer.value && isPointerInsideWindow.value)
      return windowMouse.y.value

    return mouse.y.value - windowY.value
  })

  return {
    ...mouse,
    x,
    y,
    hasWindowPointer,
    isPointerInsideWindow,
  }
}
