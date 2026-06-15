import path from 'node:path'

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { describe, expect, it, vi } from 'vitest'

import { parseAiriCliArguments, sendAiriAction } from './index'

describe('parseAiriCliArguments', () => {
  it('parses the hearing autosend action with explicit connection options', () => {
    const request = parseAiriCliArguments([
      'msg',
      'action',
      'toggle-hearing-autosend',
      '--host',
      'localhost',
      '--port',
      '7000',
      '--token',
      'secret',
    ])

    expect(request.command).toBe('msg')
    expect(request.kind).toBe('action')
    expect(request.action).toBe('toggle-hearing-autosend')
    expect(request.host).toBe('localhost')
    expect(request.port).toBe(7000)
    expect(request.token).toBe('secret')
  })

  it('reads the server-channel auth token from the user data config', () => {
    const userDataDir = mkdtempSync(path.join(tmpdir(), 'airi-cli-'))
    writeFileSync(path.join(userDataDir, 'server-channel-config.json'), JSON.stringify({ authToken: 'stored-token' }))

    const request = parseAiriCliArguments([
      'msg',
      'action',
      'toggle-hearing-autosend',
      '--user-data-dir',
      userDataDir,
    ], {})

    expect(request.token).toBe('stored-token')
  })

  it('reads the legacy nested server-channel auth token path', () => {
    const userDataDir = mkdtempSync(path.join(tmpdir(), 'airi-cli-'))
    const configDir = path.join(userDataDir, 'server-channel')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ authToken: 'legacy-token' }))

    const request = parseAiriCliArguments([
      'msg',
      'action',
      'toggle-hearing-autosend',
      '--user-data-dir',
      userDataDir,
    ], {})

    expect(request.token).toBe('legacy-token')
  })

  it('rejects unsupported action names', () => {
    expect(() => parseAiriCliArguments(['msg', 'action', 'unknown']))
      .toThrow('Usage: airi msg action toggle-hearing-autosend')
  })
})

describe('sendAiriAction', () => {
  it('posts the action request to the local AIRI endpoint with bearer auth', async () => {
    const fetchImpl = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => new Response(JSON.stringify({
      ok: true,
      action: 'toggle-hearing-autosend',
      result: { hearingEnabled: true, autoSendEnabled: true },
    })))

    const result = await sendAiriAction({
      command: 'msg',
      kind: 'action',
      action: 'toggle-hearing-autosend',
      host: '127.0.0.1',
      port: 6121,
      token: 'secret',
    }, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:6121/api/actions/toggle-hearing-autosend', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'toggle-hearing-autosend' }),
    })
    expect(result.ok).toBe(true)
    expect(result.action).toBe('toggle-hearing-autosend')
  })
})
