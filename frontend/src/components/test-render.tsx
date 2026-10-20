import type { ReactElement } from 'react';
import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import ThemeRegistry from './ThemeRegistry';

export * from '@testing-library/react';

/** RTL's render inside the app's theme, as in the real layout. */
export function render(ui: ReactElement, options?: RenderOptions) {
  return rtlRender(ui, {
    wrapper: ({ children }) => <ThemeRegistry>{children}</ThemeRegistry>,
    ...options,
  });
}
