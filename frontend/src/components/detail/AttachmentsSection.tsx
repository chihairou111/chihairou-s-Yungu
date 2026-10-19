'use client';
import { useId, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { FileRef } from '@/lib/types';
import FileThumb from './FileThumb';
import FileViewer from './FileViewer';

/**
 * The teacher's files as a grid of rendered previews under the instructions; a tile opens the
 * full-screen viewer on that file. Tiles are at least 180px and share each row, so any number of
 * files wraps without sideways scrolling. Hidden when there are none.
 */
export default function AttachmentsSection({ files }: { files: FileRef[] }) {
  const headingId = useId();
  const [viewing, setViewing] = useState<number | null>(null);
  // Remembered after closing so the viewer keeps its content while it fades out.
  const [lastViewed, setLastViewed] = useState(0);

  if (files.length === 0) return null;

  const open = (index: number) => {
    setViewing(index);
    setLastViewed(index);
  };

  return (
    <Box component="section" aria-labelledby={headingId}>
      <Typography id={headingId} variant="h3" component="h3" sx={{ mb: 1.5 }}>
        Attachments ({files.length})
      </Typography>
      <Box
        component="ul"
        sx={(theme) => ({
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 1.5,
          // A phone fits only one 180px column, which makes each preview a screen tall; two per row instead.
          [theme.breakpoints.down('sm')]: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
        })}
      >
        {files.map((file, i) => (
          <Box component="li" key={file.id} sx={{ minWidth: 0, display: 'flex' }}>
            <FileThumb file={file} onOpen={() => open(i)} />
          </Box>
        ))}
      </Box>
      <FileViewer
        files={files}
        open={viewing !== null}
        index={viewing ?? lastViewed}
        onIndexChange={open}
        onClose={() => setViewing(null)}
      />
    </Box>
  );
}
