'use client';
import type { ReactNode } from 'react';
import Paper from '@mui/material/Paper';

/** The sign-in panel; its corner and shadow follow the current style. On phones the form sits on the page, frameless. */
export default function LoginCard({ children }: { children: ReactNode }) {
  return (
    <Paper
      variant="outlined"
      sx={({ breakpoints, yungu: { loginCard } }) => ({
        width: '100%',
        maxWidth: 400,
        p: 4,
        borderRadius: `${loginCard.radius}px`,
        boxShadow: loginCard.shadow,
        [breakpoints.down('sm')]: { p: 0, border: 'none', boxShadow: 'none', bgcolor: 'transparent' },
      })}
    >
      {children}
    </Paper>
  );
}
