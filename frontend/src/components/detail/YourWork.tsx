'use client';
import { useEffect, useRef, useState, type DragEvent, type ReactElement, type ReactNode, type Ref } from 'react';
import Link from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha, type Theme } from '@mui/material/styles';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutlineOutlined';
import Close from '@mui/icons-material/Close';
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined';
import FileUploadOutlined from '@mui/icons-material/FileUploadOutlined';
import MicNoneOutlined from '@mui/icons-material/MicNoneOutlined';
import PhotoCameraOutlined from '@mui/icons-material/PhotoCameraOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import { chinaDueLabel } from '@/lib/time';
import type { FileRef } from '@/lib/types';
import { FileKindIcon, fileCaption, formatBytes } from './FileThumb';
import FileViewer from './FileViewer';
import type { PendingUpload, WorkStatus } from './useWork';
import { useWorkContext } from './WorkContext';

interface YourWorkProps {
  /** Opens the recorder (Task 8). */
  onRecord?: () => void;
  /** Opens the camera (Task 8). */
  onCamera?: () => void;
  /** Switches the pop-up to the writing view. */
  onWrite: () => void;
}

const noop = () => {};

/**
 * The student's side of the assignment: status, the files added so far (each opens in the viewer and
 * can be removed), the four ways to add work (Record, Camera, Write, Upload) and Submit, which reads
 * Update once the work has been handed in. Files can also be dropped anywhere on the panel. The work
 * itself lives in the `WorkProvider` above, so it survives a trip to the writer.
 */
export default function YourWork({ onRecord = noop, onCamera = noop, onWrite }: YourWorkProps) {
  const work = useWorkContext();
  const input = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // Where focus goes once a removed row has left: the next row's ✕, else the previous one's, else Upload.
  const focusAfterRemove = useRef<string | null>(null);
  useEffect(() => {
    const target = focusAfterRemove.current;
    if (target === null) return;
    focusAfterRemove.current = null;
    const removeButton = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-remove-id]') ?? []).find(
      (el) => el.dataset.removeId === target,
    );
    (removeButton ?? uploadButton.current)?.focus();
  }, [work.files]);
  const [viewing, setViewing] = useState<number | null>(null);
  const [lastViewed, setLastViewed] = useState(0);
  const [dragging, setDragging] = useState(false);

  const open = (index: number) => {
    setViewing(index);
    setLastViewed(index);
  };

  const addAll = (picked: FileList | null) => {
    if (work.submitting || !picked || picked.length === 0) return;
    void work.addFiles(Array.from(picked));
  };

  const removeAt = (index: number) => {
    const { files } = work;
    focusAfterRemove.current = files[index + 1]?.id ?? files[index - 1]?.id ?? '';
    void work.remove(files[index].id);
  };

  const carriesFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');

  const submitted = work.status !== 'not-submitted';
  const empty = work.files.length === 0 && work.uploads.length === 0;

  return (
    <Box
      onDragEnter={(e) => carriesFiles(e) && !work.submitting && setDragging(true)}
      onDragOver={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        addAll(e.dataTransfer.files);
      }}
      // Fills the whole panel (its padding included), so a drop anywhere on it counts.
      sx={(theme) => ({
        m: -2.5,
        p: 2.5,
        borderRadius: 'inherit',
        outline: '2px dashed transparent',
        outlineOffset: -6,
        transition: theme.transitions.create(['outline-color', 'background-color'], { duration: theme.transitions.duration.shorter }),
        ...(dragging && { outlineColor: theme.palette.primary.main, bgcolor: alpha(theme.palette.primary.main, 0.06) }),
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      })}
    >
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h3" component="h3">
          Your work
        </Typography>
        <Box aria-live="polite">
          <StatusChip status={work.status} />
        </Box>
      </Stack>
      {work.submittedAt !== undefined && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Handed in {chinaDueLabel(work.submittedAt)}
        </Typography>
      )}

      {empty ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={(theme) => ({
            mt: 2,
            px: 2,
            py: 2.5,
            textAlign: 'center',
            textWrap: 'pretty',
            borderRadius: `${theme.yungu.shape.medium}px`,
            border: `1px dashed ${theme.yungu.color.outlineVariant}`,
          })}
        >
          Nothing added yet. Record, take photos, write, or upload files — or drop them here.
        </Typography>
      ) : (
        <Stack component="ul" ref={list} aria-label="Your files" sx={{ listStyle: 'none', m: 0, p: 0, mt: 2, gap: 0.5 }}>
          {work.files.map((file, i) => (
            <FileRow key={file.id} file={file} onOpen={() => open(i)} onRemove={() => removeAt(i)} disabled={work.submitting} />
          ))}
          {work.uploads.map((upload) => (
            <UploadRow key={upload.key} upload={upload} />
          ))}
        </Stack>
      )}

      {work.error && (
        <Alert
          severity="error"
          onClose={work.sessionEnded ? undefined : work.dismissError}
          action={
            work.sessionEnded ? (
              <Button color="inherit" size="small" component={Link} href="/login">
                Sign in
              </Button>
            ) : undefined
          }
          sx={{ mt: 2, bgcolor: 'error.light', color: 'error.dark', '& .MuiAlert-icon': { color: 'error.main' } }}
        >
          {work.errors.length === 1 ? (
            work.errors[0]
          ) : (
            <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
              {work.errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </Box>
          )}
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, mt: 2.5 }}>
        <AddButton icon={<MicNoneOutlined />} onClick={onRecord} disabled={work.submitting}>
          Record
        </AddButton>
        <AddButton icon={<PhotoCameraOutlined />} onClick={onCamera} disabled={work.submitting}>
          Camera
        </AddButton>
        <AddButton icon={<EditNoteOutlined />} onClick={onWrite} disabled={work.submitting}>
          Write
        </AddButton>
        <AddButton
          icon={<FileUploadOutlined />}
          onClick={() => input.current?.click()}
          disabled={work.submitting}
          buttonRef={uploadButton}
        >
          Upload
        </AddButton>
      </Box>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        onChange={(e) => {
          addAll(e.currentTarget.files);
          e.currentTarget.value = '';
        }}
      />

      {/* While it works the button stays focusable (aria-disabled), so focus is not thrown to the page. */}
      <Button
        variant="contained"
        size="large"
        fullWidth
        disabled={work.files.length === 0 || work.uploads.length > 0}
        aria-disabled={work.submitting || undefined}
        onClick={() => {
          if (!work.submitting) void work.submit();
        }}
        startIcon={work.submitting ? <CircularProgress size={18} color="inherit" aria-hidden /> : undefined}
        sx={{ mt: 2 }}
      >
        {work.submitting ? (submitted ? 'Updating…' : 'Submitting…') : submitted ? 'Update' : 'Submit'}
      </Button>

      <FileViewer
        files={work.files}
        open={viewing !== null && work.files.length > 0}
        index={Math.min(viewing ?? lastViewed, Math.max(0, work.files.length - 1))}
        onIndexChange={open}
        onClose={() => setViewing(null)}
      />
    </Box>
  );
}

const STATUS: Record<WorkStatus, { label: string; icon?: ReactElement; sx: (theme: Theme) => object }> = {
  'not-submitted': {
    label: 'Not submitted',
    sx: (theme) => ({ bgcolor: alpha(theme.palette.text.primary, 0.07), color: theme.yungu.color.onSurfaceVariant }),
  },
  submitted: {
    label: 'Submitted',
    icon: <CheckCircleOutline />,
    sx: (theme) => ({ bgcolor: alpha(theme.palette.success.main, 0.12), color: theme.palette.success.dark }),
  },
  late: {
    label: 'Submitted late',
    icon: <ScheduleOutlined />,
    sx: (theme) => ({ bgcolor: theme.palette.warning.light, color: theme.palette.warning.dark }),
  },
};

function StatusChip({ status }: { status: WorkStatus }) {
  const { label, icon, sx } = STATUS[status];
  return (
    <Chip
      size="small"
      label={label}
      icon={icon}
      sx={(theme) => ({ fontWeight: 600, '& .MuiChip-icon': { color: 'inherit', fontSize: 16 }, ...sx(theme) })}
    />
  );
}

interface AddButtonProps {
  icon: ReactNode;
  onClick: () => void;
  disabled: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  children: string;
}

function AddButton({ icon, onClick, disabled, buttonRef, children }: AddButtonProps) {
  return (
    <Button ref={buttonRef} variant="outlined" startIcon={icon} onClick={onClick} disabled={disabled} sx={{ justifyContent: 'flex-start', px: 1.75, minHeight: 40 }}>
      {children}
    </Button>
  );
}

const PREVIEW_PX = 40;

/** The small square at the start of a row: the image itself, or the file type's icon. */
function RowPreview({ file, children }: { file?: FileRef; children?: ReactNode }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({
        flexShrink: 0,
        width: PREVIEW_PX,
        height: PREVIEW_PX,
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        borderRadius: `${theme.yungu.shape.small}px`,
        bgcolor: alpha(theme.palette.text.primary, 0.06),
        color: theme.yungu.color.onSurfaceVariant,
        '& svg': { fontSize: 22 },
      })}
    >
      {file?.kind === 'image' ? (
        <Box component="img" src={file.url} alt="" loading="lazy" decoding="async" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : file ? (
        <FileKindIcon file={file} />
      ) : (
        children
      )}
    </Box>
  );
}

function RowText({ name, caption }: { name: string; caption: string }) {
  return (
    <Box component="span" sx={{ display: 'block', minWidth: 0, flex: 1 }}>
      <Typography component="span" variant="body2" title={name} noWrap sx={{ display: 'block', fontWeight: 500 }}>
        {name}
      </Typography>
      <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {caption}
      </Typography>
    </Box>
  );
}

const rowLayoutSx = (theme: Theme) => ({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 1.5,
  p: 0.75,
  textAlign: 'left',
  borderRadius: `${theme.yungu.shape.medium}px`,
});

const rowSx = (theme: Theme) => ({
  ...rowLayoutSx(theme),
  '@media (hover: hover)': { '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.05) } },
});

function FileRow({ file, onOpen, onRemove, disabled }: { file: FileRef; onOpen: () => void; onRemove: () => void; disabled: boolean }) {
  const caption = fileCaption(file);
  return (
    <Stack component="li" direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
      <ButtonBase onClick={onOpen} data-file-id={file.id} aria-label={`${file.name}, ${caption}`} sx={rowSx}>
        <RowPreview file={file} />
        <RowText name={file.name} caption={caption} />
      </ButtonBase>
      <IconButton aria-label={`Remove ${file.name}`} data-remove-id={file.id} onClick={onRemove} disabled={disabled} size="small" sx={{ flexShrink: 0 }}>
        <Close fontSize="small" />
      </IconButton>
    </Stack>
  );
}

function UploadRow({ upload }: { upload: PendingUpload }) {
  return (
    <Stack component="li" direction="row" aria-busy sx={{ alignItems: 'center', gap: 0.5 }}>
      <Box sx={rowLayoutSx}>
        <RowPreview>
          <CircularProgress size={20} aria-label={`Uploading ${upload.name}`} />
        </RowPreview>
        <RowText name={upload.name} caption={`Uploading · ${formatBytes(upload.size)}`} />
      </Box>
      {/* Keeps the name lined up with the rows that have a remove button. */}
      <Box sx={{ width: 34, flexShrink: 0 }} />
    </Stack>
  );
}
