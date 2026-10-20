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
    submittedFileIds: [],
    submitted: false,
    needsFiles: true,
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
    expect(result.current.error).toBe('empty.txt is empty.');
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

  it('an older detail arriving while a save is on its way does not drop the new file', async () => {
    let saved!: () => void;
    api.saveDraft.mockReturnValueOnce(new Promise<void>((r) => (saved = r)));
    const { result, rerender } = setup(detail());
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.add(ref('a'));
    });
    rerender({ value: detail() });
    expect(result.current.files.map((f) => f.id)).toEqual(['a']);
    await act(async () => {
      saved();
      await pending;
    });
    expect(result.current.files.map((f) => f.id)).toEqual(['a']);
  });

  describe('replace (an online document saved again)', () => {
    const doc = (id: string, name = '课堂反思'): FileRef => ({ ...ref(id, name), kind: 'other', online: true, size: 0, content: '{"ops":[{"insert":"x\\n"}]}' });

    it('swaps a handed-in document for its new version at the same place; the hand-in list is untouched', async () => {
      const d = detail({ submitted: true, submittedAt: NOW, myFiles: [ref('a'), doc('old'), ref('c')], submittedFileIds: ['a', 'old', 'c'] });
      const { result } = setup(d);
      expect(result.current.submittedFileIds).toEqual(['a', 'old', 'c']);
      let ok!: boolean;
      await act(async () => {
        ok = await result.current.replace('old', doc('new'));
      });
      expect(ok).toBe(true);
      expect(result.current.files.map((f) => f.id)).toEqual(['a', 'new', 'c']);
      expect(api.saveDraft).toHaveBeenLastCalledWith(94616, ['a', 'new', 'c']);
      expect(result.current.submittedFileIds).toEqual(['a', 'old', 'c']);
      expect(result.current.changed).toBe(true);
      expect(api.submit).not.toHaveBeenCalled();
    });

    it('an update in place takes the new title and text without a draft save', async () => {
      const { result } = setup(detail({ myFiles: [ref('a'), doc('d1')] }));
      const updated = { ...doc('d1', '新的标题'), content: '{"ops":[{"insert":"y\\n"}]}' };
      await act(async () => {
        expect(await result.current.replace('d1', updated)).toBe(true);
      });
      expect(result.current.files[1]).toEqual(updated);
      expect(api.saveDraft).not.toHaveBeenCalled();
    });

    it('puts the old version back when the draft save fails', async () => {
      api.saveDraft.mockRejectedValueOnce(new ApiError(502, "Can't reach Yungu. Try again."));
      const { result } = setup(detail({ myFiles: [doc('old'), ref('b')] }));
      await act(async () => {
        expect(await result.current.replace('old', doc('new'))).toBe(false);
      });
      expect(result.current.files.map((f) => f.id)).toEqual(['old', 'b']);
      expect(result.current.error).toBe("Can't reach Yungu. Try again.");
    });

    it('adds the new version at the end when the old one is gone', async () => {
      const { result } = setup(detail({ myFiles: [ref('a')] }));
      await act(() => result.current.replace('gone', doc('new')));
      expect(result.current.files.map((f) => f.id)).toEqual(['a', 'new']);
    });
  });

  describe('submit with no files (Mark as submitted)', () => {
    it('canMarkSubmitted needs optional files, not submitted, and nothing in Your work', () => {
      expect(setup(detail({ needsFiles: false })).result.current.canMarkSubmitted).toBe(true);
      expect(setup(detail({ needsFiles: true })).result.current.canMarkSubmitted).toBe(false);
      expect(setup(detail({ needsFiles: false, myFiles: [ref('a')] })).result.current.canMarkSubmitted).toBe(false);
      expect(setup(detail({ needsFiles: false, submitted: true, submittedAt: NOW })).result.current.canMarkSubmitted).toBe(false);
    });

    it('sends an empty list when allowed, and reads "submitted" afterwards', async () => {
      api.submit.mockResolvedValue({ submittedAt: NOW });
      const { result } = setup(detail({ needsFiles: false }));
      await act(() => result.current.submit());
      expect(api.submit).toHaveBeenCalledOnce();
      expect(api.submit).toHaveBeenCalledWith(94616, []);
      expect(result.current.status).toBe('submitted');
      expect(result.current.canMarkSubmitted).toBe(false);
      expect(result.current.changed).toBe(false);
      expect(refresh).toHaveBeenCalled();
    });

    it('sends nothing when files are required', async () => {
      const { result } = setup(detail({ needsFiles: true }));
      await act(() => result.current.submit());
      expect(api.submit).not.toHaveBeenCalled();
    });

    it('sends nothing for an already submitted assignment with an emptied list', async () => {
      const { result } = setup(detail({ needsFiles: false, submitted: true, submittedAt: NOW, myFiles: [ref('a')], submittedFileIds: ['a'] }));
      await act(() => result.current.remove('a'));
      await act(() => result.current.submit());
      expect(api.submit).not.toHaveBeenCalled();
    });

    it('two calls at once send one request', async () => {
      let finish!: (v: { submittedAt: number }) => void;
      api.submit.mockReturnValue(new Promise((r) => (finish = r)));
      const { result } = setup(detail({ needsFiles: false }));
      let both!: Promise<unknown>;
      act(() => {
        both = Promise.all([result.current.submit(), result.current.submit()]);
      });
      await act(async () => {
        finish({ submittedAt: NOW });
        await both;
      });
      expect(api.submit).toHaveBeenCalledOnce();
    });

    it('a failure shows the error and stays not submitted', async () => {
      api.submit.mockRejectedValue(new ApiError(502, "Yungu didn't confirm the hand-in. Check on Yungu."));
      const { result } = setup(detail({ needsFiles: false }));
      await act(() => result.current.submit());
      expect(result.current.error).toBe("Yungu didn't confirm the hand-in. Check on Yungu.");
      expect(result.current.status).toBe('not-submitted');
      expect(result.current.canMarkSubmitted).toBe(true);
    });
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
