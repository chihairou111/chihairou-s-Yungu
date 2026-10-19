import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { Comment } from '@/lib/types';

/** Placeholder until Task 9 (post, delete, collapsed when empty): the comments as plain text. */
export default function CommentsSection({ comments }: { comments: Comment[] }) {
  return (
    <Box component="section" aria-labelledby="detail-comments">
      <Typography id="detail-comments" variant="h3" component="h3" sx={{ mb: 1 }}>
        Comments ({comments.length})
      </Typography>
      {comments.map((c) => (
        <Typography variant="body2" key={c.id} sx={{ mb: 0.5, overflowWrap: 'anywhere' }}>
          <Box component="span" sx={{ fontWeight: 500 }}>
            {c.author}
          </Box>
          : {c.text}
        </Typography>
      ))}
    </Box>
  );
}
