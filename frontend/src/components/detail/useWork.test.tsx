import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssignmentDetail, FileRef } from '@/lib/types';
import { HOUR, NOW, todo } from '../test-fixtures';
import { ApiError } from './api';
import { DetailContext } from './DetailContext';
import { useWork } from './useWork';

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

function ref(id: string, name = `${id}.pdf`): FileRef {
  return { id, name, kind: 'pdf', mime: 'application/pdf', size: 2048, url: `/api/files/${id}`, createdAt: NOW };
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

function setup(d: AssignmentDetail) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DetailContext.Provider value={{ refresh }}>{children}</DetailContext.Provider>
  );
  return renderHook(({ value }) => useWork(value), { wrapper, initialProps: { value: d } });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.saveDraft.mockResolvedValue(undefined);
  refresh.mockResolvedValue(undefined);
});

describe('useWork', () => {
  it('starts from the saved files and status', () => {
    const { result } = setup(detail({ myFiles: [ref('a')] }));
    expect(result.current.files.map((f) => f.id)).toEqual(['a']);
    expect(result.current.status).toBe('not-submitted');
    expect(result.current.error).toBeNull();
  });

  it('saves the whole list as the draft on every add and remove', async () => {
    const { result } = setup(detail({ myFiles: [ref('a')] }));
    await act(() => result.current.add(ref('b')));
    expect(api.saveDraft).toHaveBeenLastCalledWith(94616, ['a', 'b']);
    await act(() => result.current.remove('a'));
    expect(api.saveDraft).toHaveBeenLastCalledWith(94616, ['b']);
    expect(result.current.files.map((f) => f.id)).toEqual(['b']);
  });

  it('uploads local files in parallel and keeps both in the draft', async () => {
    api.uploadFile.mockImplementation(async (file: File) => ref(file.name));
    const { result } = setup(detail());
    await act(() =>
      Promise.all([result.current.addLocal(new File(['x'], 'one')), result.current.addLocal(new File(['y'], 'two'))]),
    );
    expect(result.current.files.map((f) => f.id)).toEqual(['one', 'two']);
    expect(api.saveDraft).toHaveBeenLastCalledWith(94616, ['one', 'two']);
  });

  it('rejects an empty file without uploading it', async () => {
    const { result } = setup(detail());
    await act(() => result.current.addLocal(new File([], 'empty.txt')));
    expect(api.uploadFile).not.toHaveBeenCalled();
    expect(result.current.error).toBe('That file is empty.');
  });

  it('puts a failed draft save back the way it was', async () => {
    api.saveDraft.mockRejectedValueOnce(new ApiError(0, 'No connection. Try again.'));
    const { result } = setup(detail({ myFiles: [ref('a')] }));
    await act(() => result.current.remove('a'));
    expect(result.current.files.map((f) => f.id)).toEqual(['a']);
    expect(result.current.error).toBe('No connection. Try again.');
  });

  it('submits the list, refreshes the pop-up and the list behind, and reads "submitted"', async () => {
    api.submit.mockResolvedValue({ submittedAt: NOW });
    const { result } = setup(detail({ myFiles: [ref('a')] }));
    await act(() => result.current.submit());
    expect(api.submit).toHaveBeenCalledWith(94616, ['a']);
    expect(refresh).toHaveBeenCalled();
    expect(nav.refresh).toHaveBeenCalled();
    expect(result.current.status).toBe('submitted');
  });

  it('reads "late" when handed in after the due time', async () => {
    const d = detail({ myFiles: [ref('a')] });
    api.submit.mockResolvedValue({ submittedAt: d.dueAt + HOUR });
    const { result } = setup(d);
    await act(() => result.current.submit());
    expect(result.current.status).toBe('late');
  });

  it('takes the files from a refreshed detail', async () => {
    const { result, rerender } = setup(detail({ myFiles: [ref('a')] }));
    rerender({ value: detail({ myFiles: [ref('a'), ref('c')] }) });
    await waitFor(() => expect(result.current.files.map((f) => f.id)).toEqual(['a', 'c']));
  });

  it('a 401 ends the session', async () => {
    api.submit.mockRejectedValue(new ApiError(401, 'Sign in again.'));
    const { result } = setup(detail({ myFiles: [ref('a')] }));
    await act(() => result.current.submit());
    expect(result.current.sessionEnded).toBe(true);
    expect(result.current.error).toBe('Your session ended — sign in again.');
    expect(result.current.status).toBe('not-submitted');
  });
});
