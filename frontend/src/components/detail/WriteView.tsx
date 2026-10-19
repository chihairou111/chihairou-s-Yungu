import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowBack from '@mui/icons-material/ArrowBack';
import type { AssignmentDetail } from '@/lib/types';

interface WriteViewProps {
  detail: AssignmentDetail;
  onBack: () => void;
}

/** Placeholder until Task 7 (Tiptap editor → PDF): the writing view's bar with the way back. */
export default function WriteView({ detail, onBack }: WriteViewProps) {
  return (
    <Stack sx={{ flex: 1, minHeight: 0 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, px: { xs: 1, sm: 2 }, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <IconButton onClick={onBack} aria-label="Back to the assignment">
          <ArrowBack />
        </IconButton>
        <Typography variant="h3" component="h2" noWrap sx={{ flex: 1, minWidth: 0 }}>
          Write · {detail.title}
        </Typography>
      </Stack>
      <Box sx={{ flex: 1, p: 3 }}>
        <Typography variant="body2" color="text.secondary">
          The editor opens here.
        </Typography>
      </Box>
    </Stack>
  );
}
