import type { Assignment, ClassEvent } from '../types';
import { mockData } from './mock';

export type SignInResult = { ok: true; displayName: string } | { ok: false; error: string };

export interface YunguData {
  getTodo(): Promise<Assignment[]>;
  getSubmitted(): Promise<Assignment[]>;
  getWeek(weekStart: number): Promise<ClassEvent[]>;
  signIn(loginId: string, password: string): Promise<SignInResult>;
}

// Swap this for the real Yungu-backed implementation in a later phase.
export const data: YunguData = mockData;
