import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import process from 'node:process'

import { defineInvokeHandler } from '@moeru/eventa'
import { cursorScreenPoint, startLoopGetCursorScreenPoint } from '@proj-airi/electron-eventa'
import { createRendererLoop } from '@proj-airi/electron-vueuse/main'
import { screen } from 'electron'

import { electron } from '../../../shared/eventa'
import { onAppBeforeQuit, onAppWindowAllClosed } from '../../libs/bootkit/lifecycle'
import { createNiriPointerMovedStream } from './niri-pointer'

export function createScreenService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  let isNiriPointerMovedStreamConnected = false
  let lastNiriPointerMovedAt = 0
  const niriPointerMovedStream = createNiriPointerMovedStream({
    socketPath: process.env.NIRI_SOCKET,
    onConnectionChange: (connected) => {
      isNiriPointerMovedStreamConnected = connected
    },
    onPointerMoved: (point) => {
      lastNiriPointerMovedAt = Date.now()
      const cursorPoint = typeof point.windowX === 'number' && typeof point.windowY === 'number'
        ? { x: point.windowX, y: point.windowY, source: 'niri-window' as const }
        : { x: point.x, y: point.y, source: 'niri' as const }
      params.context.emit(cursorScreenPoint, cursorPoint)
    },
  })

  const { start, stop } = createRendererLoop({
    window: params.window,
    run: () => {
      if (isNiriPointerMovedStreamConnected)
        return

      if (Date.now() - lastNiriPointerMovedAt < 250)
        return

      const dipPos = screen.getCursorScreenPoint()
      const cursorPoint = { ...dipPos, source: 'electron' as const }
      params.context.emit(cursorScreenPoint, cursorPoint)
    },
  })

  const stopTracking = () => {
    stop()
    niriPointerMovedStream.stop()
  }

  onAppWindowAllClosed(stopTracking)
  onAppBeforeQuit(stopTracking)
  defineInvokeHandler(params.context, startLoopGetCursorScreenPoint, () => {
    niriPointerMovedStream.start()
    start()
  })

  defineInvokeHandler(params.context, electron.screen.getAllDisplays, () => screen.getAllDisplays())
  defineInvokeHandler(params.context, electron.screen.getPrimaryDisplay, () => screen.getPrimaryDisplay())
  defineInvokeHandler(params.context, electron.screen.dipToScreenPoint, point => point ? screen.dipToScreenPoint(point) : screen.getCursorScreenPoint())
  defineInvokeHandler(params.context, electron.screen.dipToScreenRect, rect => rect ? screen.dipToScreenRect(params.window, rect) : params.window.getBounds())
  defineInvokeHandler(params.context, electron.screen.screenToDipPoint, point => point ? screen.screenToDipPoint(point) : screen.getCursorScreenPoint())
  defineInvokeHandler(params.context, electron.screen.screenToDipRect, rect => rect ? screen.screenToDipRect(params.window, rect) : params.window.getBounds())
  defineInvokeHandler(params.context, electron.screen.getCursorScreenPoint, () => screen.getCursorScreenPoint())
}
