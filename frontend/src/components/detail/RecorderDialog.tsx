'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
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

/** `stopping`: Stop was pressed and the recorder is still handing over its data; the clock is frozen. */
type Phase = 'ready' | 'recording' | 'paused' | 'stopping' | 'done';

/** Asked for first; a browser that cannot record it uses its own format (and the file name follows). */
const PREFERRED_TYPE = 'audio/webm';
const TICK_MS = 250;

const STATUS: Record<Phase, string> = { ready: 'Ready', recording: 'Recording', paused: 'Paused', stopping: 'Finishing…', done: 'Recorded' };

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
  const [problem, setProblem] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  // Recorded time before the current stretch, and when the current stretch began.
  const clock = useRef({ before: 0, since: 0 });
  const meter = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);
  const recordButton = useRef<HTMLButtonElement>(null);
  const toggleButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // The control that takes focus once the next phase has rendered (the one pressed may be gone or disabled).
  const focusNext = useRef<RefObject<HTMLButtonElement | null> | null>(null);
  // Record takes focus once the microphone is ready, once per opening.
  const greeted = useRef(false);

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    target?.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (!stream || greeted.current) return;
    greeted.current = true;
    recordButton.current?.focus();
  }, [stream]);

  // Closing (or losing the stream) throws away a recording in progress, and a take still being handed
  // over after Stop: its data must not turn up as a finished take the next time the dialog opens.
  useEffect(() => {
    return () => {
      const current = recorder.current;
      recorder.current = null;
      if (!current) return;
      current.ondataavailable = null;
      current.onstop = null;
      if (current.state !== 'inactive') current.stop();
    };
  }, [stream]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const tick = setInterval(() => setElapsed(clock.current.before + Date.now() - clock.current.since), TICK_MS);
    return () => clearInterval(tick);
  }, [phase]);

  // Level meter: the loudness of the microphone, drawn straight onto the bar without re-rendering.
  const listening = stream !== null && (phase === 'ready' || phase === 'recording' || phase === 'paused');
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
    let next: MediaRecorder;
    try {
      next =
        typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(PREFERRED_TYPE)
          ? new MediaRecorder(stream, { mimeType: PREFERRED_TYPE })
          : new MediaRecorder(stream);
      next.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      next.onstop = () => {
        recorder.current = null;
        // The clock was frozen at Stop; the data arrives only now.
        setElapsed(clock.current.before);
        if (chunks.length === 0) {
          setProblem('Nothing was recorded. Try again.');
          focusNext.current = recordButton;
          setPhase('ready');
          return;
        }
        const { type, extension } = audioFileType(next.mimeType || chunks[0].type || '');
        setTake(new File(chunks, recordingName(startedAt.current, extension), { type }));
        focusNext.current = addButton;
        setPhase('done');
      };
      next.start(1000);
    } catch {
      setProblem('Couldn’t start recording in this browser.');
      return;
    }
    recorder.current = next;
    startedAt.current = Date.now();
    clock.current = { before: 0, since: Date.now() };
    setProblem(null);
    setElapsed(0);
    focusNext.current = toggleButton;
    setPhase('recording');
  };

  const togglePause = () => {
    if (phase === 'recording') {
      recorder.current?.pause();
      clock.current.before += Date.now() - clock.current.since;
      setElapsed(clock.current.before);
      setPhase('paused');
    } else if (phase === 'paused') {
      recorder.current?.resume();
      clock.current.since = Date.now();
      setPhase('recording');
    }
  };

  const stop = () => {
    if (phase !== 'recording' && phase !== 'paused') return;
    if (phase === 'recording') clock.current.before += Date.now() - clock.current.since;
    setElapsed(clock.current.before);
    setPhase('stopping');
    // Kept until its data arrives (onstop), so closing meanwhile can still disown it.
    recorder.current?.stop();
  };

  const reset = () => {
    setTake(null);
    setProblem(null);
    setElapsed(0);
    setPhase('ready');
  };

  const dirty = phase !== 'ready';
  const running = phase === 'recording' || phase === 'paused' || phase === 'stopping';

  return (
    <MediaDialog
      open={open}
      title="Record audio"
      closeLabel="Close recorder"
      unavailableIcon={<MicOffOutlined />}
      access={access}
      discardPrompt={dirty ? 'Discard this recording?' : null}
      onClose={onClose}
      onExited={() => {
        greeted.current = false;
        reset();
      }}
      actions={
        <Button
          ref={addButton}
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

        {problem && (
          <Typography role="alert" variant="body2" sx={{ color: 'error.dark', textAlign: 'center' }}>
            {problem}
          </Typography>
        )}

        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', justifyContent: 'center', minHeight: 40 }}>
          {phase === 'ready' && (
            <Button
              ref={recordButton}
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
          {running && (
            <>
              {/* One element for Pause and Resume, so focus stays on it as it flips. */}
              <Button
                ref={toggleButton}
                variant="outlined"
                size="large"
                startIcon={phase === 'paused' ? <PlayArrow /> : <PauseRounded />}
                onClick={togglePause}
                disabled={phase === 'stopping'}
              >
                {phase === 'paused' ? 'Resume' : 'Pause'}
              </Button>
              <Button variant="contained" size="large" startIcon={<StopRounded />} onClick={stop} disabled={phase === 'stopping'}>
                Stop
              </Button>
            </>
          )}
          {phase === 'done' && (
            <Button
              startIcon={<Replay />}
              onClick={() => {
                focusNext.current = recordButton;
                reset();
              }}
            >
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
