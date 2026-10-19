import { render, screen } from '../test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssignmentDetail } from '@/lib/types';
import { DAY, HOUR, NOW, todo } from '../test-fixtures';
import AssignmentDialog from './AssignmentDialog';
import { ApiError } from './api';

const param = vi.hoisted(() => ({
  taskId: null as number | null,
  isOpen: false,
  writing: false,
  open: vi.fn(),
  close: vi.fn(),
  openWriter: vi.fn(),
  closeWriter: vi.fn(),
}));
vi.mock('./useTaskParam', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useTaskParam')>()),
  useTaskParam: () => param,
}));

const api = vi.hoisted(() => ({ fetchDetail: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchDetail: api.fetchDetail,
}));

function detail(extra: Partial<AssignmentDetail> = {}): AssignmentDetail {
  return {
    ...todo('Task 3：开始第一次观察', 5 * HOUR, { id: 94616, estimatedMinutes: 45 }),
    teacher: 'Daniel Moore',
    instructionsHtml: '<p>本周任务：完成第一次城中村观察。</p>',
    attachments: [],
    myFiles: [],
    submitted: false,
    comments: [],
    ...extra,
  };
}

function openTask(id: number | null) {
  param.taskId = id;
  param.isOpen = true;
}

beforeEach(() => {
  param.taskId = null;
  param.isOpen = false;
  param.writing = false;
});

afterEach(() => vi.clearAllMocks());

describe('AssignmentDialog', () => {
  it('stays closed without ?task', () => {
    render(<AssignmentDialog now={NOW} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.fetchDetail).not.toHaveBeenCalled();
  });

  it('shows a skeleton, then the header: title, course · teacher, due, estimated time', async () => {
    api.fetchDetail.mockResolvedValue(detail());
    openTask(94616);
    render(<AssignmentDialog now={NOW} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByRole('heading', { level: 2, name: 'Task 3：开始第一次观察' })).toBeInTheDocument();
    expect(api.fetchDetail).toHaveBeenCalledWith(94616, expect.any(AbortSignal));
    const dialog = screen.getByRole('dialog', { name: 'Task 3：开始第一次观察' });
    expect(dialog).not.toHaveAttribute('aria-busy');
    expect(screen.getByText('Product Design I · Daniel Moore')).toBeInTheDocument();
    expect(screen.getByText('Due today · 22:00')).toBeInTheDocument();
    expect(screen.getByText('About 45 min')).toBeInTheDocument();
    expect(screen.getByText('本周任务：完成第一次城中村观察。')).toBeInTheDocument();
  });

  it('marks the due date in the error tone when overdue or due today, not when later', async () => {
    api.fetchDetail.mockResolvedValue(detail());
    openTask(94616);
    const { unmount } = render(<AssignmentDialog now={NOW} />);
    expect((await screen.findByText('Due today · 22:00')).closest('[data-tone]')).toHaveAttribute('data-tone', 'error');
    unmount();

    api.fetchDetail.mockResolvedValue(detail({ dueAt: NOW - 2 * DAY }));
    const late = render(<AssignmentDialog now={NOW} />);
    expect((await screen.findByText(/^Due Fri, Oct 16/)).closest('[data-tone]')).toHaveAttribute('data-tone', 'error');
    late.unmount();

    api.fetchDetail.mockResolvedValue(detail({ dueAt: NOW + 3 * DAY }));
    render(<AssignmentDialog now={NOW} />);
    expect((await screen.findByText('Due Wed, Oct 21 · 17:00')).closest('[data-tone]')).toHaveAttribute('data-tone', 'neutral');
  });

  it('closes with Esc and with the ✕ button', async () => {
    api.fetchDetail.mockResolvedValue(detail());
    openTask(94616);
    render(<AssignmentDialog now={NOW} />);
    await screen.findByRole('heading', { level: 2, name: 'Task 3：开始第一次观察' });
    await userEvent.keyboard('{Escape}');
    expect(param.close).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(param.close).toHaveBeenCalledTimes(2);
  });

  it('shows "Assignment not found" with Close for an unknown id', async () => {
    api.fetchDetail.mockRejectedValue(new ApiError(404, 'Assignment not found'));
    openTask(999999);
    render(<AssignmentDialog now={NOW} />);
    expect(await screen.findByRole('heading', { name: 'Assignment not found' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(param.close).toHaveBeenCalled();
  });

  it('shows "Assignment not found" for a non-numeric id without asking the server', async () => {
    openTask(null);
    render(<AssignmentDialog now={NOW} />);
    expect(await screen.findByRole('heading', { name: 'Assignment not found' })).toBeInTheDocument();
    expect(api.fetchDetail).not.toHaveBeenCalled();
  });

  it('asks to sign in again when the session has ended', async () => {
    api.fetchDetail.mockRejectedValue(new ApiError(401, 'Sign in again.'));
    openTask(94616);
    render(<AssignmentDialog now={NOW} />);
    expect(await screen.findByText('Your session ended — sign in again.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('offers a retry when loading fails for another reason', async () => {
    api.fetchDetail.mockRejectedValueOnce(new ApiError(500, 'Server error')).mockResolvedValueOnce(detail());
    openTask(94616);
    render(<AssignmentDialog now={NOW} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Task 3：开始第一次观察' })).toBeInTheDocument();
  });

  it('switches the same dialog to the writer with write=1', async () => {
    api.fetchDetail.mockResolvedValue(detail());
    openTask(94616);
    param.writing = true;
    render(<AssignmentDialog now={NOW} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Back to the assignment' }));
    expect(param.closeWriter).toHaveBeenCalled();
  });
});
