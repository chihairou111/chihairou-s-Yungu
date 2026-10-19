import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import EditNote from '@mui/icons-material/EditNoteOutlined';
import type { AssignmentDetail } from '@/lib/types';

interface YourWorkProps {
  detail: AssignmentDetail;
  onWrite: () => void;
}

/** Placeholder until Task 6 (files, Record / Camera / Write / Upload, Submit): status and the way into Write. */
export default function YourWork({ detail, onWrite }: YourWorkProps) {
  return (
    <>
      <Typography variant="h3" component="h3">
        Your work
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {detail.submitted ? 'Submitted' : 'Not submitted'}
        {detail.myFiles.length > 0 && ` · ${detail.myFiles.length} ${detail.myFiles.length === 1 ? 'file' : 'files'}`}
      </Typography>
      <Button variant="outlined" startIcon={<EditNote />} onClick={onWrite} sx={{ mt: 2 }}>
        Write
      </Button>
    </>
  );
}
