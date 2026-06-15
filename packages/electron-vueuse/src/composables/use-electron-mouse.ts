import type { UseMouseOptions } from '@vueuse/core'

import { defineInvoke } from '@moeru/eventa'
import { cursorScreenPoint, startLoopGetCursorScreenPoint } from '@proj-airi/electron-eventa'
import { useMouse } from '@vueuse/core'
import { ref, shallowRef } from 'vue'

import { getElectronEventaContext } from './use-electron-eventa-context'

export type ElectronMouseSource = 'electron' | 'niri' | 'niri-window'

let sharedEventTarget: EventTarget | undefined
let startedTracking = false
const sharedSource = shallowRef<ElectronMouseSource>('electron')

export function useElectronMouseEventTarget() {
  const context = getElectronEventaContext()

  if (!sharedEventTarget) {
    sharedEventTarget = new EventTarget()

    context.on(cursorScreenPoint, (event) => {
      const body = event.body as ({ source?: ElectronMouseSource, x?: number, y?: number } | undefined)
      sharedSource.value = body?.source ?? 'electron'
      const e = new MouseEvent('mousemove', { screenX: body?.x, screenY: body?.y })
      sharedEventTarget?.dispatchEvent(e)
    })
  }

  if (!startedTracking) {
    startedTracking = true
    void defineInvoke(context, startLoopGetCursorScreenPoint)()
  }

  return ref(sharedEventTarget)
}

export function useElectronMouse(options?: UseMouseOptions) {
  const eventTarget = useElectronMouseEventTarget()
  return {
    ...useMouse({ ...options, target: eventTarget, type: 'screen' }),
    source: sharedSource,
  }
}
