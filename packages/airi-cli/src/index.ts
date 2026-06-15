import path from 'node:path'
import process from 'node:process'

import { existsSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'

export type AiriCliCommand = 'msg'
export type AiriCliMessageKind = 'action'
export type AiriCliActionName = 'toggle-hearing-autosend'

export interface AiriCliActionRequest {
  /** Top-level AIRI CLI namespace. */
  command: AiriCliCommand
  /** Message kind sent to the running AIRI instance. */
  kind: AiriCliMessageKind
  /** Runtime action to execute in the running AIRI instance. */
  action: AiriCliActionName
  /** Host where the local AIRI server-channel listens. */
  host: string
  /** Port where the local AIRI server-channel listens. */
  port: number
  /** Optional bearer token used by the local AIRI server-channel. */
  token?: string
}

export interface AiriCliParseEnvironment {
  AIRI_SERVER_HOST?: string
  AIRI_SERVER_PORT?: string
  AIRI_SERVER_AUTH_TOKEN?: string
  AIRI_USER_DATA_PATH?: string
  APP_USER_DATA_PATH?: string
  SERVER_CHANNEL_PORT?: string
  XDG_CONFIG_HOME?: string
  APPDATA?: string
  HOME?: string
}

export interface AiriCliSendActionResult {
  ok: boolean
  action: AiriCliActionName
  result?: unknown
  error?: string
}

export const AIRI_CLI_USAGE = 'Usage: airi msg action toggle-hearing-autosend [--host <host>] [--port <port>] [--token <token>] [--user-data-dir <dir>]'

/**
 * Parses AIRI CLI arguments into one local instance action request.
 *
 * Use when:
 * - Implementing the `airi msg action ...` command family
 * - Tests need deterministic argument parsing without touching process globals
 *
 * Expects:
 * - `argv` excludes the executable and script path
 * - Only supported action names are accepted
 *
 * Returns:
 * - A normalized action request with host, port, and optional token resolved
 */
export function parseAiriCliArguments(argv: string[], env: AiriCliParseEnvironment = process.env): AiriCliActionRequest {
  if (argv.includes('--help') || argv.includes('-h')) {
    throw new Error(AIRI_CLI_USAGE)
  }

  const [command, kind, action, ...rest] = argv
  if (command !== 'msg' || kind !== 'action' || action !== 'toggle-hearing-autosend') {
    throw new Error(AIRI_CLI_USAGE)
  }

  const options = parseOptions(rest)
  const port = parsePort(options.port ?? env.AIRI_SERVER_PORT ?? env.SERVER_CHANNEL_PORT ?? '6121')
  const host = options.host ?? env.AIRI_SERVER_HOST ?? '127.0.0.1'
  const token = options.token ?? env.AIRI_SERVER_AUTH_TOKEN ?? readServerChannelAuthToken(options.userDataDir, env)

  return {
    command,
    kind,
    action,
    host,
    port,
    token,
  }
}

/**
 * Sends an AIRI action to the running local instance.
 *
 * Use when:
 * - A CLI command needs to mutate runtime state in the active AIRI desktop app
 *
 * Expects:
 * - The AIRI server-channel is reachable on the request host and port
 * - The request token matches the running instance when auth is enabled
 *
 * Returns:
 * - The parsed action response from the local AIRI action endpoint
 */
export async function sendAiriAction(request: AiriCliActionRequest, fetchImpl: typeof fetch = fetch): Promise<AiriCliSendActionResult> {
  const response = await fetchImpl(`http://${request.host}:${request.port}/api/actions/${request.action}`, {
    method: 'POST',
    headers: {
      ...(request.token ? { Authorization: `Bearer ${request.token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: request.action }),
  })

  const body = await response.json() as unknown
  const result = parseActionResponseBody(body, request.action)

  if (!response.ok) {
    throw new Error(result.error ?? `AIRI action failed with HTTP ${response.status}`)
  }

  if (!result.ok) {
    throw new Error(result.error ?? 'AIRI action failed.')
  }

  return result
}

function parseOptions(argv: string[]) {
  const options: {
    host?: string
    port?: string
    token?: string
    userDataDir?: string
  } = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--host' || arg === '--port' || arg === '--token' || arg === '--user-data-dir') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error(`Missing value for ${arg}. ${AIRI_CLI_USAGE}`)
      }

      if (arg === '--host')
        options.host = value
      else if (arg === '--port')
        options.port = value
      else if (arg === '--token')
        options.token = value
      else
        options.userDataDir = value

      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}. ${AIRI_CLI_USAGE}`)
  }

  return options
}

function parsePort(rawPort: string) {
  const port = Number.parseInt(rawPort, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid AIRI server port: ${rawPort}`)
  }

  return port
}

function readServerChannelAuthToken(userDataDir: string | undefined, env: AiriCliParseEnvironment) {
  for (const dir of getCandidateUserDataDirs(userDataDir, env)) {
    for (const configPath of getServerChannelConfigPaths(dir)) {
      const token = readTokenFromConfig(configPath)
      if (token)
        return token
    }
  }

  return undefined
}

function getCandidateUserDataDirs(userDataDir: string | undefined, env: AiriCliParseEnvironment) {
  const dirs = [
    userDataDir,
    env.AIRI_USER_DATA_PATH,
    env.APP_USER_DATA_PATH,
    ...getPlatformUserDataDirs(env),
  ].filter((dir): dir is string => Boolean(dir))

  return Array.from(new Set(dirs))
}

function getPlatformUserDataDirs(env: AiriCliParseEnvironment) {
  const home = env.HOME || homedir()
  const appIds = ['ai.moeru.airi', '@proj-airi/stage-tamagotchi', 'AIRI']

  if (platform() === 'win32') {
    const appData = env.APPDATA
    return appData ? appIds.map(appId => path.join(appData, appId)) : []
  }

  if (platform() === 'darwin') {
    return appIds.map(appId => path.join(home, 'Library', 'Application Support', appId))
  }

  const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config')
  return appIds.map(appId => path.join(configHome, appId))
}

function getServerChannelConfigPaths(userDataDir: string) {
  return [
    path.join(userDataDir, 'server-channel-config.json'),
    path.join(userDataDir, 'server-channel', 'config.json'),
  ]
}

function readTokenFromConfig(configPath: string) {
  if (!existsSync(configPath))
    return undefined

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as unknown
    if (!raw || typeof raw !== 'object' || !('authToken' in raw))
      return undefined

    const authToken = raw.authToken
    return typeof authToken === 'string' && authToken.trim() ? authToken.trim() : undefined
  }
  catch {
    return undefined
  }
}

function parseActionResponseBody(body: unknown, action: AiriCliActionName): AiriCliSendActionResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, action, error: 'AIRI returned an invalid action response.' }
  }

  const record = body as Record<string, unknown>
  return {
    ok: record.ok === true,
    action,
    result: record.result,
    error: typeof record.error === 'string' ? record.error : undefined,
  }
}
