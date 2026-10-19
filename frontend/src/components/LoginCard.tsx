'use client';
import type { ReactNode } from 'react';
import Paper from '@mui/material/Paper';

/** The sign-in panel; its corner and shadow follow the current style. */
export default function LoginCard({ children }: { children: ReactNode }) {
  return (
    <Paper
      variant="outlined"
      sx={({ yungu: { loginCard } }) => ({
        width: '100%',
        maxWidth: 400,
        p: { xs: 3, sm: 4 },
        borderRadius: `${loginCard.radius}px`,
        boxShadow: loginCard.shadow,
      })}
    >
      {children}
    </Paper>
  );
}
