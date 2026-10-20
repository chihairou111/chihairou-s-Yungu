import { useId } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { chinaDueLabel } from '@/lib/time';
import type { Feedback } from '@/lib/types';
import { VISUALLY_HIDDEN } from '../visually-hidden';

/** Scores longer than this ("Extraordinary [5]") are set smaller, so a level name fits the column. */
const SHORT_SCORE = 7;

/**
 * The teacher's grade above Your work: the score large, when it was given, the teacher's written
 * feedback (line breaks kept) and each rubric criterion's level. Not rendered before grading.
 */
export default function FeedbackSection({ feedback }: { feedback: Feedback | null | undefined }) {
  const headingId = useId();
  if (!feedback) return null;
  const { score, comment, criteria, updatedAt } = feedback;
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-labelledby={headingId}
      sx={(theme) => ({ p: 2.5, borderRadius: `${theme.yungu.shape.large}px` })}
    >
      <Typography id={headingId} variant="h3" component="h3">
        Feedback
      </Typography>
      {updatedAt !== null && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Graded {chinaDueLabel(updatedAt)}
        </Typography>
      )}
      {score && (
        <Typography
          component="p"
          sx={{
            mt: 1.5,
            fontSize: score.length > SHORT_SCORE ? '1.375rem' : '2rem',
            lineHeight: 1.2,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            color: 'primary.main',
            overflowWrap: 'anywhere',
          }}
        >
          <Box component="span" sx={VISUALLY_HIDDEN}>
            Score:
          </Box>{' '}
          {score}
        </Typography>
      )}
      {comment && (
        <Typography variant="body2" sx={{ mt: 1.5, whiteSpace: 'pre-line', overflowWrap: 'anywhere', textWrap: 'pretty' }}>
          {comment}
        </Typography>
      )}
      {criteria.length > 0 && (
        <Stack
          component="ul"
          aria-label="Criteria"
          sx={(theme) => ({
            listStyle: 'none',
            m: 0,
            p: 0,
            mt: 2,
            pt: 1.5,
            gap: 1.25,
            borderTop: `1px solid ${theme.yungu.color.outlineVariant}`,
          })}
        >
          {criteria.map((c, i) => (
            <Box component="li" key={`${i}-${c.name}`}>
              <Stack direction="row" sx={{ gap: 1.5, alignItems: 'baseline', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 0, overflowWrap: 'anywhere' }}>
                  {c.name}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, color: 'primary.main', flexShrink: 0, maxWidth: '50%', textAlign: 'end' }}>
                  {c.result}
                </Typography>
              </Stack>
              {c.description && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, textWrap: 'pretty' }}>
                  {c.description}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Paper>
  );
}
