/**
 * Reads the JSON value of a model reply.
 *
 * Reasoning models can prefix the answer with a `<think>` block or prose. This function removes thinking blocks,
 * unwraps an optional Markdown code fence, and reads the first JSON object or array. A reply without JSON throws.
 *
 * @example
 * readJsonReply('```json\n{"complete": true}\n```')
 * // => { complete: true }
 */
export function readJsonReply(reply: string): unknown {
  const withoutThinking = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  const fenced = withoutThinking.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] ?? withoutThinking).trim()
  const objectStart = candidate.indexOf('{')
  const arrayStart = candidate.indexOf('[')
  const starts = [objectStart, arrayStart].filter(start => start !== -1)
  const start = starts.length ? Math.min(...starts) : -1
  const end = candidate[start] === '[' ? candidate.lastIndexOf(']') : candidate.lastIndexOf('}')
  if (start === -1 || end <= start)
    throw new Error(`Model reply did not contain JSON: ${reply.slice(0, 120)}`)
  return JSON.parse(candidate.slice(start, end + 1))
}
