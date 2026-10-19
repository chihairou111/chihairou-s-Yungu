'use client';
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import FiberManualRecord from '@mui/icons-material/FiberManualRecord';
import MicOffOutlined from '@mui/icons-material/MicOffOutlined';
import PauseRounded from '@mui/icons-material/PauseRounded';
import PlayArrow from '@mui/icons-material/PlayArrow';
import Replay from '@mui/icons-material/Replay';
import StopRounded from '@mui/icons-material/StopRounded';
import MediaDialog from './MediaDialog';
import { audioFileType, formatElapsed, recordingName, useMediaStream } from './media';

interface RecorderDialogProps {
  open: boolean;
  onClose: () => void;
  /** The finished recording as one audio file. */
  onAdd: (file: File) => void;
}

type Phase = 'ready' | 'recording' | 'paused' | 'done';

/** Asked for first; a browser that cannot record it uses its own format (and the file name follows). */
const PREFERRED_TYPE = 'audio/webm';
const TICK_MS = 250;

const STATUS: Record<Phase, string> = { ready: 'Ready', recording: 'Recording', paused: 'Paused', done: 'Recorded' };

/**
 * The built-in recorder: Record, Pause / Resume, Stop, then play the take back and add it as one audio
 * file (or record again). A live level meter shows the microphone is hearing you; the elapsed time counts
 * only while recording. The microphone (and any recording in progress) stops as soon as the dialog closes.
 */
export default function RecorderDialog({ open, onClose, onAdd }: RecorderDialogProps) {
  const access = useMediaStream('microphone', open);
  const stream = access.status === 'ready' ? access.stream : null;
  const [phase, setPhase] = useState<Phase>('ready');
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<File | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  // Recorded time before the current stretch, and when the current stretch began.
  const clock = useRef({ before: 0, since: 0 });
  const meter = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);

  // Closing (or losing the stream) throws away a recording in progress.
  useEffect(() => {
    return () => {
      const current = recorder.current;
      recorder.current = null;
      if (current && current.state !== 'inactive') {
        current.onstop = null;
        current.stop();
      }
    };
  }, [stream]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const tick = setInterval(() => setElapsed(clock.current.before + Date.now() - clock.current.since), TICK_MS);
    return () => clearInterval(tick);
  }, [phase]);

  // Level meter: the loudness of the microphone, drawn straight onto the bar without re-rendering.
  const listening = stream !== null && phase !== 'done';
  useEffect(() => {
    if (!listening || !stream || typeof AudioContext === 'undefined') return;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let level = 0;
    let frame = requestAnimationFrame(function draw() {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / samples.length);
      // Rises at once, falls back gently.
      level = Math.max(Math.min(1, rms * 5), level * 0.9);
      if (meter.current) meter.current.style.transform = `scaleX(${level.toFixed(3)})`;
      frame = requestAnimationFrame(draw);
    });
    return () => {
      cancelAnimationFrame(frame);
      void context.close();
    };
  }, [listening, stream]);

  const record = () => {
    if (!stream) return;
    const chunks: Blob[] = [];
    const next =
      typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(PREFERRED_TYPE)
        ? new MediaRecorder(stream, { mimeType: PREFERRED_TYPE })
        : new MediaRecorder(stream);
    next.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    next.onstop = () => {
      const { type, extension } = audioFileType(next.mimeType || chunks[0]?.type || '');
      setTake(new File(chunks, recordingName(startedAt.current, extension), { type }));
      setPhase('done');
    };
    recorder.current = next;
    startedAt.current = Date.now();
    clock.current = { before: 0, since: Date.now() };
    setElapsed(0);
    next.start(1000);
    setPhase('recording');
  };

  const pause = () => {
    recorder.current?.pause();
    clock.current.before += Date.now() - clock.current.since;
    setElapsed(clock.current.before);
    setPhase('paused');
  };

  const resume = () => {
    recorder.current?.resume();
    clock.current.since = Date.now();
    setPhase('recording');
  };

  const stop = () => {
    if (phase === 'recording') clock.current.before += Date.now() - clock.current.since;
    setElapsed(clock.current.before);
    recorder.current?.stop();
    recorder.current = null;
  };

  const reset = () => {
    setTake(null);
    setElapsed(0);
    setPhase('ready');
  };

  const dirty = phase !== 'ready';

  return (
    <MediaDialog
      open={open}
      title="Record audio"
      closeLabel="Close recorder"
      unavailableIcon={<MicOffOutlined />}
      access={access}
      discardPrompt={dirty ? 'Discard this recording?' : null}
      onClose={onClose}
      onExited={reset}
      actions={
        <Button
          variant="contained"
          disabled={take === null}
          onClick={() => {
            if (!take) return;
            onAdd(take);
            onClose();
          }}
        >
          Add recording
        </Button>
      }
    >
      <Stack
        sx={(theme) => ({
          alignItems: 'center',
          gap: 2,
          px: 2,
          py: { xs: 5, sm: 4 },
          my: { xs: 'auto', sm: 0 },
          borderRadius: `${theme.yungu.shape.large}px`,
          bgcolor: theme.yungu.color.surfaceContainerLow,
        })}
      >
        <Stack direction="row" aria-live="polite" sx={{ alignItems: 'center', gap: 1 }}>
          <StatusDot phase={phase} />
          <Typography variant="body2" sx={{ fontWeight: 500, color: phase === 'recording' ? 'error.dark' : 'text.secondary' }}>
            {access.status === 'starting' ? 'Starting microphone…' : STATUS[phase]}
          </Typography>
        </Stack>

        <Typography
          component="p"
          sx={{ fontSize: { xs: '3rem', sm: '3.5rem' }, fontWeight: 400, lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}
        >
          {formatElapsed(elapsed)}
        </Typography>

        {phase === 'done' && take ? (
          <Playback file={take} />
        ) : (
          <Box
            aria-hidden
            sx={(theme) => ({
              width: '100%',
              maxWidth: 280,
              height: 6,
              borderRadius: 3,
              overflow: 'hidden',
              bgcolor: alpha(theme.palette.text.primary, 0.1),
            })}
          >
            <Box
              ref={meter}
              sx={{
                height: '100%',
                bgcolor: phase === 'recording' ? 'error.main' : 'primary.main',
                transform: 'scaleX(0)',
                transformOrigin: 'left',
                opacity: listening ? 1 : 0,
              }}
            />
          </Box>
        )}

        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', justifyContent: 'center', minHeight: 40 }}>
          {phase === 'ready' && (
            <Button
              variant="contained"
              color="error"
              size="large"
              startIcon={access.status === 'starting' ? <CircularProgress size={18} color="inherit" aria-hidden /> : <FiberManualRecord />}
              onClick={record}
              disabled={!stream}
            >
              Record
            </Button>
          )}
          {phase === 'recording' && (
            <Button variant="outlined" size="large" startIcon={<PauseRounded />} onClick={pause}>
              Pause
            </Button>
          )}
          {phase === 'paused' && (
            <Button variant="outlined" size="large" startIcon={<PlayArrow />} onClick={resume}>
              Resume
            </Button>
          )}
          {(phase === 'recording' || phase === 'paused') && (
            <Button variant="contained" size="large" startIcon={<StopRounded />} onClick={stop}>
              Stop
            </Button>
          )}
          {phase === 'done' && (
            <Button startIcon={<Replay />} onClick={reset}>
              Record again
            </Button>
          )}
        </Stack>
      </Stack>
    </MediaDialog>
  );
}

/** Red while recording (a slow pulse, unless reduced motion is asked for), hollow otherwise. */
function StatusDot({ phase }: { phase: Phase }) {
  const on = phase === 'recording';
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        width: 10,
        height: 10,
        borderRadius: '50%',
        bgcolor: on ? theme.palette.error.main : 'transparent',
        border: on ? 'none' : `2px solid ${theme.palette.text.secondary}`,
        ...(on && {
          '@media (prefers-reduced-motion: no-preference)': { animation: 'yl-rec-pulse 1.6s ease-in-out infinite' },
          '@keyframes yl-rec-pulse': { '50%': { opacity: 0.35 } },
        }),
      })}
    />
  );
}

/** The take, playable; its object URL lives exactly as long as the player. */
function Playback({ file }: { file: File }) {
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (audio.current) audio.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <Box component="audio" ref={audio} controls aria-label="Play back the recording" sx={{ width: '100%', maxWidth: 360 }} />;
}
