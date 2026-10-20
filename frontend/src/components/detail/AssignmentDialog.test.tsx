import { act, render, screen, waitFor } from '../test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssignmentDetail, FileRef } from '@/lib/types';
import { DAY, HOUR, NOW, todo } from '../test-fixtures';
import RefreshButton from '../RefreshButton';
import { RefreshProvider } from '../RefreshContext';
import AssignmentDialog from './AssignmentDialog';
import { ApiError } from './api';

const param = vi.hoisted(() => ({
  taskId: null as number | null,
  isOpen: false,
  writing: false,
  docId: null as string | null,
  open: vi.fn(),
  close: vi.fn(),
  openWriter: vi.fn(),
  closeWriter: vi.fn(),
}));
vi.mock('./useTaskParam', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useTaskParam')>()),
  useTaskParam: () => param,
}));

const api = vi.hoisted(() => ({ fetchDetail: vi.fn(), saveDraft: vi.fn(), updateOnlineDoc: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchDetail: api.fetchDetail,
  saveDraft: api.saveDraft,
  updateOnlineDoc: api.updateOnlineDoc,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));

const FILE: FileRef = { id: 'f1', name: 'one.pdf', kind: 'pdf', mime: 'application/pdf', size: 10, url: '/api/files/f1', createdAt: NOW };

vi.mock('./YourWork', async () => {
  const { useDetailActions } = await import('./DetailContext');
  const { useWorkContext } = await import('./WorkContext');
  return {
    default: function YourWorkStub() {
      const { refresh } = useDetailActions();
      const work = useWorkContext();
      return (
        <>
          <p>{work.status === 'not-submitted' ? 'Not submitted' : 'Submitted'}</p>
          <p>{`${work.files.length} files`}</p>
          <button onClick={() => void refresh()}>Refresh</button>
          <button onClick={() => void work.add(FILE)}>Add file</button>
        </>
      );
    },
  };
});

function detail(extra: Partial<AssignmentDetail> = {}): AssignmentDetail {
  return {
    ...todo('Task 3：开始第一次观察', 5 * HOUR, { id: 94616, estimatedMinutes: 45 }),
    teacher: 'Daniel Moore',
    instructionsHtml: '<p>本周任务：完成第一次城中村观察。</p>',
    attachments: [],
    myFiles: [],
    submittedFileIds: [],
    submitted: false,
    needsFiles: true,
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
  param.docId = null;
});

afterEach(() => vi.resetAllMocks());

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
    await userEvent.click(await screen.findByRole('button', { name: 'Back to assignment' }));
    expect(param.closeWriter).toHaveBeenCalled();
  });

  it('opens the writer for an online document named by doc=, and confirms its save', async () => {
    const content = JSON.stringify({ ops: [{ insert: '第一段\n' }] });
    const doc: FileRef = { id: 'd1', name: '课堂反思', kind: 'other', mime: 'application/octet-stream', size: 0, url: '/api/files/d1', online: true, content, createdAt: NOW };
    api.fetchDetail.mockResolvedValue(detail({ myFiles: [doc] }));
    api.updateOnlineDoc.mockResolvedValue(doc);
    openTask(94616);
    param.writing = true;
    param.docId = 'd1';
    render(<AssignmentDialog now={NOW} />);
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue('课堂反思');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Your writing' })).toHaveTextContent('第一段'));
    await userEvent.click(screen.getByRole('button', { name: 'Save to Your work' }));
    expect(await screen.findByText('Saved 课堂反思 to Your work')).toBeInTheDocument();
    expect(api.updateOnlineDoc).toHaveBeenCalledWith(94616, 'd1', '课堂反思', content);
    expect(param.closeWriter).toHaveBeenCalled();
  });

  it('fades the loaded detail in once, and then each switch between it and the writer', async () => {
    api.fetchDetail.mockResolvedValue(detail());
    openTask(94616);
    const { rerender } = render(<AssignmentDialog now={NOW} />);
    const fades = (el: Element) => {
      const list: Element[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) if (n.hasAttribute('data-view-fade')) list.push(n);
      return list; // innermost first
    };
    // Loaded: only the outer view fades; the detail inside it does not fade a second time.
    const [inner, outer] = fades(await screen.findByRole('heading', { level: 2, name: 'Task 3：开始第一次观察' }));
    expect(inner).toHaveAttribute('data-view-fade', 'still');
    expect(outer).toHaveAttribute('data-view-fade', 'in');

    // A switch fades the new view alone; the outer one stays as it was (not replayed).
    param.writing = true;
    rerender(<AssignmentDialog now={NOW} />);
    const [writer, outerAgain] = fades(await screen.findByRole('button', { name: 'Back to assignment' }));
    expect(writer).toHaveAttribute('data-view-fade', 'in');
    expect(outerAgain).toBe(outer);

    param.writing = false;
    rerender(<AssignmentDialog now={NOW} />);
    expect(fades(screen.getByRole('heading', { level: 2, name: 'Task 3：开始第一次观察' }))[0]).toHaveAttribute('data-view-fade', 'in');
  });

  it('keeps the work (files added) across a trip to the writer and back', async () => {
    api.fetchDetail.mockResolvedValue(detail());
    api.saveDraft.mockResolvedValue(undefined);
    openTask(94616);
    const { rerender } = render(<AssignmentDialog now={NOW} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add file' }));
    expect(await screen.findByText('1 files')).toBeInTheDocument();
    param.writing = true;
    rerender(<AssignmentDialog now={NOW} />);
    expect(screen.queryByText('1 files')).not.toBeInTheDocument();
    param.writing = false;
    rerender(<AssignmentDialog now={NOW} />);
    expect(screen.getByText('1 files')).toBeInTheDocument();
    expect(api.fetchDetail).toHaveBeenCalledTimes(1);
  });

  it('loads afresh behind the skeleton when reopened, never flashing the earlier result', async () => {
    api.fetchDetail.mockResolvedValueOnce(detail());
    openTask(94616);
    const { rerender } = render(<AssignmentDialog now={NOW} />);
    expect(await screen.findByText('Not submitted')).toBeInTheDocument();

    param.isOpen = false;
    param.taskId = null;
    rerender(<AssignmentDialog now={NOW} />);
    let resolve!: (d: AssignmentDetail) => void;
    api.fetchDetail.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    openTask(94616);
    rerender(<AssignmentDialog now={NOW} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Not submitted')).not.toBeInTheDocument();
    await act(async () => resolve(detail({ submitted: true })));
    expect(screen.getByText('Submitted')).toBeInTheDocument();
  });

  it('refresh() swaps in the fetched detail in place, without the skeleton', async () => {
    api.fetchDetail.mockResolvedValueOnce(detail());
    openTask(94616);
    render(<AssignmentDialog now={NOW} />);
    const refresh = await screen.findByRole('button', { name: 'Refresh' });
    api.fetchDetail.mockResolvedValueOnce(detail({ submitted: true }));
    await userEvent.click(refresh);
    expect(await screen.findByText('Submitted')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-busy');
  });

  it("is refreshed in place by the app bar's Refresh while open, and not once closed", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    api.fetchDetail.mockResolvedValueOnce(detail());
    openTask(94616);
    const ui = () => (
      <RefreshProvider>
        <RefreshButton />
        <AssignmentDialog now={NOW} />
      </RefreshProvider>
    );
    const { rerender } = render(ui());
    expect(await screen.findByText('Not submitted')).toBeInTheDocument();
    api.fetchDetail.mockResolvedValueOnce(detail({ submitted: true }));
    // Behind the modal's backdrop for pointer and screen reader, but the action is the same.
    const appBarRefresh = screen.getAllByRole('button', { name: 'Refresh', hidden: true }).find((b) => !b.closest('[role="dialog"]'))!;
    await userEvent.click(appBarRefresh);
    expect(await screen.findByText('Submitted')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-busy');
    expect(api.fetchDetail).toHaveBeenCalledTimes(2);

    param.isOpen = false;
    rerender(ui());
    await userEvent.click(appBarRefresh);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(api.fetchDetail).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
