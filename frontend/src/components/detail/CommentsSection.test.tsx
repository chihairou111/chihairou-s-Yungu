import { render, screen, waitFor } from '../test-render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Comment } from '@/lib/types';
import { ApiError } from './api';
import CommentsSection, { initials } from './CommentsSection';
import { addComment, deleteComment } from './api';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  addComment: vi.fn(),
  deleteComment: vi.fn(),
}));

const TWO: Comment[] = [
  { id: 'c1', author: 'Ms Lin', mine: false, createdAt: Date.now() - 3 * 3600_000, text: 'Please bring your notes.' },
  { id: 'c2', author: 'Me', mine: true, createdAt: Date.now() - 5 * 60_000, text: 'Will do.\nThanks!' },
];

beforeEach(() => {
  vi.mocked(addComment).mockReset();
  vi.mocked(deleteComment).mockReset();
});

describe('CommentsSection', () => {
  it('shows existing comments expanded, oldest first, with line breaks kept', () => {
    render(<CommentsSection taskId={7} comments={TWO} />);
    expect(screen.getByRole('heading', { name: 'Comments (2)' })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Ms Lin');
    expect(items[1]).toHaveTextContent('5 min ago');
    expect(screen.getByText(/Will do\./)).toHaveStyle({ whiteSpace: 'pre-wrap' });
    expect(screen.getByPlaceholderText('Add a comment')).toBeInTheDocument();
  });

  it('sets the author apart from the comment by weight, at 600 since CJK fallbacks have no 500', () => {
    render(<CommentsSection taskId={7} comments={[{ ...TWO[0], author: '林老师' }]} />);
    expect(screen.getByText('林老师')).toHaveStyle({ fontWeight: '600' });
  });

  it('collapses to a button when empty and expands to the composer', async () => {
    const user = userEvent.setup();
    render(<CommentsSection taskId={7} comments={[]} />);
    expect(screen.queryByPlaceholderText('Add a comment')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Comments (0)' }));
    expect(screen.getByPlaceholderText('Add a comment')).toHaveFocus();
  });

  it('disables Post for blank text', async () => {
    const user = userEvent.setup();
    render(<CommentsSection taskId={7} comments={TWO} />);
    const post = screen.getByRole('button', { name: 'Post' });
    expect(post).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Add a comment'), '   ');
    expect(post).toBeDisabled();
  });

  it('posts, appends, clears the box and refocuses it', async () => {
    const user = userEvent.setup();
    vi.mocked(addComment).mockResolvedValue({ id: 'c3', author: 'Me', mine: true, createdAt: Date.now(), text: 'Done' });
    render(<CommentsSection taskId={7} comments={TWO} />);
    const box = screen.getByPlaceholderText('Add a comment');
    await user.type(box, 'Done');
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(addComment).toHaveBeenCalledWith(7, 'Done');
    expect(await screen.findByRole('heading', { name: 'Comments (3)' })).toBeInTheDocument();
    expect(box).toHaveValue('');
    await waitFor(() => expect(box).toHaveFocus());
  });

  it('posts with Ctrl+Enter, and Enter alone adds a line', async () => {
    const user = userEvent.setup();
    vi.mocked(addComment).mockResolvedValue({ id: 'c3', author: 'Me', mine: true, createdAt: Date.now(), text: 'a\nb' });
    render(<CommentsSection taskId={7} comments={[]} />);
    await user.click(screen.getByRole('button', { name: 'Comments (0)' }));
    await user.type(screen.getByPlaceholderText('Add a comment'), 'a{Enter}b');
    expect(addComment).not.toHaveBeenCalled();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(addComment).toHaveBeenCalledWith(7, 'a\nb');
  });

  it('keeps the text and shows the error when posting fails', async () => {
    const user = userEvent.setup();
    vi.mocked(addComment).mockRejectedValue(new ApiError(400, 'Write a comment first.'));
    render(<CommentsSection taskId={7} comments={TWO} />);
    await user.type(screen.getByPlaceholderText('Add a comment'), 'Hi');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByText('Write a comment first.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Add a comment')).toHaveValue('Hi');
    expect(screen.getByPlaceholderText('Add a comment')).toHaveFocus();
  });

  it('points to sign-in when the session ended', async () => {
    const user = userEvent.setup();
    vi.mocked(addComment).mockRejectedValue(new ApiError(401, 'Sign in again.'));
    render(<CommentsSection taskId={7} comments={TWO} />);
    await user.type(screen.getByPlaceholderText('Add a comment'), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('Your session ended — sign in again.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('shows a counter near the limit', async () => {
    const user = userEvent.setup();
    render(<CommentsSection taskId={7} comments={TWO} />);
    const box = screen.getByPlaceholderText('Add a comment');
    await user.type(box, 'x');
    expect(screen.queryByText(/\/ 2000/)).not.toBeInTheDocument();
    await user.click(box);
    await user.paste('y'.repeat(1850));
    expect(screen.getByText('1851 / 2000')).toBeInTheDocument();
  });

  it('only offers delete on own comments, asks first, and removes on confirm', async () => {
    const user = userEvent.setup();
    vi.mocked(deleteComment).mockResolvedValue(undefined);
    render(<CommentsSection taskId={7} comments={TWO} />);
    expect(screen.getAllByRole('button', { name: 'Delete comment' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Delete comment' }));
    expect(screen.getByText('Delete comment?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteComment).toHaveBeenCalledWith(7, 'c2');
    expect(await screen.findByRole('heading', { name: 'Comments (1)' })).toBeInTheDocument();
    expect(screen.queryByText(/Will do/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByPlaceholderText('Add a comment')).toHaveFocus());
  });

  it('cancel keeps the comment and returns focus to its delete button', async () => {
    const user = userEvent.setup();
    render(<CommentsSection taskId={7} comments={TWO} />);
    await user.click(screen.getByRole('button', { name: 'Delete comment' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteComment).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete comment' })).toHaveFocus());
  });

  it('moves focus to the next own comment after a delete', async () => {
    const user = userEvent.setup();
    vi.mocked(deleteComment).mockResolvedValue(undefined);
    const mine = (id: string): Comment => ({ id, author: 'Me', mine: true, createdAt: Date.now(), text: id });
    render(<CommentsSection taskId={7} comments={[mine('a'), mine('b')]} />);
    await user.click(screen.getAllByRole('button', { name: 'Delete comment' })[0]);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete comment' })).toHaveFocus());
  });

  it('Escape cancels the delete question and returns focus to its trigger', async () => {
    const user = userEvent.setup();
    render(<CommentsSection taskId={7} comments={TWO} />);
    await user.click(screen.getByRole('button', { name: 'Delete comment' }));
    await user.keyboard('{Escape}');
    expect(deleteComment).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete comment' })).toHaveFocus());
  });

  it('builds initials', () => {
    expect(initials('Maya Chen')).toBe('MC');
    expect(initials('王小明')).toBe('王');
    expect(initials('  ')).toBe('?');
  });
});
