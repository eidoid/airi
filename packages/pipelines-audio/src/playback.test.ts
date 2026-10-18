import type { PlaybackClip, PlayedAudio } from './index'

import { describe, expect, it, vi } from 'vitest'

import { Playback } from './index'

describe('playback', () => {
  it('releases readable audio when the playback driver cannot start', async () => {
    const cancelled = vi.fn()
    const playback = new Playback({ nowMs: () => 0, play: () => {
      throw new Error('Audio device unavailable')
    } })
    const group = playback.openGroup('voice')
    expect(await group.enqueue({ id: 'clip', audio: new ReadableStream({ cancel: cancelled }) })).toBe('failed')
    expect(await group.finish()).toMatchObject({ status: 'failed', error: new Error('Audio device unavailable') })
    expect(group.label).toBe('voice')
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('cancels readable audio when a group rejects or discards a clip', async () => {
    const cancelled = vi.fn()
    const rejected = new ReadableStream({ cancel: cancelled })
    const queued = new ReadableStream({ cancel: cancelled })
    const playback = new Playback({ nowMs: () => 0, play: () => ({ done: new Promise(() => {}), stop: async () => ({ throughMs: 0 }) }) })
    const group = playback.openGroup('voice')
    void group.enqueue({ id: 'active', audio: new Blob() })
    void group.enqueue({ id: 'queued', audio: queued })
    await group.stop({ fadeMs: 0 })
    expect(await group.enqueue({ id: 'late', audio: rejected })).toBe('stopped')
    expect(cancelled).toHaveBeenCalledTimes(2)
  })

  it('plays the groups of one lane one after another and frees the lane for the next one', async () => {
    const played: string[] = []
    const play = vi.fn((clip: PlaybackClip) => ({
      done: (clip.audio as Blob).text().then((text) => {
        played.push(text)
        return { throughMs: 1 }
      }),
      stop: async () => ({ throughMs: 0 }),
    }))
    const playback = new Playback({ nowMs: () => 0, play })
    const answer = playback.openGroup('turn-1', { lane: 'alice' })
    const proactive = playback.openGroup('turn-2', { lane: 'alice' })
    const other = playback.openGroup('turn-3', { lane: 'bob' })

    void answer.enqueue({ id: 'answer', audio: new Blob(['answer']) })
    void proactive.enqueue({ id: 'proactive', audio: new Blob(['proactive']) })
    void other.enqueue({ id: 'other', audio: new Blob(['other']) })

    // Another lane does not wait; the queued turn of the same lane does.
    await expect.poll(() => [...played].sort()).toEqual(['answer', 'other'])
    expect(await answer.finish()).toMatchObject({ status: 'silent' })
    await expect.poll(() => [...played].sort()).toEqual(['answer', 'other', 'proactive'])
    // The queued turn speaks after the turn before it, never during it.
    expect(played.indexOf('proactive')).toBeGreaterThan(played.indexOf('answer'))
    await other.finish()
    expect(await proactive.finish()).toMatchObject({ status: 'silent' })
    expect(play).toHaveBeenCalledTimes(3)
  })

  it('releases a lane when the group before it is stopped', async () => {
    const silence = Promise.withResolvers<PlayedAudio>()
    const play = vi.fn((clip: PlaybackClip) => ({
      done: clip.id === 'first' ? new Promise<PlayedAudio>(() => {}) : Promise.resolve({ throughMs: 1 }),
      stop: () => silence.promise,
    }))
    const playback = new Playback({ nowMs: () => 0, play })
    const answer = playback.openGroup('turn-1', { lane: 'alice' })
    const proactive = playback.openGroup('turn-2', { lane: 'alice' })

    void answer.enqueue({ id: 'first', audio: new Blob(['answer']) })
    void proactive.enqueue({ id: 'second', audio: new Blob(['proactive']) })
    await expect.poll(() => play.mock.calls.length).toBe(1)

    // A barge-in stops the speaking group. The queued turn starts without waiting for it to finish.
    void answer.stop({ fadeMs: 100 })
    silence.resolve({ throughMs: 0 })
    await expect.poll(() => play.mock.calls.length).toBe(2)
    expect(play.mock.calls[1][0]).toMatchObject({ id: 'second' })
    await proactive.finish()
  })

  it('waits for actual silence while dropping queued clips and isolating other groups', async () => {
    const silence = Promise.withResolvers<PlayedAudio>()
    const ended = Promise.withResolvers<PlayedAudio>()
    const play = vi.fn(() => ({ done: ended.promise, stop: () => silence.promise }))
    const playback = new Playback({ nowMs: () => 0, play })
    const group = playback.openGroup('alice')
    const first = group.enqueue({ id: 'one', audio: new Blob(['a']) })
    const second = group.enqueue({ id: 'two', audio: new Blob(['b']) })
    await expect.poll(() => play.mock.calls.length).toBe(1)
    const stopping = group.stop({ fadeMs: 100 })
    let silent = false
    void stopping.then(() => {
      silent = true
    })
    expect(await second).toBe('stopped')
    expect(await group.enqueue({ id: 'late', audio: new Blob() })).toBe('stopped')
    expect(silent).toBe(false)
    const other = playback.openGroup('bob')
    void other.enqueue({ id: 'other', audio: new Blob(['c']) })
    await expect.poll(() => play.mock.calls.length).toBe(2)
    silence.resolve({ throughMs: 125 })
    expect(await stopping).toEqual({ groupId: group.id, status: 'silent', played: [{ clipId: 'one', throughMs: 125 }] })
    expect(await first).toBe('stopped')
    ended.resolve({ throughMs: 500 })
    expect((await other.finish()).status).toBe('silent')
  })

  it('reports each clip on the driver clock so callers can align later output', async () => {
    const play = vi.fn((clip: PlaybackClip) => ({
      done: Promise.resolve({ throughMs: 500, interval: { startMs: clip.startAtMs ?? 1000, endMs: (clip.startAtMs ?? 1000) + 500 } }),
      stop: async () => ({ throughMs: 0 }),
    }))
    const playback = new Playback({ nowMs: () => 1000, play })
    const group = playback.openGroup('voice')
    const first = group.enqueue({ id: 'first', audio: new Blob(['a']) })
    expect(await first).toBe('ended')

    const receipt = await group.finish()
    const firstEnd = receipt.played[0].interval!.endMs
    const second = playback.openGroup('voice')
    void second.enqueue({ id: 'second', audio: new Blob(['b']), startAtMs: firstEnd + 2000 })

    expect(playback.nowMs()).toBe(1000)
    expect(receipt.played).toEqual([{ clipId: 'first', throughMs: 500, interval: { startMs: 1000, endMs: 1500 } }])
    expect(play).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'second', startAtMs: 3500 }))
    expect((await second.finish()).played).toEqual([{ clipId: 'second', throughMs: 500, interval: { startMs: 3500, endMs: 4000 } }])
  })

  it('rejects a clip start time that is not on the clock and releases its audio', () => {
    const cancelled = vi.fn()
    const group = new Playback({ nowMs: () => 0, play: vi.fn() }).openGroup('voice')

    expect(() => group.enqueue({ id: 'clip', audio: new ReadableStream({ cancel: cancelled }), startAtMs: Number.NaN })).toThrow('Clip start time must be finite')
    expect(cancelled).toHaveBeenCalledOnce()
  })
})
