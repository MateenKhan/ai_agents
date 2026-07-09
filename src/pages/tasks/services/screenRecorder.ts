// Manual, opt-in screen recorder for the Piranha board.
//
// Ported from remote_manufacturing's `VideoRecorder` (MediaRecorder + WebM/VP9 + chunk
// accumulation + blob download), but the stream source is swapped: that recorder captured a
// WebGL canvas via `canvas.captureStream()`, which cannot capture DOM. The board is regular
// DOM, so we use `getDisplayMedia()` — which also gives us the browser's own picker, consent
// prompt and "you are sharing" indicator for free. That IS the opt-in; no settings flag needed.

export interface RecorderOptions {
  /** Target resolution tier. Clamped down to the real surface size — never upscaled. */
  tier?: TierId;
  /** Frame rate ceiling for the display capture. Default 30. */
  fps?: number;
  /** Mix in microphone audio (for narrated demos). Default false. */
  audio?: boolean;
  /** Encoder bitrate. Omit to derive it from the ACTUAL captured resolution + fps. */
  bitsPerSecond?: number;
}

/** What the stream really produced, once the browser resolved the picker. */
export interface ActualSettings { width: number; height: number; frameRate: number; bitsPerSecond: number }

export type TierId = '720p' | '1080p' | '2k' | '4k';

export interface QualityTier { id: TierId; label: string; width: number; height: number }

export const QUALITY_TIERS: QualityTier[] = [
  { id: '720p', label: '720p', width: 1280, height: 720 },
  { id: '1080p', label: '1080p', width: 1920, height: 1080 },
  { id: '2k', label: '2K', width: 2560, height: 1440 },
  { id: '4k', label: '4K', width: 3840, height: 2160 },
];

export const FPS_OPTIONS = [24, 30, 60] as const;

const MIME_CHAIN = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

/** getDisplayMedia needs a secure context (https or localhost). Guard so the UI can explain. */
export function isSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function'
  );
}

/** True when the user dismissed the browser's screen-picker — a normal action, not an error. */
export function isUserCancel(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError');
}

/**
 * The display's real pixel dimensions. `screen.width/height` are CSS pixels, so they must be
 * scaled by devicePixelRatio (a 2560×1440 panel at 125% Windows scaling reports 2048×1152).
 */
export function maxCapturePixels(): { width: number; height: number } {
  if (typeof window === 'undefined' || !window.screen) return { width: 1920, height: 1080 };
  const dpr = window.devicePixelRatio || 1;
  return { width: Math.round(window.screen.width * dpr), height: Math.round(window.screen.height * dpr) };
}

/**
 * Which tiers this machine can actually produce. Capturing above the source resolution only
 * upscales — bigger file, zero extra detail — so unsupported tiers are offered but disabled.
 * This reads the CURRENT monitor; sharing a different/larger screen is still clamped at runtime.
 */
export function availableTiers(): Array<QualityTier & { supported: boolean }> {
  const max = maxCapturePixels();
  return QUALITY_TIERS.map(t => ({
    // 720p is always allowed — every display can downscale to it.
    ...t, supported: t.id === '720p' || (t.width <= max.width + 1 && t.height <= max.height + 1),
  }));
}

/** Largest tier this display supports, as a sensible default. */
export function defaultTier(): TierId {
  const usable = availableTiers().filter(t => t.supported);
  return (usable[usable.length - 1] ?? QUALITY_TIERS[1]).id;
}

/**
 * Bits per pixel per frame for VP9 screen content. 0.08 reproduces the original 5 Mbps at
 * 1080p30 and scales sanely: 2K30 ≈ 8.8 Mbps, 4K30 ≈ 19.9 Mbps, 4K60 ≈ 39.8 Mbps.
 * Raising resolution without raising bitrate looks WORSE, so this is derived, not fixed.
 */
export function estimateBitrate(width: number, height: number, fps: number): number {
  const bps = Math.round(width * height * fps * 0.08);
  return Math.min(Math.max(bps, 2_000_000), 50_000_000);
}

function pickMimeType(): string | undefined {
  return MIME_CHAIN.find(m => MediaRecorder.isTypeSupported(m));
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export class ScreenRecorder {
  private recorder: MediaRecorder | null = null;
  private display: MediaStream | null = null;
  private mic: MediaStream | null = null;
  private chunks: Blob[] = [];
  private externalStop: (() => void) | null = null;
  private actual: ActualSettings | null = null;

  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** Resolution/fps/bitrate the stream actually produced — known only after start(). */
  get settings(): ActualSettings | null {
    return this.actual;
  }

  /** Fired when the user stops sharing from the browser's own UI (not our button). */
  onExternalStop(cb: () => void): void {
    this.externalStop = cb;
  }

  /** Prompts the browser's screen-picker, then starts recording. Rejects if the user cancels. */
  async start(opts: RecorderOptions = {}): Promise<void> {
    if (this.isRecording) return;
    if (!isSupported()) throw new Error('Screen capture needs a secure context — use https or localhost.');

    const { fps = 30, audio = false } = opts;
    const tier = QUALITY_TIERS.find(t => t.id === opts.tier) ?? QUALITY_TIERS[1];

    // `max` (not `exact`/`min`) so the browser downscales a larger surface to the tier and
    // simply hands back a smaller one when the source can't reach it — no OverconstrainedError.
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: fps, max: fps }, width: { max: tier.width }, height: { max: tier.height } },
      audio: false,
    });

    const video = display.getVideoTracks()[0];
    // Chrome may ignore the constraints passed to getDisplayMedia; re-apply to the live track.
    try { await video?.applyConstraints({ width: { max: tier.width }, height: { max: tier.height }, frameRate: { max: fps } }); }
    catch { /* best-effort — we record whatever the source gives */ }

    const st = video?.getSettings() ?? {};
    const width = st.width ?? tier.width;
    const height = st.height ?? tier.height;
    const frameRate = Math.round(st.frameRate ?? fps);
    const bitsPerSecond = opts.bitsPerSecond ?? estimateBitrate(width, height, frameRate);
    this.actual = { width, height, frameRate, bitsPerSecond };

    let tracks: MediaStreamTrack[] = display.getVideoTracks();
    if (audio) {
      // A denied/absent mic must not lose the recording — fall back to a silent clip.
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        tracks = [...tracks, ...this.mic.getAudioTracks()];
      } catch { this.mic = null; }
    }

    this.display = display;
    this.chunks = [];

    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(new MediaStream(tracks), { ...(mimeType ? { mimeType } : {}), bitsPerSecond });
    this.recorder.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    // Timeslice so chunks land steadily — a crash mid-session still leaves recoverable data.
    this.recorder.start(1000);

    // The display track ends when the user hits the browser's own "Stop sharing".
    video?.addEventListener('ended', () => this.externalStop?.());
  }

  /** Stops and resolves with the finished blob + a suggested filename. */
  async stop(): Promise<{ blob: Blob; filename: string }> {
    const recorder = this.recorder;
    if (!recorder) throw new Error('Not recording.');

    const type = recorder.mimeType || 'video/webm';
    const blob = await new Promise<Blob>(resolve => {
      // After an external stop the recorder may already be inactive and its 'stop' event
      // already fired — re-attaching onstop would never resolve. Take the chunks as-is.
      if (recorder.state === 'inactive') return resolve(new Blob(this.chunks, { type }));
      recorder.onstop = () => resolve(new Blob(this.chunks, { type }));
      recorder.stop();
    });

    this.cleanup();
    return { blob, filename: `piranha_${timestamp()}.webm` };
  }

  /** Stop every track, or the browser keeps showing its sharing indicator. */
  private cleanup(): void {
    this.display?.getTracks().forEach(t => t.stop());
    this.mic?.getTracks().forEach(t => t.stop());
    this.display = null;
    this.mic = null;
    this.recorder = null;
    this.chunks = [];
  }
}

/** Save a blob to disk via a transient object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been dispatched, or Chrome cancels the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
