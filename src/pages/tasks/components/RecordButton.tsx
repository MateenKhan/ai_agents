import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Circle, Square, Mic, MicOff, Settings2 } from 'lucide-react';
import {
  ScreenRecorder, downloadBlob, isSupported, isUserCancel,
  availableTiers, defaultTier, estimateBitrate, FPS_OPTIONS, QUALITY_TIERS,
  type TierId,
} from '../services/screenRecorder';
import { useToast } from './Toast';
import { Tooltip } from './Tooltip';

/**
 * Manual screen-recorder control for the board's action cluster.
 * Idle → mic toggle + quality popover + record icon. Recording → pulsing dot + MM:SS, click to stop.
 * The browser's own picker provides consent; the browser's "Stop sharing" is handled too.
 */

const CLUSTER_BTN =
  'flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg bg-slate-100 border border-slate-200 ' +
  'text-slate-500 sm:hover:bg-slate-200 sm:hover:text-slate-900 transition-colors';

const LS_TIER = 'mc.rec.tier';
const LS_FPS = 'mc.rec.fps';

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function mbps(bits: number): string {
  return `${(bits / 1_000_000).toFixed(1)} Mbps`;
}

export function RecordButton() {
  const toast = useToast();
  const recorderRef = useRef<ScreenRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [withMic, setWithMic] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [actual, setActual] = useState<string>('');
  const supported = isSupported();

  // Tiers this display can really produce — anything above the panel's native size only upscales.
  const tiers = supported ? availableTiers() : [];
  const [tier, setTier] = useState<TierId>(() => {
    const saved = localStorage.getItem(LS_TIER) as TierId | null;
    const ok = saved && availableTiers().find(t => t.id === saved)?.supported;
    return ok ? saved! : defaultTier();
  });
  const [fps, setFps] = useState<number>(() => Number(localStorage.getItem(LS_FPS)) || 30);

  useEffect(() => { localStorage.setItem(LS_TIER, tier); }, [tier]);
  useEffect(() => { localStorage.setItem(LS_FPS, String(fps)); }, [fps]);

  if (!recorderRef.current) recorderRef.current = new ScreenRecorder();

  // Finalize: write the file, reset the UI. Shared by our stop button and the browser's.
  const finalize = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    try {
      const { blob, filename } = await rec.stop();
      setRecording(false);
      if (!blob.size) { toast.error('Recording empty', 'No video data was captured.'); return; }
      downloadBlob(blob, filename);
      toast.success('Recording saved', `${filename} · ${(blob.size / 1_048_576).toFixed(1)} MB`);
    } catch (e) {
      setRecording(false);
      toast.fromError('Could not save recording', e);
    }
  }, [toast]);

  // The browser's "Stop sharing" button ends the track — finalize exactly like our stop.
  useEffect(() => {
    recorderRef.current?.onExternalStop(() => { void finalize(); });
  }, [finalize]);

  // Elapsed timer, only while recording.
  useEffect(() => {
    if (!recording) { setElapsed(0); return; }
    const iv = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(iv);
  }, [recording]);

  // Unmounting mid-recording must still stop the tracks (or the sharing indicator lingers).
  // Save whatever was captured rather than dropping it; no setState — the component is gone.
  useEffect(() => {
    const rec = recorderRef.current;
    return () => {
      if (!rec?.isRecording) return;
      rec.stop().then(({ blob, filename }) => { if (blob.size) downloadBlob(blob, filename); }).catch(() => { /* nothing to save */ });
    };
  }, []);

  const start = async () => {
    setPanelOpen(false);
    try {
      const rec = recorderRef.current!;
      await rec.start({ tier, fps, audio: withMic });
      setRecording(true);

      // The picked surface may be smaller than the requested tier — report what we really got.
      const s = rec.settings;
      if (s) {
        setActual(`${s.width}×${s.height} · ${s.frameRate} fps · ${mbps(s.bitsPerSecond)}`);
        const want = QUALITY_TIERS.find(t => t.id === tier)!;
        if (s.height < want.height) {
          toast.info('Recording below requested quality', `The shared surface is only ${s.width}×${s.height}. Capturing at its native size — upscaling would add size, not detail.`);
        }
      }
    } catch (e) {
      // Dismissing the picker is a normal action, not an error worth a toast.
      if (isUserCancel(e)) return;
      toast.fromError('Could not start recording', e);
    }
  };

  if (!supported) {
    return (
      <Tooltip label="Screen recording needs https or localhost">
        <button disabled aria-label="Record session" className={`${CLUSTER_BTN} opacity-50 cursor-not-allowed`}>
          <Circle size={16} />
        </button>
      </Tooltip>
    );
  }

  if (recording) {
    return (
      <Tooltip label={actual ? `Stop recording — ${actual}` : 'Stop recording'}>
        <button
          onClick={() => void finalize()}
          data-feature-id="tasks-record-session"
          aria-label={`Stop recording — ${mmss(elapsed)} elapsed`}
          className="flex items-center gap-2 px-3 min-h-[40px] rounded-lg bg-rose-50 border border-rose-300 text-rose-700 sm:hover:bg-rose-100 transition-colors"
        >
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
          <span className="text-xs font-black font-mono tabular-nums">{mmss(elapsed)}</span>
          <Square size={12} fill="currentColor" />
        </button>
      </Tooltip>
    );
  }

  const projected = QUALITY_TIERS.find(t => t.id === tier)!;

  return (
    <>
      <Tooltip label={withMic ? 'Microphone on — clip will include narration' : 'Microphone off — silent clip'}>
        <button
          onClick={() => setWithMic(v => !v)}
          aria-pressed={withMic}
          aria-label={withMic ? 'Disable microphone' : 'Enable microphone'}
          className={withMic
            ? 'flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-700 sm:hover:bg-emerald-100 transition-colors'
            : CLUSTER_BTN}
        >
          {withMic ? <Mic size={16} /> : <MicOff size={16} />}
        </button>
      </Tooltip>

      {/* Quality popover */}
      <div className="relative">
        <Tooltip label={`Recording quality — ${projected.label} · ${fps} fps`}>
          <button
            onClick={() => setPanelOpen(o => !o)}
            aria-expanded={panelOpen}
            aria-label="Recording quality"
            data-feature-id="tasks-record-quality"
            className={CLUSTER_BTN}
          >
            <Settings2 size={16} />
          </button>
        </Tooltip>

        {panelOpen && (
          <>
            {/* click-away */}
            <div className="fixed inset-0 z-[70]" onClick={() => setPanelOpen(false)} />
            <div className="absolute right-0 top-full mt-2 z-[75] w-64 p-3 rounded-xl border border-slate-200 bg-white shadow-xl space-y-3">
              <div>
                <label className="eyebrow text-slate-400">Resolution</label>
                <div className="mt-1 grid grid-cols-4 gap-1">
                  {tiers.map(t => (
                    <button
                      key={t.id}
                      disabled={!t.supported}
                      onClick={() => setTier(t.id)}
                      title={t.supported ? `${t.width}×${t.height}` : `This display is too small for ${t.label} — capturing above the source only upscales.`}
                      className={`min-h-[32px] rounded-md border text-[11px] font-bold transition-colors ${!t.supported
                        ? 'border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed'
                        : tier === t.id
                          ? 'border-accent-500 bg-accent-50 text-accent-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="eyebrow text-slate-400">Frame rate</label>
                <div className="mt-1 grid grid-cols-3 gap-1">
                  {FPS_OPTIONS.map(f => (
                    <button
                      key={f}
                      onClick={() => setFps(f)}
                      className={`min-h-[32px] rounded-md border text-[11px] font-bold transition-colors ${fps === f
                        ? 'border-accent-500 bg-accent-50 text-accent-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                    >
                      {f} fps
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-slate-500 leading-snug">
                Target {projected.width}×{projected.height} · ~{mbps(estimateBitrate(projected.width, projected.height, fps))}.
                Clamped to the shared surface — never upscaled.
              </p>
            </div>
          </>
        )}
      </div>

      <Tooltip label="Record session">
        <button
          onClick={() => void start()}
          data-feature-id="tasks-record-session"
          aria-label="Record session"
          className={CLUSTER_BTN}
        >
          <Circle size={16} fill="currentColor" className="text-rose-500" />
        </button>
      </Tooltip>
    </>
  );
}
