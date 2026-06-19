import type { WebSocketBaseEvent, WebSocketEvents } from '@proj-airi/server-shared/types'

import type { ConsumerStickyAssignment } from './server-ws/airi/consumers'

import { describe, expect, it } from 'vitest'

import { setupApp } from './index'
import { heartbeatFrameFrom } from './server-ws/airi/codec'
import { selectConsumerPeerId } from './server-ws/airi/consumers'
import { resolveEventDelivery } from './server-ws/airi/routing'

function createInputTextEvent(
  overrides: Partial<WebSocketBaseEvent<'input:text', WebSocketEvents['input:text']>> = {},
): WebSocketBaseEvent<'input:text', WebSocketEvents['input:text']> {
  return {
    type: 'input:text',
    data: {
      text: 'hello',
      ...overrides.data,
    },
    metadata: overrides.metadata ?? {
      source: {
        kind: 'plugin',
        plugin: { id: 'discord' },
        id: 'discord-instance',
      },
      event: {
        id: 'event-1',
      },
    },
    route: overrides.route,
  }
}

describe('resolveEventDelivery', () => {
  it('uses protocol event metadata defaults for input:text', () => {
    const delivery = resolveEventDelivery(createInputTextEvent())

    expect(delivery).toEqual({
      mode: 'consumer-group',
      group: 'chat-ingestion',
      selection: 'first',
    })
  })

  it('allows route delivery to override protocol defaults', () => {
    const delivery = resolveEventDelivery(createInputTextEvent({
      route: {
        delivery: {
          required: true,
          selection: 'sticky',
          stickyKey: 'discord-dm-user-1',
        },
      },
    }))

    expect(delivery).toEqual({
      mode: 'consumer-group',
      group: 'chat-ingestion',
      required: true,
      selection: 'sticky',
      stickyKey: 'discord-dm-user-1',
    })
  })

  it('returns explicit route delivery for events without protocol defaults', () => {
    const delivery = resolveEventDelivery({
      type: 'spark:notify',
      data: {
        id: 'spark-1',
        eventId: 'spark-notify-1',
        kind: 'ping',
        urgency: 'soon',
        headline: 'hello',
        destinations: ['module:character'],
      },
      metadata: {
        source: {
          kind: 'plugin',
          plugin: { id: 'stage-web' },
          id: 'stage-web-instance',
        },
        event: {
          id: 'event-2',
        },
      },
      route: {
        delivery: {
          mode: 'consumer',
          required: true,
        },
      },
    })

    expect(delivery).toEqual({
      mode: 'consumer',
      required: true,
    })
  })
})

describe('selectConsumerPeerId', () => {
  it('selects the highest-priority healthy consumer in the delivery group', () => {
    const selectedPeerId = selectConsumerPeerId({
      eventType: 'input:text',
      fromPeerId: 'discord-instance',
      delivery: {
        mode: 'consumer-group',
        group: 'chat-ingestion',
        selection: 'priority',
      },
      candidates: [
        {
          peerId: 'stage-window-a',
          priority: 10,
          registeredAt: 2,
          authenticated: true,
          healthy: true,
        },
        {
          peerId: 'stage-window-b',
          priority: 20,
          registeredAt: 3,
          authenticated: true,
          healthy: true,
        },
        {
          peerId: 'stage-window-c',
          priority: 30,
          registeredAt: 1,
          authenticated: true,
          healthy: false,
        },
      ],
    })

    expect(selectedPeerId).toBe('stage-window-b')
  })

  it('keeps sticky delivery on the same consumer when available', () => {
    const stickyAssignments = new Map<string, ConsumerStickyAssignment>()

    const firstSelectedPeerId = selectConsumerPeerId({
      eventType: 'input:text',
      fromPeerId: 'discord-instance',
      delivery: {
        mode: 'consumer-group',
        group: 'chat-ingestion',
        selection: 'sticky',
        stickyKey: 'discord-dm-user-1',
      },
      candidates: [
        {
          peerId: 'stage-window-a',
          priority: 10,
          registeredAt: 1,
          authenticated: true,
          healthy: true,
        },
        {
          peerId: 'stage-window-b',
          priority: 10,
          registeredAt: 2,
          authenticated: true,
          healthy: true,
        },
      ],
      stickyAssignments,
    })

    const secondSelectedPeerId = selectConsumerPeerId({
      eventType: 'input:text',
      fromPeerId: 'discord-instance',
      delivery: {
        mode: 'consumer-group',
        group: 'chat-ingestion',
        selection: 'sticky',
        stickyKey: 'discord-dm-user-1',
      },
      candidates: [
        {
          peerId: 'stage-window-a',
          priority: 10,
          registeredAt: 1,
          authenticated: true,
          healthy: true,
        },
        {
          peerId: 'stage-window-b',
          priority: 10,
          registeredAt: 2,
          authenticated: true,
          healthy: true,
        },
      ],
      stickyAssignments,
    })

    expect(firstSelectedPeerId).toBe('stage-window-a')
    expect(secondSelectedPeerId).toBe('stage-window-a')
  })
})

describe('setupApp action route', () => {
  it('returns 404 when actions are not registered', async () => {
    const { app, dispose } = setupApp()
    const response = await app.fetch(new Request('http://127.0.0.1/api/actions/toggle-hearing-autosend', {
      method: 'POST',
    }))
    dispose()

    expect(response.status).toBe(404)
  })

  it('rejects action requests with an invalid bearer token', async () => {
    const { app, dispose } = setupApp({
      auth: { token: 'secret' },
      actions: {
        invoke: async () => ({ ok: true }),
      },
    })
    const response = await app.fetch(new Request('http://127.0.0.1/api/actions/toggle-hearing-autosend', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong' },
    }))
    dispose()

    expect(response.status).toBe(401)
  })

  it('invokes registered actions with valid bearer auth', async () => {
    const { app, dispose } = setupApp({
      auth: { token: 'secret' },
      actions: {
        invoke: async action => ({ action, hearingEnabled: true, autoSendEnabled: true }),
      },
    })
    const response = await app.fetch(new Request('http://127.0.0.1/api/actions/toggle-hearing-autosend', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
    }))
    const body = await response.json() as { ok: boolean, result: { hearingEnabled: boolean, autoSendEnabled: boolean } }
    dispose()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.result.hearingEnabled).toBe(true)
    expect(body.result.autoSendEnabled).toBe(true)
  })
})

describe('heartbeatFrameFrom', () => {
  it('recognizes raw websocket control frame text without treating it as protocol JSON', () => {
    expect(heartbeatFrameFrom('ping')).toBe('ping')
    expect(heartbeatFrameFrom('pong')).toBe('pong')
  })

  it('ignores non-control payloads', () => {
    expect(heartbeatFrameFrom('')).toBeUndefined()
    expect(heartbeatFrameFrom('🩵')).toBeUndefined()
    expect(heartbeatFrameFrom('{"type":"transport:connection:heartbeat"}')).toBeUndefined()
  })
})
