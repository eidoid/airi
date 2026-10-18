import type { StageDiagnosticSample } from './use-stage-diagnostics'

import { describe, expect, it } from 'vitest'

import { appendSample, formatSample } from './use-stage-diagnostics'

function sample(overrides: Partial<StageDiagnosticSample> = {}): StageDiagnosticSample {
  return {
    at: 0,
    hidden: false,
    fps: 60,
    heapUsedMb: 512,
    heapTotalMb: 600,
    heapLimitMb: 4096,
    microphone: { enabled: true, ready: true },
    input: { phase: 'capturing' },
    wake: 'ready',
    speaking: false,
    responses: 1,
    recording: false,
    lease: false,
    ...overrides,
  }
}

describe('appendSample', () => {
  it('keeps the newest samples in order and drops the oldest past the limit', () => {
    const samples = [sample({ at: 1 }), sample({ at: 2 }), sample({ at: 3 })]
    const next = appendSample(samples, sample({ at: 4 }), 3)

    expect(next.map(item => item.at)).toEqual([2, 3, 4])
    // The ring never mutates the samples that a reader may hold.
    expect(samples).toHaveLength(3)
  })
})

describe('formatSample', () => {
  it('writes one line with the frame rate, the heap, and the voice state', () => {
    expect(formatSample(sample())).toBe('[stage-diagnostics] fps=60 heap=512/600MB mic=on/ready wake=ready input=capturing speaking=false responses=1 recording=false')
  })

  it('names the reason that a pending input waits for', () => {
    expect(formatSample(sample({ fps: null, input: { phase: 'pending', waitingFor: 'source' }, hidden: true })))
      .toBe('[stage-diagnostics] fps=? heap=512/600MB mic=on/ready wake=ready input=pending(source) speaking=false responses=1 recording=false hidden')
  })

  it('reports a window without a memory extension', () => {
    expect(formatSample(sample({ heapUsedMb: null, heapTotalMb: null, heapLimitMb: null, input: null })))
      .toContain('heap=?')
  })
})
