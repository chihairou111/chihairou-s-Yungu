import type { ReactElement } from 'react';
import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import StyleProvider from './StyleProvider';

export * from '@testing-library/react';

/** RTL's render inside the app's StyleProvider (the default, expressive style), as in the real layout. */
export function render(ui: ReactElement, options?: RenderOptions) {
  return rtlRender(ui, {
    wrapper: ({ children }) => <StyleProvider initialStyle="expressive">{children}</StyleProvider>,
    ...options,
  });
}
