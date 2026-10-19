import 'server-only';
import { dayIndex, weekStartOf } from '../time';
import type { Assignment, Comment, Course, FileKind, FileRef } from '../types';

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

/** What the pop-up shows beyond the Assignment row. The store turns this into live, mutable state. */
export interface DetailSeed {
  teacher: string;
  instructionsHtml: string;
  attachments: FileRef[];
  /** Files already handed in (submitted fixtures only). */
  myFiles: FileRef[];
  comments: Comment[];
}

const SAMPLE: Record<FileKind, { url: string; mime: string; size: number } | undefined> = {
  pdf: { url: '/mock/sample.pdf', mime: 'application/pdf', size: 17751 },
  image: { url: '/mock/sample.png', mime: 'image/png', size: 109380 },
  video: { url: '/mock/sample.mp4', mime: 'video/mp4', size: 22200 },
  office: { url: '/mock/sample.pdf', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 48210 },
  audio: undefined,
  other: undefined,
};

/** A fixture file pointing at one of the real sample files in public/mock/; Office files preview as the sample PDF. */
function sampleFile(id: string, name: string, kind: 'pdf' | 'image' | 'video' | 'office', createdAt: number): FileRef {
  const sample = SAMPLE[kind]!;
  return {
    id,
    name,
    kind,
    mime: sample.mime,
    size: sample.size,
    // An Office fixture has no real .docx, so it opens the sample PDF both ways.
    url: sample.url,
    ...(kind === 'office' ? { previewPdfUrl: '/mock/sample.pdf' } : {}),
    createdAt,
  };
}

const comment = (id: string, author: string, mine: boolean, createdAt: number, text: string): Comment => ({
  id,
  author,
  mine,
  createdAt,
  text,
});

const MY_NAME = 'Bruce Zheng';

/** Detail content for every assignment id in buildTodo/buildSubmitted; undefined for unknown ids. */
export function buildDetailSeed(id: number, now: number): DetailSeed | undefined {
  const assigned = now - 9 * DAY;
  switch (id) {
    case 101:
      return {
        teacher: 'Daniel Moore',
        instructionsHtml:
          '<h2>我的产品，为谁解决什么问题？</h2>' +
          '<p>请用一页纸回答下面三个问题，写清楚你的产品<strong>为谁</strong>解决<strong>什么问题</strong>。</p>' +
          '<ol><li>你的目标用户是谁？请具体到一类人，而不是&ldquo;所有人&rdquo;。</li>' +
          '<li>他们现在遇到了什么困难？你是怎么知道的？</li>' +
          '<li>你的产品如何让他们的生活变得更好？</li></ol>' +
          '<blockquote>好的问题陈述应该让陌生人读一遍就能明白。</blockquote>' +
          '<p>提交方式：上传文档或照片均可。参考资料见 <a href="https://www.ideo.org/tools">IDEO 设计工具</a>。</p>',
        attachments: [],
        myFiles: [],
        comments: [
          comment('c-101-1', 'Daniel Moore', false, now - 2 * DAY, '截止日期已过，请尽快提交，晚交会标记为 Late。'),
          comment('c-101-2', MY_NAME, true, now - 2 * DAY + HOUR, '好的，今晚提交。'),
        ],
      };
    case 102:
      return {
        teacher: 'Lena Fischer',
        instructionsHtml:
          '<h2>Task 3：开始第一次观察</h2>' +
          '<p>这周请你走进真实场景，<strong>观察</strong>一个人完成日常任务的过程（例如在食堂排队取餐）。</p>' +
          '<ul><li>至少观察 15 分钟，并做笔记或拍照。</li><li>记录他们的动作、停顿和抱怨。</li><li>不要打断，也不要提前下结论。</li></ul>' +
          '<p>附件里有观察记录模板、示范视频和往届优秀作业，请先看完再动手。</p>',
        attachments: [
          sampleFile('fx-102-1', 'Observation worksheet.pdf', 'pdf', assigned),
          sampleFile('fx-102-2', 'Example observation.mp4', 'video', assigned),
          sampleFile('fx-102-3', 'Field notes example.png', 'image', assigned),
          sampleFile('fx-102-4', 'Observation template.docx', 'office', assigned),
        ],
        myFiles: [],
        comments: [],
      };
    case 103:
      return {
        teacher: 'Daniel Moore',
        instructionsHtml:
          '<h2>课后任务：做出你的第一版 MVP</h2>' +
          '<p>用你喜欢的任何工具做出<em>最小可用版本</em>：能让一个真实用户完成一次核心操作即可。</p>' +
          '<ol><li>写下你的 MVP 只做哪一件事。</li><li>做出来，并录屏或截图展示。</li><li>找一位同学试用，记下他卡住的地方。</li></ol>' +
          '<p>提交前请确认文件可以正常打开。</p>',
        attachments: [sampleFile('fx-103-1', 'MVP checklist.pdf', 'pdf', now - DAY)],
        myFiles: [],
        comments: [],
      };
    case 104:
      return {
        teacher: 'Priya Raman',
        instructionsHtml:
          '<h2>Unit 4 Problem Set</h2>' +
          '<p>Complete problems 1&ndash;20 from the attached set. <strong>Show your work</strong>; answers without working earn no credit.</p>' +
          '<ul><li>Photograph handwritten work clearly, one page per photo.</li><li>Label each problem number.</li></ul>',
        attachments: [sampleFile('fx-104-1', 'Unit 4 problem set.pdf', 'pdf', now - 2 * DAY)],
        myFiles: [],
        comments: [],
      };
    case 201:
      return submittedSeed('Priya Raman', '第二单元复习卷', 'Review the attached practice paper and answer every question.', 'Unit 2 review.pdf', now);
    case 202:
      return submittedSeed('Marcus Webb', 'Write Function with return', 'Write three functions that <strong>return</strong> a value and test them.', 'functions.pdf', now);
    case 203:
      return submittedSeed('Sofia Alvarez', '1.8B-[Case Study]-Supply Chain', 'Read the case study and answer the discussion questions.', 'supply-chain.pdf', now);
    case 204:
      return submittedSeed('Henry Cole', 'Lab Report: Projectile Motion', 'Write up your projectile motion lab with data tables and a conclusion.', 'lab-report.pdf', now);
    case 205:
      return submittedSeed('Grace Liu', 'Rhetorical Analysis Draft', 'Draft a rhetorical analysis of the assigned speech.', 'draft.pdf', now);
    case 206:
      return submittedSeed('王老师', '作文：我的校园', '以&ldquo;我的校园&rdquo;为题写一篇 600 字左右的作文。', '作文.pdf', now);
    case 207:
      return submittedSeed('Lena Fischer', 'Task 2：用户访谈提纲', '为你的访谈对象写一份提纲，至少包含五个开放式问题。', '访谈提纲.pdf', now);
    default:
      return undefined;
  }
}

/** Submitted fixtures: short instructions plus one handed-in file, all pointing at the sample PDF. */
function submittedSeed(teacher: string, title: string, task: string, fileName: string, now: number): DetailSeed {
  return {
    teacher,
    instructionsHtml: `<h2>${title}</h2><p>${task}</p>`,
    attachments: [],
    myFiles: [sampleFile(`fx-sub-${fileName}`, fileName, 'pdf', now - 4 * DAY)],
    comments: [],
  };
}
