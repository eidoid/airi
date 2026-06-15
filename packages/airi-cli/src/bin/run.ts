#!/usr/bin/env tsx

import process from 'node:process'

import { errorMessageFrom } from '@moeru/std'

import { parseAiriCliArguments, sendAiriAction } from '../index'

/**
 * Runs the AIRI CLI entrypoint.
 *
 * Use when:
 * - Executing `airi msg action ...` from a shell
 *
 * Expects:
 * - `argv` excludes the executable and script path
 *
 * Returns:
 * - Resolves after the command response has been printed
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const request = parseAiriCliArguments(argv)
  const response = await sendAiriAction(request)
  console.info(JSON.stringify({
    ok: true,
    action: response.action,
    result: response.result,
  }))
}

main().catch((error) => {
  console.error(errorMessageFrom(error) ?? 'AIRI CLI failed.')
  process.exitCode = 1
})
