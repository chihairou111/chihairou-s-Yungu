import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTaskParam } from './useTaskParam';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/assignments',
  useSearchParams: () => new URLSearchParams(nav.search),
}));

/** The marks the hook leaves on history entries it pushed, as Next keeps them on `history.state`. */
function setHistoryState(state: unknown) {
  vi.spyOn(window.history, 'state', 'get').mockReturnValue(state);
}

afterEach(() => {
  nav.search = '';
  vi.restoreAllMocks();
});

describe('useTaskParam', () => {
  it('reads nothing open from a plain list URL', () => {
    const { result } = renderHook(() => useTaskParam());
    expect(result.current).toMatchObject({ taskId: null, isOpen: false, writing: false });
  });

  it('reads the open task and the writer from the query', () => {
    nav.search = 'tab=submitted&task=101&write=1';
    const { result } = renderHook(() => useTaskParam());
    expect(result.current).toMatchObject({ taskId: 101, isOpen: true, writing: true });
  });

  it('treats a non-numeric task as open but unknown', () => {
    nav.search = 'task=abc';
    const { result } = renderHook(() => useTaskParam());
    expect(result.current).toMatchObject({ taskId: null, isOpen: true });
  });

  it('pushes ?task=ID and keeps the tab', () => {
    nav.search = 'tab=submitted';
    const push = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    const { result } = renderHook(() => useTaskParam());
    result.current.open(94616);
    expect(push).toHaveBeenCalledWith({ ylTask: true }, '', '/assignments?tab=submitted&task=94616');
  });

  it('closes by going back when the app pushed the entry', () => {
    nav.search = 'task=101';
    setHistoryState({ ylTask: true });
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    const { result } = renderHook(() => useTaskParam());
    result.current.close();
    expect(go).toHaveBeenCalledWith(-1);
  });

  it('closes a direct link by replacing the URL, keeping the tab', () => {
    nav.search = 'tab=submitted&task=101';
    setHistoryState(null);
    const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    const go = vi.spyOn(window.history, 'go');
    const { result } = renderHook(() => useTaskParam());
    result.current.close();
    expect(go).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(null, '', '/assignments?tab=submitted');
  });

  it('closes past the writer too when both entries were pushed', () => {
    nav.search = 'task=101&write=1';
    setHistoryState({ ylTask: true, ylWrite: true });
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    const { result } = renderHook(() => useTaskParam());
    result.current.close();
    expect(go).toHaveBeenCalledWith(-2);
  });

  it('opens the writer as its own entry and closes it with Back', () => {
    nav.search = 'task=101';
    setHistoryState({ ylTask: true });
    const push = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    const { result, rerender } = renderHook(() => useTaskParam());
    result.current.openWriter();
    expect(push).toHaveBeenCalledWith({ ylTask: true, ylWrite: true }, '', '/assignments?task=101&write=1');

    nav.search = 'task=101&write=1';
    setHistoryState({ ylTask: true, ylWrite: true });
    rerender();
    result.current.closeWriter();
    expect(go).toHaveBeenCalledWith(-1);
  });

  it('reads the document being written from &doc=, only with the writer open', () => {
    nav.search = 'task=101&write=1&doc=fx-doc-208';
    expect(renderHook(() => useTaskParam()).result.current).toMatchObject({ writing: true, docId: 'fx-doc-208' });
    nav.search = 'task=101&doc=fx-doc-208';
    expect(renderHook(() => useTaskParam()).result.current).toMatchObject({ writing: false, docId: null });
    nav.search = 'task=101&write=1';
    expect(renderHook(() => useTaskParam()).result.current.docId).toBeNull();
  });

  it('opens the writer for an online document with &doc=FILEID', () => {
    nav.search = 'task=101';
    setHistoryState({ ylTask: true });
    const push = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    const { result } = renderHook(() => useTaskParam());
    result.current.openWriter('a b/1');
    expect(push).toHaveBeenCalledWith({ ylTask: true, ylWrite: true }, '', '/assignments?task=101&write=1&doc=a+b%2F1');
    result.current.openWriter();
    expect(push).toHaveBeenLastCalledWith({ ylTask: true, ylWrite: true }, '', '/assignments?task=101&write=1');
  });

  it('drops doc= with write=1 when the writer or the task closes', () => {
    nav.search = 'task=101&write=1&doc=d1';
    setHistoryState(null);
    const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    const { result, rerender } = renderHook(() => useTaskParam());
    result.current.closeWriter();
    expect(replace).toHaveBeenLastCalledWith(null, '', '/assignments?task=101');
    nav.search = 'tab=submitted&task=101&write=1&doc=d1';
    rerender();
    result.current.close();
    expect(replace).toHaveBeenLastCalledWith(null, '', '/assignments?tab=submitted');
  });

  it('closes a directly linked writer by dropping only write=1', () => {
    nav.search = 'task=101&write=1';
    setHistoryState(null);
    const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    const { result } = renderHook(() => useTaskParam());
    result.current.closeWriter();
    expect(replace).toHaveBeenCalledWith(null, '', '/assignments?task=101');
  });

  it('ignores a second close while the first is still navigating, and re-arms once the URL changes', () => {
    nav.search = 'task=101';
    setHistoryState({ ylTask: true });
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    const { result, rerender } = renderHook(() => useTaskParam());
    result.current.close();
    result.current.close();
    expect(go).toHaveBeenCalledTimes(1);

    nav.search = '';
    rerender();
    nav.search = 'task=101';
    rerender();
    result.current.close();
    expect(go).toHaveBeenCalledTimes(2);
  });

  it('closing a directly linked task from a pushed writer steps back, then replaces the task entry', () => {
    nav.search = 'tab=submitted&task=101&write=1';
    setHistoryState({ ylWrite: true });
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    const { result } = renderHook(() => useTaskParam());
    result.current.close();
    expect(go).toHaveBeenCalledWith(-1);
    expect(replace).not.toHaveBeenCalled();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(replace).toHaveBeenCalledWith(null, '', '/assignments?tab=submitted');
  });
});
