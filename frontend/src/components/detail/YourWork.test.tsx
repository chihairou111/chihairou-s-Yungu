import { fireEvent, render, screen, waitFor, within } from '../test-render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssignmentDetail, FileRef } from '@/lib/types';
import { HOUR, NOW, todo } from '../test-fixtures';
import { ApiError } from './api';
import { DetailContext } from './DetailContext';
import YourWork from './YourWork';

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: nav.refresh }) }));

const api = vi.hoisted(() => ({ uploadFile: vi.fn(), saveDraft: vi.fn(), submit: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  uploadFile: api.uploadFile,
  saveDraft: api.saveDraft,
  submit: api.submit,
}));

const refresh = vi.fn();

function ref(id: string, name: string): FileRef {
  return { id, name, kind: 'other', mime: 'text/plain', size: 2048, url: `/api/files/${id}`, createdAt: NOW };
}

function detail(extra: Partial<AssignmentDetail> = {}): AssignmentDetail {
  return {
    ...todo('Task 3', 5 * HOUR, { id: 94616 }),
    teacher: 'Daniel Moore',
    instructionsHtml: '',
    attachments: [],
    myFiles: [],
    submitted: false,
    comments: [],
    ...extra,
  };
}

const handlers = { onWrite: vi.fn(), onRecord: vi.fn(), onCamera: vi.fn() };

function setup(d: AssignmentDetail) {
  return render(
    <DetailContext.Provider value={{ refresh }}>
      <YourWork detail={d} {...handlers} />
    </DetailContext.Provider>,
  );
}

function uploadInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.saveDraft.mockResolvedValue(undefined);
  refresh.mockResolvedValue(undefined);
  api.uploadFile.mockImplementation(async (file: File) => ref(`id-${file.name}`, file.name));
});

describe('YourWork', () => {
  it('shows the status, the four add actions in order, and a disabled Submit with no files', () => {
    setup(detail());
    expect(screen.getByText('Not submitted')).toBeInTheDocument();
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['Record', 'Camera', 'Write', 'Upload', 'Submit']);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(uploadInput()).toHaveAttribute('multiple');
  });

  it('wires Record, Camera and Write to their handlers', async () => {
    const user = userEvent.setup();
    setup(detail());
    await user.click(screen.getByRole('button', { name: 'Record' }));
    await user.click(screen.getByRole('button', { name: 'Camera' }));
    await user.click(screen.getByRole('button', { name: 'Write' }));
    expect(handlers.onRecord).toHaveBeenCalledOnce();
    expect(handlers.onCamera).toHaveBeenCalledOnce();
    expect(handlers.onWrite).toHaveBeenCalledOnce();
  });

  it('uploads two files, lists both and saves both as the draft', async () => {
    const user = userEvent.setup();
    setup(detail());
    await user.upload(uploadInput(), [new File(['a'], 'notes.txt'), new File(['b'], 'sketch.txt')]);
    expect(await screen.findByRole('button', { name: /^notes\.txt/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sketch\.txt/ })).toBeInTheDocument();
    await waitFor(() => expect(api.saveDraft).toHaveBeenLastCalledWith(94616, ['id-notes.txt', 'id-sketch.txt']));
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
  });

  it('files dropped on the panel are uploaded', async () => {
    setup(detail());
    const file = new File(['a'], 'dropped.txt');
    fireEvent.drop(screen.getByRole('heading', { name: 'Your work' }), { dataTransfer: { files: [file], types: ['Files'] } });
    expect(await screen.findByRole('button', { name: /^dropped\.txt/ })).toBeInTheDocument();
    expect(api.uploadFile).toHaveBeenCalledWith(file);
  });

  it('removing a file saves the others as the draft', async () => {
    const user = userEvent.setup();
    setup(detail({ myFiles: [ref('a', 'one.txt'), ref('b', 'two.txt')] }));
    await user.click(screen.getByRole('button', { name: 'Remove one.txt' }));
    expect(api.saveDraft).toHaveBeenLastCalledWith(94616, ['b']);
    await waitFor(() => expect(screen.queryByRole('button', { name: /^one\.txt/ })).not.toBeInTheDocument());
  });

  it('says so when a file is empty', async () => {
    const user = userEvent.setup();
    setup(detail());
    await user.upload(uploadInput(), new File([], 'blank.txt'));
    expect(await screen.findByRole('alert')).toHaveTextContent('That file is empty.');
  });

  it('shows the size limit when the server refuses a large file', async () => {
    api.uploadFile.mockRejectedValue(new ApiError(413, 'Files up to 50 MB.'));
    const user = userEvent.setup();
    setup(detail());
    await user.upload(uploadInput(), new File(['x'], 'huge.mov'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Files up to 50 MB.');
  });

  it('Submit hands in, then reads "Submitted" and offers Update', async () => {
    api.submit.mockResolvedValue({ submittedAt: NOW });
    const user = userEvent.setup();
    setup(detail({ myFiles: [ref('a', 'one.txt')] }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('button', { name: 'Update' })).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.queryByText('Not submitted')).not.toBeInTheDocument();
    expect(api.submit).toHaveBeenCalledWith(94616, ['a']);
    expect(nav.refresh).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('a submit after the due time reads "Submitted late"', async () => {
    const d = detail({ myFiles: [ref('a', 'one.txt')] });
    api.submit.mockResolvedValue({ submittedAt: d.dueAt + HOUR });
    const user = userEvent.setup();
    setup(d);
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Submitted late')).toBeInTheDocument();
  });

  it('already submitted work offers Update', () => {
    setup(detail({ myFiles: [ref('a', 'one.txt')], submitted: true, submittedAt: NOW }));
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled();
  });

  it('a 401 says the session ended, with a way to sign in', async () => {
    api.submit.mockRejectedValue(new ApiError(401, 'Sign in again.'));
    const user = userEvent.setup();
    setup(detail({ myFiles: [ref('a', 'one.txt')] }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your session ended — sign in again.');
    expect(within(alert).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});
