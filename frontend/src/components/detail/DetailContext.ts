'use client';
import { createContext, useContext } from 'react';

export interface DetailActions {
  /**
   * Fetches the open assignment again and swaps it in place, with no skeleton (e.g. after a submit, so
   * the status reads "Submitted" without a flash of the old state). Rejects with `ApiError` on failure;
   * a 401 also switches the dialog to its signed-out message.
   */
  refresh(): Promise<void>;
}

export const DetailContext = createContext<DetailActions>({ refresh: async () => {} });

/** Actions on the open assignment, for the sections inside the pop-up (Your work, Comments, …). */
export function useDetailActions(): DetailActions {
  return useContext(DetailContext);
}
