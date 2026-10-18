import 'server-only';
import { dayIndex, weekStartOf } from '../time';
import type { Assignment, Course } from '../types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * Every course the fixtures reference, each with a fixed Google Calendar color. The timetable calls
 * the business course "CL Business I" while assignments use its full name; both map to one course.
 */
export const COURSES = {
  chinese: { id: 1, name: 'Chinese I', color: 'Tomato' },
  business: { id: 2, name: 'CL Business with Personal Finance I', color: 'Tangerine' },
  pe: { id: 3, name: 'P.E. I', color: 'Sage' },
  physics: { id: 4, name: 'H Physics I', color: 'Peacock' },
  algebra: { id: 5, name: 'H Algebra 2 I', color: 'Blueberry' },
  csp: { id: 6, name: 'CL Computer Science Principles I', color: 'Basil' },
  english: { id: 7, name: 'CL English Language & Composition 1', color: 'Grape' },
  selfStudy: { id: 8, name: 'Self Study（System）', color: 'Graphite' },
  elai: { id: 9, name: 'EL-AI Create the Future', color: 'Flamingo' },
  design: { id: 10, name: 'Product Design I', color: 'Banana' },
} as const satisfies Record<string, Course>;

type CourseKey = keyof typeof COURSES;

/** One entry of the weekly timetable template. weekday: 0 = Monday. Times are China-time "HH:MM". */
export interface TimetableSlot {
  weekday: number;
  start: string;
  end: string;
  name: string;
  room: string | null;
  isClass: boolean;
  courseId: number | null;
}

/** A class slot; `name` overrides the course name where the timetable abbreviates it. */
const cls = (weekday: number, start: string, end: string, course: CourseKey, room: string, name?: string): TimetableSlot => ({
  weekday,
  start,
  end,
  name: name ?? COURSES[course].name,
  room,
  isClass: true,
  courseId: COURSES[course].id,
});

const routine = (weekday: number, start: string, end: string, name: string): TimetableSlot => ({
  weekday,
  start,
  end,
  name,
  room: null,
  isClass: false,
  courseId: null,
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
  cls(0, '08:00', '08:40', 'chinese', 'D419'),
  cls(0, '08:45', '09:25', 'business', 'D405', 'CL Business I'),
  cls(0, '10:00', '10:40', 'pe', GYM),
  cls(0, '10:45', '11:25', 'physics', 'D508'),
  cls(0, '12:30', '13:10', 'algebra', 'D419'),
  cls(0, '13:15', '13:55', 'csp', 'D405'),
  cls(0, '14:10', '14:50', 'english', 'D421'),
  cls(0, '14:55', '15:35', 'selfStudy', 'D413'),
  // Tuesday
  ...dailyRoutine(1),
  cls(1, '08:00', '08:40', 'algebra', 'D419'),
  cls(1, '08:45', '09:25', 'english', 'D421'),
  cls(1, '09:55', '10:35', 'chinese', 'D419'),
  cls(1, '10:45', '11:25', 'csp', 'D405'),
  cls(1, '12:30', '13:10', 'physics', 'D508'),
  cls(1, '13:15', '13:55', 'business', 'D405', 'CL Business I'),
  cls(1, '14:10', '14:50', 'elai', 'D519'),
  cls(1, '14:55', '15:35', 'selfStudy', 'D413'),
  // Wednesday
  ...dailyRoutine(2),
  cls(2, '08:00', '08:40', 'physics', 'D508'),
  cls(2, '08:45', '09:25', 'chinese', 'D419'),
  cls(2, '09:55', '10:35', 'design', 'D519'),
  cls(2, '10:45', '11:25', 'design', 'D519'),
  cls(2, '12:30', '13:10', 'business', 'D405', 'CL Business I'),
  cls(2, '13:15', '13:55', 'algebra', 'D419'),
  cls(2, '14:10', '14:50', 'pe', GYM),
  cls(2, '14:55', '15:35', 'selfStudy', 'D413'),
  // Thursday
  ...dailyRoutine(3),
  cls(3, '08:00', '08:40', 'csp', 'D405'),
  cls(3, '08:45', '09:25', 'algebra', 'D419'),
  cls(3, '09:55', '10:35', 'english', 'D421'),
  cls(3, '10:45', '11:25', 'chinese', 'D419'),
  cls(3, '12:30', '13:10', 'elai', 'D519'),
  cls(3, '13:15', '13:55', 'physics', 'D508'),
  cls(3, '14:10', '14:50', 'business', 'D405', 'CL Business I'),
  cls(3, '14:55', '15:35', 'selfStudy', 'D413'),
  // Friday
  ...dailyRoutine(4),
  cls(4, '08:00', '08:40', 'english', 'D421'),
  cls(4, '08:45', '09:25', 'csp', 'D405'),
  cls(4, '09:55', '10:35', 'physics', 'D508'),
  cls(4, '10:45', '11:25', 'algebra', 'D419'),
  cls(4, '12:30', '13:10', 'chinese', 'D419'),
  cls(4, '13:15', '13:55', 'design', 'D519'),
  cls(4, '14:10', '14:50', 'pe', GYM),
  cls(4, '14:55', '15:35', 'selfStudy', 'D413'),
];

/** 22:00 China time, `days` China calendar days after the day containing `now` (negative = before). */
function at22(now: number, days: number): number {
  const weekStart = weekStartOf(now);
  return weekStart + (dayIndex(now, weekStart) + days) * DAY + 22 * HOUR;
}

/** The next 22:00 China time after `now`: always in the future and at most 24 hours away. */
function next22(now: number): number {
  const today = at22(now, 0);
  return today > now ? today : at22(now, 1);
}

/**
 * Assignments are defined relative to `now` so every priority column is populated, with due times
 * snapped to 22:00 China time like real deadlines.
 */
export function buildTodo(now: number): Assignment[] {
  return [
    {
      id: 101,
      title: '我的产品，为谁解决什么问题？',
      course: 'EL-AI Create the Future',
      courseId: COURSES.elai.id,
      dueAt: at22(now, -2),
      assignedAt: now - 9 * DAY,
      status: 'To submit',
      estimatedMinutes: 45,
      schoolGroup: 'Delayed',
    },
    {
      id: 102,
      title: 'Task 3：开始第一次观察',
      course: 'Product Design I',
      courseId: COURSES.design.id,
      dueAt: next22(now),
      assignedAt: now - 3 * DAY,
      status: 'To submit',
      estimatedMinutes: 40,
      schoolGroup: 'Due today',
    },
    {
      id: 103,
      title: '课后任务：做出你的第一版 MVP',
      course: 'EL-AI Create the Future',
      courseId: COURSES.elai.id,
      dueAt: at22(now, 5),
      assignedAt: now - 1 * DAY,
      status: 'To submit',
      estimatedMinutes: 60,
      schoolGroup: null,
    },
    {
      id: 104,
      title: 'Unit 4 Problem Set',
      course: 'H Algebra 2 I',
      courseId: COURSES.algebra.id,
      dueAt: at22(now, 3),
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
    course: CourseKey,
    dueDaysAgo: number,
    submittedOffsetHours: number,
    estimatedMinutes: number | null,
  ): Assignment => {
    const dueAt = at22(now, -dueDaysAgo);
    return {
      id,
      title,
      course: COURSES[course].name,
      courseId: COURSES[course].id,
      dueAt,
      assignedAt: dueAt - 7 * DAY,
      status: 'Submitted',
      estimatedMinutes,
      schoolGroup: null,
      submittedAt: dueAt + submittedOffsetHours * HOUR,
    };
  };
  return [
    done(201, '第二单元复习卷', 'algebra', 3, 20, 50), // late
    done(202, 'Write Function with return', 'csp', 5, -6, 30),
    done(203, '1.8B-[Case Study]-Supply Chain', 'business', 6, -20, 45),
    done(204, 'Lab Report: Projectile Motion', 'physics', 8, -3, 60),
    done(205, 'Rhetorical Analysis Draft', 'english', 10, -12, 90),
    done(206, '作文：我的校园', 'chinese', 12, -30, null),
    done(207, 'Task 2：用户访谈提纲', 'design', 14, -2, 40),
  ];
}

export function buildCourses(): Course[] {
  return Object.values(COURSES).map((c) => ({ ...c }));
}
