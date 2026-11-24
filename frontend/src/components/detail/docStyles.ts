import { type Theme } from '@mui/material/styles';

/** Styles an online document shares between the writer and its preview. */

/** A quoted line: set in from the text with a hairline beside it, a step quieter — shared with the preview. */
export function quoteSx(theme: Theme) {
  return {
    margin: '0 0 0.85em',
    paddingLeft: '1em',
    borderLeft: `1px solid ${theme.vars.palette.text.disabled}`,
    color: theme.vars.palette.text.secondary,
    '& > :last-child': { marginBottom: 0 },
  };
}

/** A Yungu media block (image, video, file, audio) that is kept but not shown here: a quiet labelled chip. */
export function embedSx(theme: Theme) {
  return {
    display: 'block',
    width: 'fit-content',
    maxWidth: '100%',
    margin: '0 0 0.85em',
    padding: '4px 10px',
    ...theme.typography.body2,
    color: theme.vars.palette.text.secondary,
    backgroundColor: theme.alpha(theme.vars.palette.text.primary, 0.05),
    border: `1px solid ${theme.yungu.color.outlineVariant}`,
    borderRadius: `${theme.yungu.shape.small}px`,
    userSelect: 'none' as const,
    cursor: 'default',
  };
}

/** Struck-through text: a line heavy enough to read across Chinese characters' own horizontal strokes. */
export const strikeSx = { textDecorationLine: 'line-through', textDecorationThickness: '0.09em' } as const;
