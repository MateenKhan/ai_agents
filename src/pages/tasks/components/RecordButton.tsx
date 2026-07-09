import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Circle, Square, Mic, MicOff } from 'lucide-react';
import { ScreenRecorder, downloadBlob, isSupported, isUserCancel } from '../services/screenRecorder';
import { useToast } from './Toast';
import { Tooltip } from './Tooltip';

/**
 * Manual screen-recorder control for the board's action cluster.
 * Idle → record icon. Recording → pulsing dot + MM:SS, click to stop.
 * The browser's own picker provides consent; the browser's "Stop sharing" is handled too.
 */

const CLUSTER_BTN =
  'flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg bg-slate-100 border border-slate-200 ' +
  'text-slate-500 sm:hover:bg-slate-200 sm:hover:text-slate-900 transition-colors';

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function RecordButton() {
  const toast = useToast();
  const recorderRef = useRef<ScreenRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [withMic, setWithMic] = useState(false);
  const supported = isSupported();

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
    try {
      await recorderRef.current!.start({ audio: withMic });
      setRecording(true);
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
      <Tooltip label="Stop recording">
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
