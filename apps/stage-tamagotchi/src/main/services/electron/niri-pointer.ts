import type { Socket } from 'node:net'
import type { Interface } from 'node:readline'

import { createConnection } from 'node:net'
import { createInterface } from 'node:readline'

export interface NiriPointerMovedPoint {
  x: number
  y: number
  windowX?: number
  windowY?: number
}

export interface NiriPointerMovedStream {
  start: () => void
  stop: () => void
}

interface NiriWindow {
  id: number
  title?: string | null
  app_id?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function isAiriWindow(window: NiriWindow | undefined) {
  const title = window?.title?.trim().toLowerCase()
  const appId = window?.app_id?.trim().toLowerCase()
  return title === 'airi' || appId === 'ai.moeru.airi' || !!appId?.includes('airi')
}

function updateNiriWindowState(event: unknown, windows: Map<number, NiriWindow>) {
  if (!isRecord(event))
    return

  if ('WindowsChanged' in event) {
    const body = event.WindowsChanged
    if (!isRecord(body) || !Array.isArray(body.windows))
      return

    windows.clear()
    for (const window of body.windows) {
      if (!isRecord(window) || typeof window.id !== 'number')
        continue
      windows.set(window.id, {
        id: window.id,
        title: typeof window.title === 'string' ? window.title : undefined,
        app_id: typeof window.app_id === 'string' ? window.app_id : undefined,
      })
    }
    return
  }

  if ('WindowOpenedOrChanged' in event) {
    const body = event.WindowOpenedOrChanged
    if (!isRecord(body) || !isRecord(body.window) || typeof body.window.id !== 'number')
      return

    windows.set(body.window.id, {
      id: body.window.id,
      title: typeof body.window.title === 'string' ? body.window.title : undefined,
      app_id: typeof body.window.app_id === 'string' ? body.window.app_id : undefined,
    })
    return
  }

  if ('WindowClosed' in event) {
    const body = event.WindowClosed
    if (isRecord(body) && typeof body.id === 'number')
      windows.delete(body.id)
  }
}

function parseNiriPointerMovedEvent(line: string, windows: Map<number, NiriWindow>): NiriPointerMovedPoint | undefined {
  const event = JSON.parse(line) as unknown
  updateNiriWindowState(event, windows)

  if (!isRecord(event) || !('PointerMoved' in event))
    return

  const body = event.PointerMoved
  if (!isRecord(body))
    return

  const { x, y } = body
  if (typeof x !== 'number' || typeof y !== 'number')
    return

  if (Array.isArray(body.windows)) {
    for (const windowPoint of body.windows) {
      if (!isRecord(windowPoint) || typeof windowPoint.id !== 'number')
        continue
      if (!isAiriWindow(windows.get(windowPoint.id)))
        continue
      if (typeof windowPoint.x !== 'number' || typeof windowPoint.y !== 'number')
        continue

      return { x, y, windowX: windowPoint.x, windowY: windowPoint.y }
    }
  }

  return { x, y }
}

export function createNiriPointerMovedStream(params: {
  socketPath?: string
  onPointerMoved: (point: NiriPointerMovedPoint) => void
  onConnectionChange?: (connected: boolean) => void
}): NiriPointerMovedStream {
  const socketPath = params.socketPath?.trim()
  let socket: Socket | undefined
  let lines: Interface | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = true
  const windows = new Map<number, NiriWindow>()

  function cleanupConnection() {
    lines?.close()
    lines = undefined
    socket?.destroy()
    socket = undefined
    windows.clear()
    params.onConnectionChange?.(false)
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer || !socketPath)
      return

    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      connect()
    }, 1000)
  }

  function connect() {
    if (stopped || !socketPath || socket)
      return

    socket = createConnection(socketPath)
    socket.setEncoding('utf8')
    socket.once('connect', () => {
      params.onConnectionChange?.(true)
      socket?.write('"EventStream"\n')
    })
    socket.once('close', () => {
      cleanupConnection()
      scheduleReconnect()
    })
    socket.once('error', () => {
      cleanupConnection()
      scheduleReconnect()
    })

    lines = createInterface({ input: socket })
    lines.on('line', (line) => {
      try {
        const point = parseNiriPointerMovedEvent(line, windows)
        if (point)
          params.onPointerMoved(point)
      }
      catch {
        // Ignore malformed lines so one unexpected event cannot stop tracking.
      }
    })
  }

  return {
    start: () => {
      if (!stopped)
        return

      stopped = false
      connect()
    },
    stop: () => {
      stopped = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      cleanupConnection()
    },
  }
}
