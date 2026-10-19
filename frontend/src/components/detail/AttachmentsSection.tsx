import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { FileRef } from '@/lib/types';

/** Placeholder until Task 5 (inline previews and the full viewer): the teacher's files by name. */
export default function AttachmentsSection({ files }: { files: FileRef[] }) {
  if (files.length === 0) return null;
  return (
    <Box component="section" aria-labelledby="detail-attachments">
      <Typography id="detail-attachments" variant="h3" component="h3" sx={{ mb: 1 }}>
        Attachments ({files.length})
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 3 }}>
        {files.map((file) => (
          <Typography component="li" variant="body2" key={file.id} sx={{ overflowWrap: 'anywhere' }}>
            {file.name}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}
