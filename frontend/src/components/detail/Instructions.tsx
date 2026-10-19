'use client';
import { useEffect, useId, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';

/** Instructions taller than this start collapsed, so attachments stay within reach. */
export const COLLAPSED_PX = 240;

/**
 * Shifts the teacher's headings below the section heading (h3), so they nest in the dialog's outline
 * instead of competing with its title: their top level becomes h4 and the rest keep their steps below
 * it (capped at h6), so the outline never skips a level. `<h2>…<h3>` → `<h4>…<h5>`.
 */
export function nestHeadings(html: string): string {
  const levels = Array.from(html.matchAll(/<h([1-6])\b/gi), (m) => Number(m[1]));
  if (levels.length === 0) return html;
  const shift = 4 - Math.min(...levels);
  return html.replace(/<(\/?)h([1-6])\b/gi, (_, slash: string, level: string) => `<${slash}h${Math.min(Number(level) + shift, 6)}`);
}

/**
 * The teacher's instructions (HTML, sanitised on the server) set for reading: a comfortable measure,
 * images and tables kept to the text width, links in the primary colour. Long text collapses to
 * 240px behind "Show more", with the last lines fading out so the cut reads as intentional.
 */
export default function Instructions({ html }: { html: string }) {
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const empty = html.replace(/<[^>]*>|&nbsp;|\s/g, '') === '' && !/<img\b/i.test(html);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setTall(el.scrollHeight > COLLAPSED_PX + 24);
    // Images and fonts load after the first paint and change the height; follow them.
    if (typeof ResizeObserver === 'undefined') {
      measure();
      return;
    }
    const observer = new ResizeObserver(measure);
    for (const child of Array.from(el.children)) observer.observe(child);
    observer.observe(el);
    return () => observer.disconnect();
  }, [html]);

  const collapsed = tall && !expanded;

  return (
    <Box component="section" aria-labelledby={`${bodyId}-heading`}>
      <Typography id={`${bodyId}-heading`} variant="h3" component="h3" sx={{ mb: 1 }}>
        Instructions
      </Typography>
      {empty ? (
        <Typography variant="body2" color="text.secondary">
          No instructions for this task.
        </Typography>
      ) : (
        <>
          <Box
            id={bodyId}
            ref={bodyRef}
            // A link below the cut would scroll the clipped box when tabbed to; open the text instead.
            onFocus={collapsed ? () => setExpanded(true) : undefined}
            // Already sanitised on the server with an allowlist (`sanitizeInstructions`).
            dangerouslySetInnerHTML={{ __html: nestHeadings(html) }}
            sx={[
              (theme) => ({
                maxWidth: '72ch',
                overflowWrap: 'anywhere',
                ...theme.typography.body1,
                lineHeight: 1.7,
                color: 'text.primary',
                '& > :first-child': { mt: 0 },
                '& > :last-child': { mb: 0 },
                '& p, & ul, & ol, & blockquote': { my: 1.25 },
                '& ul, & ol': { pl: 3 },
                '& li + li': { mt: 0.5 },
                // The teacher's own headings sit under the section label ("Instructions"), never above it:
                // a touch smaller than it, medium weight (the label is 500–600), lower levels in the muted colour.
                '& h4, & h5, & h6': { fontSize: '0.9375rem', fontWeight: 500, lineHeight: 1.5, letterSpacing: '0.01em', mt: 2.5, mb: 0.5 },
                '& h5, & h6': { color: 'text.secondary' },
                '& a': {
                  color: 'primary.main',
                  textDecorationThickness: '1px',
                  textUnderlineOffset: '0.2em',
                  '&:hover': { textDecorationThickness: '2px' },
                  '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2, borderRadius: '2px' },
                },
                '& img': { display: 'block', maxWidth: '100%', height: 'auto', my: 1.5, borderRadius: `${theme.yungu.shape.small}px` },
                '& blockquote': { mx: 0, pl: 2, color: 'text.secondary', fontStyle: 'normal' },
                '& table': { display: 'block', maxWidth: '100%', overflowX: 'auto', borderCollapse: 'collapse' },
              }),
              collapsed && {
                maxHeight: COLLAPSED_PX,
                overflow: 'hidden',
                maskImage: 'linear-gradient(to bottom, #000 calc(100% - 64px), transparent)',
              },
            ]}
          />
          {tall && (
            <Button
              size="small"
              onClick={() => setExpanded((open) => !open)}
              aria-expanded={expanded}
              aria-controls={bodyId}
              endIcon={expanded ? <ExpandLess /> : <ExpandMore />}
              // Optically aligned: the label starts on the text edge.
              sx={{ mt: 1, ml: '-5px' }}
            >
              {expanded ? 'Show less' : 'Show more'}
            </Button>
          )}
        </>
      )}
    </Box>
  );
}
