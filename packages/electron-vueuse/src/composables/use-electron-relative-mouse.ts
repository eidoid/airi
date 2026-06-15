import type { UseMouseOptions } from '@vueuse/core'

import { defaultWindow, useEventListener, useMouse } from '@vueuse/core'
import { computed, shallowRef, watch } from 'vue'

import { useElectronMouse } from './use-electron-mouse'
import { useElectronWindowBounds } from './use-electron-window-bounds'

export function useElectronRelativeMouse(options?: UseMouseOptions) {
  const mouse = useElectronMouse(options)
  const windowMouse = useMouse({
    initialValue: options?.initialValue,
    resetOnTouchEnds: options?.resetOnTouchEnds,
    touch: options?.touch,
    type: 'client',
  })
  const { x: windowX, y: windowY } = useElectronWindowBounds()
  const hasWindowPointer = shallowRef(false)
  const isPointerInsideWindow = shallowRef(true)
  const calibratedNiriWindowX = shallowRef<number>()
  const calibratedNiriWindowY = shallowRef<number>()

  // NOTICE:
  // Use renderer-local pointer coordinates once the window receives pointer input.
  // Root cause: native Wayland compositors can withhold or freeze global cursor
  // coordinates exposed through Electron `screen.getCursorScreenPoint()`, while
  // DOM pointer events inside the renderer still update normally.
  // Source/context: apps/stage-tamagotchi/src/main/services/electron/screen.ts
  // polls `screen.getCursorScreenPoint()` for the Electron mouse stream.
  // Removal condition: Electron/native Wayland exposes reliable per-window cursor
  // tracking for transparent floating windows.
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

  watch([mouse.x, mouse.y, mouse.source, windowMouse.x, windowMouse.y, isPointerInsideWindow], () => {
    if (!isPointerInsideWindow.value || mouse.source.value !== 'niri')
      return

    calibratedNiriWindowX.value = mouse.x.value - windowMouse.x.value
    calibratedNiriWindowY.value = mouse.y.value - windowMouse.y.value
  })

  // Transform screen coordinates to window-relative coordinates when the Electron
  // screen stream is the only available source.
  const x = computed(() => {
    if (mouse.source.value === 'niri-window')
      return mouse.x.value

    if (hasWindowPointer.value && isPointerInsideWindow.value)
      return windowMouse.x.value

    if (mouse.source.value === 'niri' && calibratedNiriWindowX.value !== undefined)
      return mouse.x.value - calibratedNiriWindowX.value

    return mouse.x.value - windowX.value
  })
  const y = computed(() => {
    if (mouse.source.value === 'niri-window')
      return mouse.y.value

    if (hasWindowPointer.value && isPointerInsideWindow.value)
      return windowMouse.y.value

    if (mouse.source.value === 'niri' && calibratedNiriWindowY.value !== undefined)
      return mouse.y.value - calibratedNiriWindowY.value

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
