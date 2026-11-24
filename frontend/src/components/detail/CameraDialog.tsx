'use client';
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Fab from '@mui/material/Fab';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Close from '@mui/icons-material/Close';
import NoPhotographyOutlined from '@mui/icons-material/NoPhotographyOutlined';
import PhotoCamera from '@mui/icons-material/PhotoCamera';
import MediaDialog from './MediaDialog';
import { photoName, useMediaStream } from './media';

interface CameraDialogProps {
  open: boolean;
  onClose: () => void;
  /** The photos taken, each its own JPEG file, in the order taken. */
  onAdd: (files: File[]) => void;
}

interface Photo {
  id: number;
  file: File;
}

const JPEG_QUALITY = 0.9;
const THUMB_PX = 64;

const plural = (n: number) => `${n} photo${n === 1 ? '' : 's'}`;

/** Two photos in the same second get "(2)", "(3)"… so every file name is distinct. */
function uniqueName(name: string, taken: Photo[]): string {
  const names = new Set(taken.map((p) => p.file.name));
  if (!names.has(name)) return name;
  const stem = name.replace(/\.jpg$/, '');
  let n = 2;
  while (names.has(`${stem} (${n}).jpg`)) n++;
  return `${stem} (${n}).jpg`;
}

/**
 * The built-in camera: a live preview (the rear camera on phones; a user-facing camera is mirrored, the
 * photo is not), a shutter, and a strip of the photos taken so far, each removable. "Add N photos" hands
 * them over as separate JPEG files. The camera is released as soon as the dialog closes.
 */
export default function CameraDialog({ open, onClose, onAdd }: CameraDialogProps) {
  const access = useMediaStream('camera', open);
  const stream = access.status === 'ready' ? access.stream : null;
  const video = useRef<HTMLVideoElement>(null);
  const shutter = useRef<HTMLButtonElement>(null);
  const strip = useRef<HTMLUListElement>(null);
  const nextId = useRef(0);
  const [photos, setPhotos] = useState<Photo[]>([]);
  // The preview reports its frame size once it plays; until then there is nothing to photograph.
  const [frame, setFrame] = useState<{ stream: MediaStream; width: number; height: number } | null>(null);
  const [flashes, setFlashes] = useState(0);
  // Photos still being encoded; Add waits for them.
  const [pending, setPending] = useState(0);
  // Bumped on every close, so an encode finishing after it is not added to the next opening.
  const session = useRef(0);
  const greeted = useRef(false);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  // The newest photo scrolls into view at the end of the strip.
  useEffect(() => {
    const el = strip.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [photos.length]);

  const facing = stream?.getVideoTracks()[0]?.getSettings().facingMode;
  const mirrored = facing !== 'environment';
  const live = stream !== null && frame?.stream === stream;

  // The shutter takes focus once the preview is live, once per opening.
  useEffect(() => {
    if (!live || greeted.current) return;
    greeted.current = true;
    shutter.current?.focus();
  }, [live]);

  const take = () => {
    const el = video.current;
    if (!el || !live) return;
    const canvas = document.createElement('canvas');
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    canvas.getContext('2d')?.drawImage(el, 0, 0, canvas.width, canvas.height);
    const takenAt = Date.now();
    const opening = session.current;
    setPending((n) => n + 1);
    // Each tap draws its own frame at once; encoding finishes in the background, so quick taps all count.
    setFlashes((n) => n + 1);
    canvas.toBlob(
      (blob) => {
        if (opening !== session.current) return;
        setPending((n) => n - 1);
        if (!blob) return;
        setPhotos((taken) => [
          ...taken,
          { id: nextId.current++, file: new File([blob], uniqueName(photoName(takenAt), taken), { type: 'image/jpeg', lastModified: takenAt }) },
        ]);
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  };

  const remove = (index: number) => {
    const after = photos[index + 1] ?? photos[index - 1];
    setPhotos((taken) => taken.filter((_, i) => i !== index));
    // Focus moves to the neighbour's ✕, or back to the shutter when the strip empties.
    requestAnimationFrame(() => {
      const next = after && strip.current?.querySelector<HTMLElement>(`[data-photo-id="${after.id}"]`);
      (next ?? shutter.current)?.focus();
    });
  };

  const count = photos.length;

  return (
    <MediaDialog
      open={open}
      title="Camera"
      closeLabel="Close camera"
      unavailableIcon={<NoPhotographyOutlined />}
      access={access}
      discardPrompt={count > 0 ? `Discard ${plural(count)}?` : null}
      onClose={onClose}
      onExited={() => {
        session.current++;
        greeted.current = false;
        setPending(0);
        setPhotos([]);
        setFrame(null);
        setFlashes(0);
      }}
      actions={
        <Button
          variant="contained"
          disabled={count === 0 || pending > 0}
          onClick={() => {
            onAdd(photos.map((p) => p.file));
            onClose();
          }}
        >
          {count === 0 ? 'Add photos' : `Add ${plural(count)}`}
        </Button>
      }
    >
      <Box
        sx={(theme) => ({
          position: 'relative',
          flexShrink: 0,
          overflow: 'hidden',
          borderRadius: `${theme.yungu.shape.large}px`,
          // A viewfinder is black in either theme; the picture decides the colours.
          bgcolor: '#000',
          // The camera's own shape once it is known (4:3 until then), capped so the controls stay in view.
          aspectRatio: live && frame ? `${frame.width} / ${frame.height}` : '4 / 3',
          maxHeight: { xs: 'none', sm: '52vh' },
          [theme.breakpoints.down('sm')]: { flex: 1, aspectRatio: 'auto', minHeight: 240 },
        })}
      >
        <Box
          component="video"
          ref={video}
          autoPlay
          muted
          playsInline
          aria-label="Camera preview"
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            if (stream) setFrame({ stream, width: el.videoWidth || 4, height: el.videoHeight || 3 });
          }}
          sx={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            transform: mirrored ? 'scaleX(-1)' : undefined,
          }}
        />
        {!live && (
          <Stack
            role="status"
            sx={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: 1.5, color: 'rgba(255,255,255,0.86)' }}
          >
            {access.status === 'starting' || stream ? (
              <>
                <CircularProgress size={28} color="inherit" aria-hidden />
                <Typography variant="body2" color="inherit">
                  Starting camera…
                </Typography>
              </>
            ) : null}
          </Stack>
        )}
        {flashes > 0 && (
          <Box
            key={flashes}
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              bgcolor: '#fff',
              opacity: 0,
              pointerEvents: 'none',
              '@media (prefers-reduced-motion: no-preference)': {
                animation: 'yl-shutter 320ms cubic-bezier(0.16, 1, 0.3, 1)',
              },
              '@keyframes yl-shutter': { from: { opacity: 0.75 }, to: { opacity: 0 } },
            }}
          />
        )}
      </Box>

      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'center', py: 2, flexShrink: 0 }}>
        <Fab ref={shutter} color="primary" aria-label="Take photo" onClick={take} disabled={!live}>
          <PhotoCamera />
        </Fab>
      </Stack>

      {/* Room for the strip is kept from the start, so the dialog does not grow under the pointer. */}
      <Box sx={{ flexShrink: 0, minHeight: { sm: THUMB_PX + 34 } }}>
        <Typography variant="body2" color="text.secondary" aria-live="polite" sx={{ mb: 1 }}>
          {count === 0 ? 'Each photo is added as its own image.' : `${plural(count)} taken`}
        </Typography>
        {count > 0 && (
          <Stack
            component="ul"
            ref={strip}
            direction="row"
            aria-label="Photos taken"
            sx={{ listStyle: 'none', m: 0, p: 0, pt: 0.75, pr: 0.75, gap: 1, overflowX: 'auto', overscrollBehaviorX: 'contain' }}
          >
            {photos.map((photo, i) => (
              <Box component="li" key={photo.id} sx={{ position: 'relative', flexShrink: 0 }}>
                <Thumb file={photo.file} />
                <IconButton
                  size="small"
                  aria-label={`Remove photo ${i + 1}`}
                  data-photo-id={photo.id}
                  onClick={() => remove(i)}
                  sx={(theme) => ({
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    p: 0.25,
                    bgcolor: theme.vars.palette.text.primary,
                    // Cut out of the photo in the dialog's own surface colour.
                    color: theme.yungu.dialog.bg,
                    border: `2px solid ${theme.yungu.dialog.bg}`,
                    '&:hover': { bgcolor: theme.vars.palette.text.primary },
                    // A bigger hit area than the 20px badge it draws.
                    '&::after': { content: '""', position: 'absolute', inset: -8 },
                    '& svg': { fontSize: 14 },
                  })}
                >
                  <Close />
                </IconButton>
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </MediaDialog>
  );
}

/** One photo in the strip; its object URL lives exactly as long as the thumbnail. */
function Thumb({ file }: { file: File }) {
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (img.current) img.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <Box
      component="img"
      ref={img}
      alt=""
      sx={(theme) => ({
        display: 'block',
        width: THUMB_PX,
        height: THUMB_PX,
        objectFit: 'cover',
        borderRadius: `${theme.yungu.shape.small}px`,
        bgcolor: theme.yungu.color.surfaceContainerHigh,
      })}
    />
  );
}
