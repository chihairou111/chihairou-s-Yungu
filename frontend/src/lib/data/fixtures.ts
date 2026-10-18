import 'server-only';
import type { Assignment } from '../types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** One entry of the weekly timetable template. weekday: 0 = Monday. Times are China-time "HH:MM". */
export interface TimetableSlot {
  weekday: number;
  start: string;
  end: string;
  name: string;
  room: string | null;
  isClass: boolean;
}

const cls = (weekday: number, start: string, end: string, name: string, room: string): TimetableSlot => ({
  weekday,
  start,
  end,
  name,
  room,
  isClass: true,
});

const routine = (weekday: number, start: string, end: string, name: string): TimetableSlot => ({
  weekday,
  start,
  end,
  name,
  room: null,
  isClass: false,
});

const GYM = '室内篮球场（台阶）';

function dailyRoutine(weekday: number): TimetableSlot[] {
  return [
    routine(weekday, '07:00', '07:30', 'Wake-up'),
    routine(weekday, '11:25', '12:05', 'Lunch'),
    routine(weekday, '17:30', '18:15', 'Dinner'),
  ];
}

export const TIMETABLE: TimetableSlot[] = [
  // Monday
  ...dailyRoutine(0),
  cls(0, '08:00', '08:40', 'Chinese I', 'D419'),
  cls(0, '08:45', '09:25', 'CL Business I', 'D405'),
  cls(0, '10:00', '10:40', 'P.E. I', GYM),
  cls(0, '10:45', '11:25', 'H Physics I', 'D508'),
  cls(0, '12:30', '13:10', 'H Algebra 2 I', 'D419'),
  cls(0, '13:15', '13:55', 'CL Computer Science Principles I', 'D405'),
  cls(0, '14:10', '14:50', 'CL English Language & Composition 1', 'D421'),
  cls(0, '14:55', '15:35', 'Self Study（System）', 'D413'),
  // Tuesday
  ...dailyRoutine(1),
  cls(1, '08:00', '08:40', 'H Algebra 2 I', 'D419'),
  cls(1, '08:45', '09:25', 'CL English Language & Composition 1', 'D421'),
  cls(1, '09:55', '10:35', 'Chinese I', 'D419'),
  cls(1, '10:45', '11:25', 'CL Computer Science Principles I', 'D405'),
  cls(1, '12:30', '13:10', 'H Physics I', 'D508'),
  cls(1, '13:15', '13:55', 'CL Business I', 'D405'),
  cls(1, '14:10', '14:50', 'EL-AI Create the Future', 'D519'),
  cls(1, '14:55', '15:35', 'Self Study（System）', 'D413'),
  // Wednesday
  ...dailyRoutine(2),
  cls(2, '08:00', '08:40', 'H Physics I', 'D508'),
  cls(2, '08:45', '09:25', 'Chinese I', 'D419'),
  cls(2, '09:55', '10:35', 'Product Design I', 'D519'),
  cls(2, '10:45', '11:25', 'Product Design I', 'D519'),
  cls(2, '12:30', '13:10', 'CL Business I', 'D405'),
  cls(2, '13:15', '13:55', 'H Algebra 2 I', 'D419'),
  cls(2, '14:10', '14:50', 'P.E. I', GYM),
  cls(2, '14:55', '15:35', 'Self Study（System）', 'D413'),
  // Thursday
  ...dailyRoutine(3),
  cls(3, '08:00', '08:40', 'CL Computer Science Principles I', 'D405'),
  cls(3, '08:45', '09:25', 'H Algebra 2 I', 'D419'),
  cls(3, '09:55', '10:35', 'CL English Language & Composition 1', 'D421'),
  cls(3, '10:45', '11:25', 'Chinese I', 'D419'),
  cls(3, '12:30', '13:10', 'EL-AI Create the Future', 'D519'),
  cls(3, '13:15', '13:55', 'H Physics I', 'D508'),
  cls(3, '14:10', '14:50', 'CL Business I', 'D405'),
  cls(3, '14:55', '15:35', 'Self Study（System）', 'D413'),
  // Friday
  ...dailyRoutine(4),
  cls(4, '08:00', '08:40', 'CL English Language & Composition 1', 'D421'),
  cls(4, '08:45', '09:25', 'CL Computer Science Principles I', 'D405'),
  cls(4, '09:55', '10:35', 'H Physics I', 'D508'),
  cls(4, '10:45', '11:25', 'H Algebra 2 I', 'D419'),
  cls(4, '12:30', '13:10', 'Chinese I', 'D419'),
  cls(4, '13:15', '13:55', 'Product Design I', 'D519'),
  cls(4, '14:10', '14:50', 'P.E. I', GYM),
  cls(4, '14:55', '15:35', 'Self Study（System）', 'D413'),
];

/** Assignments are defined relative to `now` so every priority column is populated. */
export function buildTodo(now: number): Assignment[] {
  return [
    {
      id: 101,
      title: '我的产品，为谁解决什么问题？',
      course: 'EL-AI Create the Future',
      dueAt: now - 2 * DAY,
      assignedAt: now - 9 * DAY,
      status: 'To submit',
      estimatedMinutes: 45,
      schoolGroup: 'Delayed',
    },
    {
      id: 102,
      title: 'Task 3：开始第一次观察',
      course: 'Product Design I',
      dueAt: now + 5 * HOUR,
      assignedAt: now - 3 * DAY,
      status: 'To submit',
      estimatedMinutes: 40,
      schoolGroup: 'Due today',
    },
    {
      id: 103,
      title: '课后任务：做出你的第一版 MVP',
      course: 'EL-AI Create the Future',
      dueAt: now + 5 * DAY,
      assignedAt: now - 1 * DAY,
      status: 'To submit',
      estimatedMinutes: 60,
      schoolGroup: null,
    },
    {
      id: 104,
      title: 'Unit 4 Problem Set',
      course: 'H Algebra 2 I',
      dueAt: now + 3 * DAY,
      assignedAt: now - 2 * DAY,
      status: 'To submit',
      estimatedMinutes: 30,
      schoolGroup: null,
    },
  ];
}

export function buildSubmitted(now: number): Assignment[] {
  const done = (
    id: number,
    title: string,
    course: string,
    dueDaysAgo: number,
    submittedOffsetHours: number,
    estimatedMinutes: number | null,
  ): Assignment => {
    const dueAt = now - dueDaysAgo * DAY;
    return {
      id,
      title,
      course,
      dueAt,
      assignedAt: dueAt - 7 * DAY,
      status: 'Submitted',
      estimatedMinutes,
      schoolGroup: null,
      submittedAt: dueAt + submittedOffsetHours * HOUR,
    };
  };
  return [
    done(201, '第二单元复习卷', 'H Algebra 2 I', 3, 20, 50), // late
    done(202, 'Write Function with return', 'CL Computer Science Principles I', 5, -6, 30),
    done(203, '1.8B-[Case Study]-Supply Chain', 'CL Business with Personal Finance I', 6, -20, 45),
    done(204, 'Lab Report: Projectile Motion', 'H Physics I', 8, -3, 60),
    done(205, 'Rhetorical Analysis Draft', 'CL English Language & Composition 1', 10, -12, 90),
    done(206, '作文：我的校园', 'Chinese I', 12, -30, null),
    done(207, 'Task 2：用户访谈提纲', 'Product Design I', 14, -2, 40),
  ];
}
