'use client';
import { useContext, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import { OpenTaskContext } from './detail/useTaskParam';

interface CardOpenerProps {
  /** The assignment this card opens. */
  taskId: number;
  /** Lines of title shown before it is cut with an ellipsis. */
  lines: 1 | 2;
  children: ReactNode;
}

/**
 * A card's title as the button that opens its assignment. The button's hit area stretches over the
 * whole card (the card must be `position: relative`), so the card reads and clicks as one control
 * whose name is just the title; the hover state layer and the focus ring are drawn on the card's shape.
 */
export default function CardOpener({ taskId, lines, children }: CardOpenerProps) {
  const open = useContext(OpenTaskContext);
  return (
    <Box
      component="button"
      type="button"
      onClick={() => open(taskId)}
      sx={(theme) => ({
        display: 'block',
        width: '100%',
        p: 0,
        m: 0,
        border: 0,
        bgcolor: 'transparent',
        font: 'inherit',
        letterSpacing: 'inherit',
        color: 'inherit',
        textAlign: 'start',
        cursor: 'pointer',
        '&::after': {
          content: '""',
          position: 'absolute',
          inset: 0,
          borderRadius: `${theme.shape.borderRadius}px`,
          transition: theme.transitions.create('background-color', { duration: theme.transitions.duration.shortest }),
        },
        '&:hover::after': { bgcolor: 'action.hover' },
        '&:active::after': { bgcolor: 'action.selected' },
        '&:focus-visible': { outline: 'none' },
        '&:focus-visible::after': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
        '@media (prefers-reduced-motion: reduce)': { '&::after': { transition: 'none' } },
      })}
    >
      <Box
        component="span"
        sx={
          lines === 1
            ? { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
            : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
        }
      >
        {children}
      </Box>
    </Box>
  );
}
