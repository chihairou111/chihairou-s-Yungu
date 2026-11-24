import { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ThemeRegistry from '@/components/ThemeRegistry';
import type { Appearance } from './appearance';
import { useAppearance } from './useAppearance';

/** A `prefers-color-scheme` the test can flip, as the OS would. */
function stubSystemScheme(initial: 'light' | 'dark') {
  let dark = initial === 'dark';
  const listeners = new Set<(e: { matches: boolean }) => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('prefers-color-scheme: dark') ? dark : false;
    },
    media: query,
    addListener: (l: (e: { matches: boolean }) => void) => listeners.add(l),
    removeListener: (l: (e: { matches: boolean }) => void) => listeners.delete(l),
    addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.delete(l),
  }));
  return (next: 'light' | 'dark') => {
    dark = next === 'dark';
    act(() => listeners.forEach((l) => l({ matches: dark })));
  };
}

const hook = { setAppearance: (() => {}) as (a: Appearance) => void };
const choose = (a: Appearance) => hook.setAppearance(a);
function Probe() {
  const { appearance, setAppearance } = useAppearance();
  useEffect(() => {
    hook.setAppearance = setAppearance;
  });
  return <span data-testid="appearance">{appearance}</span>;
}

const attr = () => document.documentElement.getAttribute('data-appearance');

beforeEach(() => {
  document.documentElement.removeAttribute('data-appearance');
});

afterEach(() => {
  document.cookie = 'yl_appearance=; Max-Age=0; Path=/';
  vi.unstubAllGlobals();
  delete (window as unknown as { yunguLocal?: unknown }).yunguLocal;
});

describe('useAppearance', () => {
  it("starts from the server's choice (the cookie)", () => {
    stubSystemScheme('light');
    render(
      <ThemeRegistry appearance="dark">
        <Probe />
      </ThemeRegistry>,
    );
    expect(screen.getByTestId('appearance')).toHaveTextContent('dark');
    expect(attr()).toBe('dark');
  });

  it('stores a choice in the cookie, applies it at once and tells the local app', () => {
    stubSystemScheme('light');
    const local = vi.fn();
    (window as unknown as { yunguLocal: unknown }).yunguLocal = { setAppearance: local };
    render(
      <ThemeRegistry appearance="auto">
        <Probe />
      </ThemeRegistry>,
    );
    act(() => choose('dark'));
    expect(document.cookie).toContain('yl_appearance=dark');
    expect(attr()).toBe('dark');
    expect(screen.getByTestId('appearance')).toHaveTextContent('dark');
    expect(local).toHaveBeenCalledWith('dark');
  });

  it("handles the local app's refusal (no unhandled rejection) and still applies the choice", () => {
    stubSystemScheme('light');
    const refused = Promise.reject(new Error('not allowed'));
    const handled = vi.spyOn(refused, 'then'); // a .catch() goes through .then()
    const asked: Appearance[] = [];
    // A plain function: a vi.fn() would itself call .then() on the result to record it.
    const local = (a: Appearance) => (asked.push(a), refused);
    (window as unknown as { yunguLocal: unknown }).yunguLocal = { setAppearance: local };
    render(
      <ThemeRegistry appearance="auto">
        <Probe />
      </ThemeRegistry>,
    );
    act(() => choose('dark'));
    expect(asked).toEqual(['dark']);
    expect(attr()).toBe('dark');
    expect(handled).toHaveBeenCalled();
    refused.catch(() => undefined); // in case it was not
  });

  it('works without the local app', () => {
    stubSystemScheme('light');
    render(
      <ThemeRegistry appearance="dark">
        <Probe />
      </ThemeRegistry>,
    );
    act(() => choose('light'));
    expect(attr()).toBe('light');
  });

  it('follows the system scheme live in Automatic', () => {
    const setSystem = stubSystemScheme('dark');
    render(
      <ThemeRegistry appearance="auto">
        <Probe />
      </ThemeRegistry>,
    );
    expect(screen.getByTestId('appearance')).toHaveTextContent('auto');
    expect(attr()).toBe('dark');
    setSystem('light');
    expect(attr()).toBe('light');
    setSystem('dark');
    expect(attr()).toBe('dark');
  });

  it('puts the scheme back when a server render changes the attribute on <html> (a refresh after a choice)', () => {
    stubSystemScheme('light');
    const { rerender } = render(
      <ThemeRegistry appearance="dark">
        <Probe />
      </ThemeRegistry>,
    );
    act(() => choose('auto'));
    expect(attr()).toBe('light');
    // The refreshed root layout renders <html> for the new cookie: React drops the attribute.
    document.documentElement.removeAttribute('data-appearance');
    rerender(
      <ThemeRegistry appearance="auto">
        <Probe />
      </ThemeRegistry>,
    );
    expect(attr()).toBe('light');
    expect(screen.getByTestId('appearance')).toHaveTextContent('auto');
  });
});
