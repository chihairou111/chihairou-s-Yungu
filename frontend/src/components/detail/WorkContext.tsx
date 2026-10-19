'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { AssignmentDetail } from '@/lib/types';
import { useWork, type Work } from './useWork';

const WorkContext = createContext<Work | null>(null);

/**
 * Holds the student's work on the open assignment above the views that show it, so the file list, the
 * draft-save queue, uploads in flight and a fresh hand-in survive switching to the writer and back
 * (Your work unmounts meanwhile; the writer adds its PDF through the same context). Key it by task id.
 */
export function WorkProvider({ detail, children }: { detail: AssignmentDetail; children: ReactNode }) {
  const work = useWork(detail);
  return <WorkContext.Provider value={work}>{children}</WorkContext.Provider>;
}

/** The open assignment's work (files, status, add/remove/submit). Only inside a `WorkProvider`. */
export function useWorkContext(): Work {
  const work = useContext(WorkContext);
  if (!work) throw new Error('useWorkContext needs a WorkProvider');
  return work;
}
