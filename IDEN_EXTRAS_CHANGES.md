# iden-extras Change Notes

Date: 2026-06-13

This document records the extra desktop interaction feature added on top of `iden-features`.

## Hidden Mode Mouse Passthrough

### Problem

When AIRI's hover islands were hidden, the transparent floating window could still consume pointer input in some cases. That prevented mouse move, click, and wheel events from reaching the window underneath AIRI.

### Change

The Stage Tamagotchi main page now enables Electron mouse-event passthrough while the stage is in hidden interaction mode.

Hidden interaction mode means:

- hover islands are hidden;
- no hearing dialog is open;
- the controls menu is not expanded;
- the cursor is not near the resize border;
- the stage is not paused.

In that state, the renderer calls `setIgnoreMouseEvents(true, { forward: true })`, allowing pointer, click, and wheel events to pass through the AIRI window to the desktop window underneath.

Interactive states still disable passthrough so AIRI controls, dialogs, and resize edges remain usable.

### Expected Behavior

- When Auto Hide hides the hover islands, mouse movement, clicks, and scrolling pass through AIRI.
- Moving back into an interactive AIRI area can still restore controls when the environment provides usable pointer tracking.
- Hearing dialogs, expanded controls, paused stage state, and resize borders remain interactive.

### Wayland Note

Native Wayland compositors may restrict global pointer tracking for transparent Electron windows. Inside-window pointer handling uses renderer-local events, but outside-window recovery still depends on Electron/compositor support for cursor position updates.

## Verification Status

Passed:

```bash
nix develop -c pnpm -F @proj-airi/stage-tamagotchi typecheck
nix develop -c pnpm lint
nix develop -c pnpm typecheck
```
