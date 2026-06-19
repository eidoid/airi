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
const sharedSourceWidth = shallowRef<number>()
const sharedSourceHeight = shallowRef<number>()

export function useElectronMouseEventTarget() {
  const context = getElectronEventaContext()

  if (!sharedEventTarget) {
    sharedEventTarget = new EventTarget()

    context.on(cursorScreenPoint, (event) => {
      const body = event.body as ({ source?: ElectronMouseSource, x?: number, y?: number, sourceWidth?: number, sourceHeight?: number } | undefined)
      sharedSource.value = body?.source ?? 'electron'
      sharedSourceWidth.value = typeof body?.sourceWidth === 'number' ? body.sourceWidth : undefined
      sharedSourceHeight.value = typeof body?.sourceHeight === 'number' ? body.sourceHeight : undefined
      const e = new MouseEvent('mousemove', {
        screenX: body?.x,
        screenY: body?.y,
        clientX: body?.x,
        clientY: body?.y,
      })
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
    sourceWidth: sharedSourceWidth,
    sourceHeight: sharedSourceHeight,
  }
}
