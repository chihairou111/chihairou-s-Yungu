import type { Metadata } from 'next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LoginCard from '@/components/LoginCard';
import LoginForm from '@/components/LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <Box
      component="main"
      sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', px: 2, py: 4, bgcolor: 'background.default' }}
    >
      <LoginCard>
        <Typography variant="h1" sx={{ fontSize: '1.5rem' }}>
          Yungu
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
          Sign in with your Yungu account
        </Typography>
        <LoginForm />
      </LoginCard>
    </Box>
  );
}
