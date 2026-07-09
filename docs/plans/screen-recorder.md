# Plan — Optional screen recorder for Piranha

**Status:** ready to implement · **Owner:** unassigned agent · **Est:** 1 small PR

## Goal

Add a **manual, opt-in screen recorder** to the Piranha board so the maintainer can record real
work sessions (agents planning → building → QA → merging), then edit and publish those clips as
marketing / proof-of-work content.

**Explicitly manual.** A button starts it, a button stops it, the file lands on disk. Nothing
records automatically. Nothing uploads anywhere. The user edits and publishes by hand.

---

## Prior art — and why it doesn't transplant

There is an existing recorder in the sibling project `remote_manufacturing`:

| File | What it is |
| :-- | :-- |
| `projects/remote_manufacturing/src/services/arch/captureService.ts` | `VideoRecorder` class — `MediaRecorder`, WebM/VP9, 5 Mbps, chunk collection, blob → object URL → download. Also `captureScreenshot()` via `canvas.toDataURL()`. |
| `projects/remote_manufacturing/src/components/arch/CaptureHandler.tsx` | React-Three-Fiber component that wires the recorder to `window` CustomEvents (`arch-viz-record-start` / `-stop` / `arch-viz-screenshot`). |

**Critical difference — read this before copying anything:**

That recorder captures a **WebGL canvas** via `canvas.captureStream(fps)`. Piranha's board is
**regular DOM** (React + Tailwind), not a canvas. `captureStream()` cannot capture DOM.

- ✅ **Reuse:** the `VideoRecorder` shape — `MediaRecorder` setup, mime-type probing, chunk
  accumulation, `onstop` → `Blob` → object URL → download, `isRecording` getter, 5 Mbps bitrate.
- ❌ **Replace:** the stream source. Use `navigator.mediaDevices.getDisplayMedia()` instead of
  `canvas.captureStream()`.
- ❌ **Drop:** the R3F `useThree()` coupling and the `window` CustomEvent bus. Overkill here —
  call the recorder directly from a React component.

**Bonus:** `getDisplayMedia()` makes the browser show its own native picker + consent prompt
("which window/tab/screen do you want to share?") and a persistent "you are sharing" indicator.
That **is** the opt-in. No extra permission plumbing, no settings flag, no privacy scaffolding
needed — the browser enforces consent by design.

---

## Scope

### In scope
- A record button on the Piranha board (start / stop, elapsed timer, recording indicator).
- `getDisplayMedia()` capture → WebM file downloaded locally.
- Optional microphone audio (for narrated demos), off by default.
- Graceful handling when the user stops sharing via the browser's own "Stop sharing" button.

### Out of scope (do NOT build)
- Automatic / unattended recording.
- Any upload, publish, or network transmission of the video.
- Per-project settings, env flags, or an opt-in database column — the browser's consent prompt
  already gates this. Do not add configuration nobody needs.
- CI-generated demos, seeded demo projects, ffmpeg post-processing pipelines.
- Screenshot capture (can be a follow-up; not required here).

---

## Implementation

### 1. `src/pages/tasks/services/screenRecorder.ts` (new)

Port the `VideoRecorder` class, swapping the stream source.

```ts
export interface RecorderOptions {
  fps?: number;            // default 30
  audio?: boolean;         // capture mic, default false
  bitsPerSecond?: number;  // default 5_000_000
}

export class ScreenRecorder {
  /** Prompts the browser's screen-picker, then starts recording.
   *  Rejects if the user cancels the picker. */
  async start(opts?: RecorderOptions): Promise<void>;
  /** Stops and resolves with the finished blob + a suggested filename. */
  async stop(): Promise<{ blob: Blob; filename: string }>;
  get isRecording(): boolean;
  /** Fired when the user stops sharing from the browser's own UI. */
  onExternalStop(cb: () => void): void;
}
```

Notes for the implementer:
- Stream: `await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: fps }, audio: false })`.
  For mic audio, get a second stream via `getUserMedia({ audio: true })` and merge the tracks into
  one `MediaStream` before handing it to `MediaRecorder`.
- Mime probing: keep the existing `['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']`
  fallback chain with `MediaRecorder.isTypeSupported`.
- **External stop:** the display stream's video track fires `ended` when the user clicks the
  browser's "Stop sharing". Listen for it (`track.addEventListener('ended', …)`) and stop the
  recorder + notify the UI. The old canvas recorder had no equivalent — this is new behavior.
- Always `stream.getTracks().forEach(t => t.stop())` on stop, or the browser keeps showing the
  sharing indicator.
- Filename: `piranha_<ISO timestamp with : and . replaced by ->.webm`.
- `getDisplayMedia` requires a **secure context** — `https://` or `localhost`. Piranha runs on
  `localhost:6951`, so this is fine. Guard with a clear error if `navigator.mediaDevices` is
  undefined (e.g. served over plain http from a VPS IP).

### 2. `src/pages/tasks/components/RecordButton.tsx` (new)

- Idle: a small record icon button, tooltip "Record session".
- Recording: red pulsing dot + `MM:SS` elapsed timer, click to stop.
- On stop: trigger the download (anchor with `URL.createObjectURL(blob)`, then
  `URL.revokeObjectURL` after the click) and show a success toast — reuse the existing
  `useToast()` from `src/pages/tasks/components/Toast.tsx`.
- If the user cancels the picker, do nothing (no error toast — cancelling is normal).
- If `getDisplayMedia` is unavailable, disable the button with a tooltip explaining
  "needs https or localhost".
- Add `data-feature-id="tasks-record-session"` per the project's UI tagging convention.

### 3. Wire it in

Mount `<RecordButton />` in `src/pages/tasks/components/TasksHeader.tsx`, in the existing
right-hand icon cluster (next to refresh / settings). One line.

---

## Acceptance criteria

- [ ] Clicking record opens the browser's native screen-picker.
- [ ] Cancelling the picker leaves the UI in its idle state, no error shown.
- [ ] While recording, the button shows a live elapsed timer and a clear recording indicator.
- [ ] Clicking stop downloads a playable `.webm` (verify it opens and shows the board).
- [ ] Clicking the **browser's own** "Stop sharing" also finalizes the file and resets the UI.
- [ ] After any stop, the browser's sharing indicator disappears (all tracks stopped).
- [ ] Optional mic audio produces a clip with audible narration when enabled.
- [ ] Nothing is uploaded. Nothing records without an explicit click. No new env vars or settings.
- [ ] `npx tsc --noEmit` clean, `pnpm test` green.

## Verification (do not skip)

Drive the real app as a user, per the repo's verification standard:
run `pnpm run agents`, open `http://localhost:6951`, click record, pick the tab, let a task run
for ~20s, stop, then **open the downloaded file and watch it**. A compile-clean build is not
verification.

## Follow-ups (separate PRs, not this one)

- Screenshot button (`captureScreenshot` port — trivial once the service exists).
- Speed-ramp / trim helper for the long dead-time while agents think.
- `ROADMAP.md` entry: auto-generated release demos (deferred — see discussion; manual first).
