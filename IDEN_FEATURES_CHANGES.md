# iden-features Change Notes

Date: 2026-06-12
Updated: 2026-06-13

This document consolidates the change notes for the `iden-features` branch. It covers the cleaned-up changes merged from `iden` plus the three desktop interaction fixes requested for AIRI.

## Desktop Floating Window Interaction

### Problem

Three floating-window interaction problems needed to be fixed:

- Auto Hide did not work reliably in the local desktop environment.
- AIRI showed a pulsing border near the floating window edge.
- The controls menu collapsed roughly one second after clicking Expand.

### Change

The Stage Tamagotchi main page now derives outside-window state from Electron window bounds and window-relative mouse coordinates. This keeps Auto Hide, transparency hit testing, and click-through decisions on the same coordinate basis.

After additional Wayland testing, the shared Electron relative mouse composable now falls back to renderer-local DOM pointer coordinates once the floating window receives pointer input. This keeps Live2D look-at, hover island hit testing, and transparency sampling responsive when native Wayland does not provide reliable global cursor coordinates through Electron.

The main page also uses DOM pointer enter/move/leave state for inside-window detection after renderer pointer input is available. If no renderer pointer input has happened yet, it keeps the Electron screen-coordinate path as a fallback for X11/XWayland and startup behavior.

The controls island now exposes its expanded state to the parent page. While expanded, the parent keeps the controls visible and keeps the Electron window interactive, so click-through and auto-hide no longer interrupt menu use.

The flashing resize-border overlay was removed. Border proximity can still keep the window interactive for resizing, but it no longer renders a pulsing frame around AIRI.

### Expected Behavior

- Hover islands hide after the cursor leaves the floating window.
- Live2D follows the cursor inside the floating window on Wayland and X11/XWayland.
- The expanded controls menu stays open until the user collapses it.
- The pulsing border no longer appears around the floating window.
- Hearing controls and paused-stage state still keep the window interactive.

## Main Window DevTools Startup

### Problem

The Stage Tamagotchi main window automatically opened detached DevTools during development/debug startup. That was noisy for daily local use and for packaged local builds.

### Change

The automatic DevTools startup branch was removed from main window setup, along with the now-unused imports.

### Expected Behavior

The AIRI main floating window opens without automatically spawning a detached DevTools window. DevTools can still be opened manually when needed.

## MiniMax Speech Provider Settings

### Problem

MiniMax Speech had provider support but no dedicated shared settings page for model, voice, and audio options.

### Change

A MiniMax Speech settings page was added under shared Stage provider settings. It exposes:

- model selection;
- speed, pitch, and volume controls;
- language boost;
- sample rate, bitrate, and channel controls;
- the shared speech playground.

The MiniMax provider defaults now include the same options used by the settings page. Speech requests map these values to MiniMax `voice_setting`, `audio_setting`, and `language_boost` fields.

Voice loading now calls MiniMax's voice API when an API key is configured, combines system and cloned voices, and de-duplicates by voice ID.

### Expected Behavior

- Users can configure MiniMax-specific speech options from Settings.
- The speech playground uses the selected MiniMax model and audio options.
- Voice lists come from the configured MiniMax account instead of a fixed local list.

## Nix and Electron Package Build

### Problem

The default AIRI Nix build should build web assets and the Electron package without requiring every optional workspace toolchain. The Godot sidecar workspace is not consumed by the Electron package, but broad package builds can fail on machines without the Godot/.NET stack.

The Electron builder invocation also needed its platform and `dir` target ordering adjusted for the Nix package build.

### Change

The Nix asset and package build phases now run Turbo with a package filter that excludes `@proj-airi/stage-tamagotchi-godot`.

The dev shell includes Python, Make, and GCC for native Node dependency builds.

`fetchPnpmDeps` receives the pinned `pnpm` input, and the pnpm dependency hash was updated for the lockfile/workspace changes.

The Electron builder command now passes the platform flag before the `dir` target.

The stale `@mediapipe/tasks-vision` pnpm patch entry and patch file were removed so the lockfile no longer references a package patch that is not needed by the current dependency graph.

### Expected Behavior

- `nix build .#airi` can build the Electron package without the Godot sidecar toolchain.
- Native dependency build steps have compiler tools available in the dev shell.
- pnpm dependency fetching uses the flake-pinned pnpm.
- pnpm dependency metadata does not reference the removed MediaPipe patch.

## Build Cache Workflow

### Problem

The `iden` workflow needs a CI path that builds the AIRI flake and pushes outputs to an Attic cache, avoiding repeated rebuilds for the same Nix outputs.

### Change

A GitHub Actions workflow builds `.#airi`, configures Attic from repository secrets, and pushes `./result` to the configured cache.

The workflow uses concurrency keyed by workflow and ref so superseded runs cancel automatically.

### Required Secrets

- `ATTIC_ENDPOINT`
- `ATTIC_TOKEN`
- `ATTIC_CACHE`

### Expected Behavior

- Pull requests can validate the flake build path.
- Pushes to `iden` refresh the Attic cache.
- New pushes cancel older cache builds for the same ref.

## Codex Workspace Ignore

### Problem

Codex can create a local `.codex` workspace directory while operating in the repository. That directory is machine-local agent state and should not be committed.

### Change

`.codex` was added to `.gitignore`.

### Expected Behavior

Local Codex state remains untracked.

## Verification Status

Passed:

```bash
nix develop -c pnpm install --frozen-lockfile
nix develop -c pnpm typecheck
nix develop -c pnpm -F @proj-airi/stage-tamagotchi typecheck
nix develop -c pnpm lint
```

`pnpm install --frozen-lockfile` was needed because the local workspace `node_modules` links were stale after branch reconstruction. It did not change tracked files, and it restored missing workspace links such as `@pinia/colada`, `@proj-airi/stage-ui-spine`, and server-side runtime dependencies.
