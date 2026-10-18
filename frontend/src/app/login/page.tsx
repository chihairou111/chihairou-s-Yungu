import type { Metadata } from 'next';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import LoginForm from '@/components/LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <Box
      component="main"
      sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', px: 2, py: 4, bgcolor: 'background.default' }}
    >
      <Paper
        variant="outlined"
        sx={{
          width: '100%',
          maxWidth: 400,
          p: { xs: 3, sm: 4 },
          boxShadow: '0 1px 2px rgba(16, 24, 40, 0.04), 0 12px 32px rgba(16, 24, 40, 0.06)',
        }}
      >
        <Typography variant="h1" sx={{ fontSize: '1.5rem' }}>
          Yungu
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
          Sign in with your Yungu account
        </Typography>
        <LoginForm />
      </Paper>
    </Box>
  );
}
