import type { Rectangle } from 'electron'

import { mapForBreakpoints, resolutionBreakpoints, widthFrom } from '../shared/display'

/**
 * Room for the expanded card at the bottom of the window, and for the send animation that moves the card up.
 * The page anchors its content to the bottom edge, so the transparent space is above the card.
 */
export const INLAY_WINDOW_HEIGHT = 200

/** The card reads as a dictation bubble, not a panel, so wide displays do not stretch it. */
const INLAY_WINDOW_MAX_WIDTH = 520

/**
 * Computes where a new inlay window opens.
 *
 * The inlay sits flush in the top-right corner of the work area, out of the way of the stage and the chat.
 * This is the home position. The user can drag the window away, and it returns here after the inlay is idle.
 *
 * Expects:
 * - `workArea` is an Electron display work area in logical coordinates. It excludes menu bars, docks, and taskbars.
 */
export function inlayWindowBounds(workArea: Rectangle): Rectangle {
  const breakpointWidth = mapForBreakpoints(
    workArea.width,
    {
      '720p': widthFrom(workArea, { percentage: 1, max: { percentage: 0.5 } }),
      '1080p': widthFrom(workArea, { percentage: 1, max: { percentage: 0.33 } }),
      '2k': widthFrom(workArea, { percentage: 0.25, max: { actual: 710 } }),
      '4k': widthFrom(workArea, { percentage: 0.2, max: { actual: 768 } }),
    },
    { breakpoints: resolutionBreakpoints },
  )
  const width = Math.min(breakpointWidth, INLAY_WINDOW_MAX_WIDTH)

  return {
    width,
    height: INLAY_WINDOW_HEIGHT,
    x: workArea.x + workArea.width - width,
    y: workArea.y,
  }
}
