import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_DELAY_MS, draftKey, useDraft } from './useDraft';

describe('useDraft', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('saves to yl_write_draft_<taskId> 500 ms after the last change', () => {
    const { result } = renderHook(() => useDraft(7));
    act(() => result.current.setHtml('<p>a</p>'));
    expect(result.current.status).toBe('saving');
    act(() => vi.advanceTimersByTime(DRAFT_DELAY_MS - 1));
    act(() => result.current.setHtml('<p>ab</p>'));
    act(() => vi.advanceTimersByTime(DRAFT_DELAY_MS - 1));
    expect(localStorage.getItem('yl_write_draft_7')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(localStorage.getItem(draftKey(7))).toBe('<p>ab</p>');
    expect(result.current.status).toBe('saved');
  });

  it('restores the saved draft on reopen', () => {
    localStorage.setItem('yl_write_draft_7', '<p>kept</p>');
    const { result } = renderHook(() => useDraft(7));
    expect(result.current.html).toBe('<p>kept</p>');
    expect(result.current.status).toBe('saved');
  });

  it('writes a pending change at once when unmounted (leaving the writer)', () => {
    const { result, unmount } = renderHook(() => useDraft(7));
    act(() => result.current.setHtml('<p>quick</p>'));
    unmount();
    expect(localStorage.getItem('yl_write_draft_7')).toBe('<p>quick</p>');
  });

  it('removes the key when the text is emptied and on clear()', () => {
    localStorage.setItem('yl_write_draft_7', '<p>x</p>');
    const { result } = renderHook(() => useDraft(7));
    act(() => result.current.setHtml(''));
    act(() => vi.advanceTimersByTime(DRAFT_DELAY_MS));
    expect(localStorage.getItem('yl_write_draft_7')).toBeNull();
    act(() => result.current.setHtml('<p>y</p>'));
    act(() => result.current.clear());
    act(() => vi.advanceTimersByTime(DRAFT_DELAY_MS));
    expect(localStorage.getItem('yl_write_draft_7')).toBeNull();
    expect(result.current.html).toBe('');
  });

  it('keeps working without storage (blocked or full)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { result, unmount } = renderHook(() => useDraft(7));
    expect(result.current.html).toBe('');
    act(() => result.current.setHtml('<p>a</p>'));
    act(() => vi.advanceTimersByTime(DRAFT_DELAY_MS));
    expect(result.current.html).toBe('<p>a</p>');
    expect(result.current.status).toBe('unavailable');
    expect(() => unmount()).not.toThrow();
  });
});
