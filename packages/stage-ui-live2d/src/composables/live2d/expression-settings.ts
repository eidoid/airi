/** Expression reference inside a Cubism 4 `model3.json` file. */
export interface Model3ExpressionRef {
  Name: string
  File: string
}

interface CachedExpFile {
  name: string
  fileName: string
  data: unknown
}

interface Live2DExpressionSettings {
  expressions?: unknown
  json?: {
    FileReferences?: {
      Expressions?: unknown
    }
  }
  _expFiles?: unknown
}

/**
 * Resolves expression references from pixi-live2d settings.
 *
 * Use when:
 * - A loaded Cubism 4 model needs AIRI's expression controller initialised
 * - Settings may come from pixi-live2d-display, raw model3 JSON, or AIRI's ZIP loader metadata
 *
 * Expects:
 * - `settings` is the model settings object attached to the loaded internal model
 *
 * Returns:
 * - Standard `{ Name, File }` refs suitable for loading exp3 JSON files
 */
export function resolveExpressionRefs(settings: unknown): Model3ExpressionRef[] {
  const live2dSettings = settings as Live2DExpressionSettings | undefined
  if (!live2dSettings || typeof live2dSettings !== 'object')
    return []

  const refs = toExpressionRefs(live2dSettings.expressions)
    ?? toExpressionRefs(live2dSettings.json?.FileReferences?.Expressions)

  if (refs?.length)
    return refs

  return toCachedExpFiles(live2dSettings._expFiles).map(expFile => ({
    Name: expFile.name,
    File: expFile.fileName,
  }))
}

/**
 * Reads an exp3 JSON file from AIRI ZIP-loader metadata when available.
 *
 * Use when:
 * - `fetch(settings.resolveURL(file))` cannot access an extracted ZIP/OPFS expression file
 * - The ZIP loader already parsed exp3 files into `_expFiles`
 *
 * Expects:
 * - `filePath` is either the exact exp3 path from model3 JSON or its basename
 *
 * Returns:
 * - A JSON string matching the original exp3 file, or `undefined` when no cache entry matches
 */
export function readCachedExpressionFile(settings: unknown, filePath: string): string | undefined {
  const live2dSettings = settings as Live2DExpressionSettings | undefined
  if (!live2dSettings || typeof live2dSettings !== 'object')
    return undefined

  const expFiles = toCachedExpFiles(live2dSettings._expFiles)
  const normalizedFilePath = normalizePath(filePath)
  const fileBaseName = basename(normalizedFilePath)
  const fileNameWithoutSuffix = stripExp3Suffix(fileBaseName)

  const match = expFiles.find((expFile) => {
    const normalizedCachedPath = normalizePath(expFile.fileName)
    return normalizedCachedPath === normalizedFilePath
      || basename(normalizedCachedPath) === fileBaseName
      || expFile.name === fileNameWithoutSuffix
  })

  return match ? JSON.stringify(match.data) : undefined
}

function toExpressionRefs(value: unknown): Model3ExpressionRef[] | undefined {
  if (!Array.isArray(value))
    return undefined

  const refs = value.filter((item): item is Model3ExpressionRef => {
    if (!item || typeof item !== 'object')
      return false

    const record = item as Record<string, unknown>
    return typeof record.Name === 'string'
      && record.Name.length > 0
      && typeof record.File === 'string'
      && record.File.length > 0
  })

  return refs.length ? refs : undefined
}

function toCachedExpFiles(value: unknown): CachedExpFile[] {
  if (!Array.isArray(value))
    return []

  return value.filter((item): item is CachedExpFile => {
    if (!item || typeof item !== 'object')
      return false

    const record = item as Record<string, unknown>
    return typeof record.name === 'string'
      && record.name.length > 0
      && typeof record.fileName === 'string'
      && record.fileName.length > 0
      && 'data' in record
  })
}

function normalizePath(path: string) {
  return path.replaceAll('\\', '/')
}

function basename(path: string) {
  return normalizePath(path).split('/').pop() ?? path
}

function stripExp3Suffix(fileName: string) {
  return fileName.replace(/\.exp3\.json$/i, '')
}
