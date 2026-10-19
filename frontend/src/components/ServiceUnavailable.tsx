import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloudOffOutlined from '@mui/icons-material/CloudOffOutlined';

/** In place of a page's content when Yungu cannot be reached; the app bar and navigation stay. */
export default function ServiceUnavailable({ message }: { message: string }) {
  return (
    <Stack sx={{ alignItems: 'center', textAlign: 'center', py: 6, mx: 'auto', maxWidth: 360 }}>
      <CloudOffOutlined aria-hidden sx={{ fontSize: 40, color: 'text.secondary', mb: 1.5 }} />
      <Typography variant="h3" component="h2">
        {message}
      </Typography>
    </Stack>
  );
}
