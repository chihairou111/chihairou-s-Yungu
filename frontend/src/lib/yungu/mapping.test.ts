/* eslint-disable @typescript-eslint/no-explicit-any */
// Port of api/tests/test_mapping.py. The fixtures are anonymised (scripts/anonymise-fixtures.mjs): names,
// titles and ids differ from the recorded ones, so the expected values below are the anonymised ones.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUBMITTED, YunguClient } from './client';
import * as mapping from './mapping';

const FIXTURES = join(__dirname, 'fixtures');
const load = (name: string): any => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
const NOW = 1792800000000;
const ME = 342; // the fixture student's userId (stuId in the behaviour rows)

const ASSIGNMENT_KEYS = ['id', 'title', 'course', 'courseId', 'dueAt', 'assignedAt', 'status', 'estimatedMinutes', 'schoolGroup', 'revision'];
const DETAIL_KEYS = [
  ...ASSIGNMENT_KEYS,
  ...['teacher', 'instructionsHtml', 'attachments', 'myFiles', 'submittedFileIds', 'submitted', 'comments', 'needsFiles', 'feedback'],
];
const FILE_KEYS = ['id', 'name', 'kind', 'mime', 'size', 'url', 'createdAt'];
const keys = (o: object) => Object.keys(o).sort();
const without = (o: Record<string, any>, ...drop: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !drop.includes(k)));

/** China wall clock -> epoch ms. */
const ms = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h - 8, mi, s);

function tasks(page: any): any[] {
  return page.data.flatMap((g: any) => g.taskList.map((t: any) => ({ ...t, group: g.groupName })));
}

// --------------------------------------------------------------------- times
describe('chinaMs', () => {
  it('reads wall-clock as UTC+8 whatever the host zone', () => {
    expect(mapping.chinaMs('2026-10-19 22:32:19')).toBe(ms(2026, 10, 19, 22, 32, 19));
    expect(mapping.chinaMs('2026-10-18 17:17:12.0')).toBe(ms(2026, 10, 18, 17, 17, 12));
    expect(mapping.chinaMs('2026-10-19 10:45:00.5')).toBe(ms(2026, 10, 19, 10, 45, 0) + 500);
    expect(mapping.chinaMs(null)).toBeNull();
    expect(mapping.chinaMs('')).toBeNull();
    expect(mapping.chinaMs('junk')).toBeNull();
  });

  it('accepts minute precision', () => {
    expect(mapping.chinaMs('2026-10-20 16:08')).toBe(ms(2026, 10, 20, 16, 8));
  });
});

// --------------------------------------------------------------- assignments
describe('assignment', () => {
  it('maps every TS field of a to-do item', () => {
    const raw = tasks(load('todo_page.json'))[0];
    const a = mapping.assignment(raw, raw.group, NOW);
    expect(keys(a)).toEqual([...ASSIGNMENT_KEYS].sort()); // no submittedAt on work that is not handed in
    expect(a).toEqual({
      id: 44157, title: 'Lorem title 2', course: 'Course 10', courseId: 2713,
      dueAt: raw.deadlineTimeMillis, assignedAt: raw.publishTimeMillis,
      status: 'To submit', estimatedMinutes: 60, schoolGroup: 'Due recently', revision: false,
    });
    expect(a.dueAt).toBe(ms(2026, 10, 23, 22));
  });

  // Live 2026-11-04: a teacher sent the work back. Yungu lists it in To-do under "Due update" with
  // doTaskStatus "To edit" (id 3), ifTimeout false and the original, past deadline.
  it.each<[Record<string, unknown>, string | null]>([
    [{ doTaskStatus: 'To edit', doTaskStatusId: 3 }, 'Due update'],
    [{ doTaskStatus: 'To edit' }, 'Due recently'],
    [{ doTaskStatusId: 3 }, null],
    [{}, 'Due update'],
  ])('marks work returned for revision (%j, group %s)', (change, group) => {
    const raw = { ...tasks(load('todo_page.json'))[0], ...change, ifTimeout: false };
    const a = mapping.assignment(raw, group, NOW);
    expect(a.revision).toBe(true);
    expect(a.status).toBe('To submit');
    expect('submittedAt' in a).toBe(false);
    expect(a.schoolGroup).toBe(group !== null && ['Due today', 'Due recently', 'Delayed'].includes(group) ? group : null);
  });

  it('ordinary to-do and submitted work is not revision', () => {
    for (const page of ['todo_page.json', 'submitted_page1.json']) {
      for (const t of tasks(load(page))) expect(mapping.assignment(t, t.group, NOW).revision).toBe(false);
    }
  });

  it.each<[string | null, string | null]>([
    ['Due today', 'Due today'], ['Due recently', 'Due recently'], ['Delayed', 'Delayed'],
    ['list', null], ['', null], [null, null], ['Something new', null],
  ])('schoolGroup comes from the group name (%s)', (group, expected) => {
    const raw = tasks(load('todo_page.json'))[0];
    expect(mapping.assignment(raw, group, NOW).schoolGroup).toBe(expected);
  });

  it.each<[number | null, number | null]>([[60, 60], [0, null], [null, null]])(
    'estimatedMinutes is null when unset (%s)',
    (minutes, expected) => {
      const raw = { ...tasks(load('todo_page.json'))[0], expectFinishTime: minutes };
      expect(mapping.assignment(raw, 'Due today', NOW).estimatedMinutes).toBe(expected);
    },
  );

  it('uses modifiedTime as submittedAt for submitted work', () => {
    const raw = tasks(load('submitted_page1.json'))[0];
    const a = mapping.assignment(raw, raw.group, NOW);
    expect(a.status).toBe('Submitted');
    expect(a.schoolGroup).toBeNull();
    // modifiedTime is China wall-clock "YYYY-MM-DD HH:MM:SS"; the list carries no other hand-in time.
    expect(a.submittedAt).toBe(mapping.chinaMs(raw.modifiedTime));
    expect(keys(a)).toEqual([...ASSIGNMENT_KEYS, 'submittedAt'].sort());
  });

  it('a late submission has submittedAt after due', () => {
    const late = tasks(load('submitted_page1.json')).filter((t) => t.ifTimeout);
    expect(late.length, 'fixture should hold a late submission').toBeGreaterThan(0);
    const a = mapping.assignment(late[0], 'list', NOW);
    expect(a.submittedAt!).toBeGreaterThan(a.dueAt);
  });

  it('a comment-bumped modifiedTime cannot make on-time work late', () => {
    const raw = { ...tasks(load('submitted_page1.json'))[0], ifTimeout: false, modifiedTime: '2099-01-01 00:00:00' };
    const a = mapping.assignment(raw, 'list', NOW);
    expect(a.submittedAt).toBe(a.dueAt); // not > dueAt, so not shown as late
  });

  it('the late flag keeps submittedAt after due even if modifiedTime is earlier', () => {
    const raw = { ...tasks(load('submitted_page1.json'))[0], ifTimeout: true, modifiedTime: '2000-01-01 00:00:00' };
    const a = mapping.assignment(raw, 'list', NOW);
    expect(a.submittedAt).toBe(a.dueAt + 1);
  });

  it('an on-time hand-in before the deadline is untouched', () => {
    const raw = { ...tasks(load('submitted_page1.json'))[0], ifTimeout: false };
    const a = mapping.assignment(raw, 'list', NOW);
    expect(a.submittedAt).toBe(mapping.chinaMs(raw.modifiedTime));
    expect(a.submittedAt!).toBeLessThanOrEqual(a.dueAt);
  });

  it('submitted without modifiedTime falls back without inventing lateness', () => {
    const raw = { ...tasks(load('submitted_page1.json'))[0], modifiedTime: null };
    let a = mapping.assignment(raw, 'list', 10 ** 15);
    expect(a.submittedAt).toBe(a.dueAt);
    a = mapping.assignment(raw, 'list', a.dueAt - 1); // never in the future
    expect(a.submittedAt).toBe(a.dueAt - 1);
  });

  it('85 submitted items over several pages give 85 unique ids', async () => {
    const template = tasks(load('submitted_page1.json'))[0];
    const items = Array.from({ length: 85 }, (_, i) => ({ ...template, taskPublishId: 90000 + i, title: `Task ${i}` }));
    class Fake extends YunguClient {
      async listTasks(status: number, page: number, pageSize: number): Promise<any> {
        expect(status).toBe(SUBMITTED);
        const chunk = items.slice((page - 1) * pageSize, page * pageSize);
        const data = chunk.length ? [{ groupName: 'list', count: chunk.length, taskList: chunk }] : [];
        return { pageNum: page, pageSize, total: items.length, data };
      }
    }
    const c = new Fake('id', 'pw', async () => {
      throw new Error('no network');
    });
    const mapped = (await c.iterTasks(SUBMITTED, 10)).map((t) => mapping.assignment(t, t.group, NOW));
    expect(mapped).toHaveLength(85);
    expect(new Set(mapped.map((a) => a.id)).size).toBe(85);
  });

  it('the real submitted page has unique ids', () => {
    const ids = tasks(load('submitted_page1.json')).map((t) => t.taskPublishId);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });
});

// ------------------------------------------------------------------ calendar
describe('classEvent', () => {
  it('maps class and routine items', () => {
    const events = load('week.json').flatMap((day: any[]) => day.map((e) => mapping.classEvent(e)));
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(keys(e)).toEqual(['courseId', 'end', 'isClass', 'name', 'room', 'start']);
    const classes = events.filter((e: any) => e.isClass);
    const routines = events.filter((e: any) => !e.isClass);
    expect(classes.length).toBeGreaterThan(0);
    expect(routines.length).toBeGreaterThan(0);
    for (const e of classes) {
      expect(e.courseId).not.toBeNull();
      expect(e.courseId).toBeGreaterThan(0);
    }
    for (const e of routines) expect(e.courseId).toBeNull();
    const chinese = classes.find((e: any) => e.name === 'Course 2'); // eName: the UI is English
    expect(chinese.room).toBe('Room 1');
    expect(chinese.start).toBe(1792370400000);
    expect(chinese.end).toBe(1792372800000);
    expect(routines.find((e: any) => e.room === null)).toBeDefined(); // a routine item has no room
  });

  it('falls back to name and a blank room', () => {
    const e = mapping.classEvent({ name: '语文', eName: null, startTime: 1, endTime: 2, playground: '', courseId: 0 });
    expect(e).toEqual({ name: '语文', room: null, start: 1, end: 2, isClass: false, courseId: null });
  });
});

// ------------------------------------------------------------------- courses
const PALETTE = ['Tomato', 'Flamingo', 'Tangerine', 'Banana', 'Sage', 'Basil', 'Peacock', 'Blueberry', 'Lavender', 'Grape', 'Graphite'];

describe('courses', () => {
  it('colours follow sort order and cycle', () => {
    const raw = load('courses.json');
    const out = mapping.courses(raw);
    expect(out).toHaveLength(13);
    expect(raw).toHaveLength(13);
    const order = [...raw]
      .sort((a: any, b: any) => a.sortNo - b.sortNo || a.courseId - b.courseId)
      .map((c: any) => c.courseId);
    expect(out.map((c) => c.id)).toEqual(order);
    expect(out.map((c) => c.color)).toEqual(Array.from({ length: 13 }, (_, i) => PALETTE[i % 11])); // 12th, 13th wrap round
    for (const c of out) expect(keys(c)).toEqual(['color', 'id', 'name']);
    expect(out.find((c) => c.id === 2713)!.name).toBe('Course 10');
  });

  it('colours are stable whatever order the service returns', () => {
    const raw = load('courses.json');
    const base = Object.fromEntries(mapping.courses(raw).map((c) => [c.id, c.color]));
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let n = 0; n < 5; n++) {
      const shuffled = [...raw];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      expect(Object.fromEntries(mapping.courses(shuffled).map((c) => [c.id, c.color]))).toEqual(base);
    }
  });

  it('a course with a missing sortNo sorts last', () => {
    const out = mapping.courses([
      { courseId: 2, courseName: 'B', sortNo: null },
      { courseId: 1, courseName: 'A', sortNo: 5 },
    ]);
    expect(out.map((c) => c.id)).toEqual([1, 2]);
  });
});

// --------------------------------------------------------------------- files
const rawFile = (name: string, type: string | null = 'pdf', size: number | null = 10, created: string | null = '2026-10-16 11:25:20.0', fid = 7) => ({
  fileId: fid, fileName: name, type, fileSizeByte: size, fileCreateTime: created,
});

describe('fileRef', () => {
  it('pdf', () => {
    const raw = load('mixed_attachments.json').fileList[1];
    const f = mapping.fileRef(raw);
    expect(keys(f)).toEqual([...FILE_KEYS].sort());
    expect(f.kind).toBe('pdf');
    expect(f.mime).toBe('application/pdf');
    expect(f.name.endsWith('.pdf')).toBe(true);
    expect(f.id).toBe(String(raw.fileId));
    expect(f.url).toBe(`/api/files/${f.id}`);
    expect('previewPdfUrl' in f).toBe(false);
    expect(f.size).toBe(3876267);
  });

  it('ids, urls and China time', () => {
    const f = mapping.fileRef(rawFile('one.txt', 'txt', 13, '2026-10-18 17:17:12.0', 11128687));
    expect(f).toEqual({
      id: '11128687', name: 'one.txt', kind: 'other', mime: 'text/plain', size: 13,
      url: '/api/files/11128687', createdAt: ms(2026, 10, 18, 17, 17, 12),
    });
  });

  it.each([
    ['a.pdf', 'pdf'], ['A.PDF', 'pdf'], ['x.png', 'image'], ['x.JPG', 'image'], ['x.heic', 'image'],
    ['clip.mp4', 'video'], ['clip.mov', 'video'], ['song.m4a', 'audio'], ['song.mp3', 'audio'],
    ['n.docx', 'office'], ['n.xlsx', 'office'], ['n.pptx', 'office'], ['n.doc', 'office'],
    ['n.pages', 'office'], ['n.numbers', 'office'], ['n.key', 'office'],
    ['n.txt', 'other'], ['noext', 'other'], ['archive.zip', 'other'],
  ])('kind from the extension of %s', (name, kind) => {
    expect(mapping.fileRef(rawFile(name, 'whatever')).kind).toBe(kind);
  });

  it('office files get a PDF preview url', () => {
    const f = mapping.fileRef(rawFile('report.docx', 'doc', 10, undefined, 42));
    expect(f.kind).toBe('office');
    expect(f.url).toBe('/api/files/42');
    expect(f.previewPdfUrl).toBe('/api/files/42?preview=1');
    expect(f.mime).toContain('wordprocessingml');
  });

  it("Yungu's type is only a fallback when the extension says nothing", () => {
    expect(mapping.fileRef(rawFile('scan', 'pdf')).kind).toBe('pdf');
    expect(mapping.fileRef(rawFile('scan', 'image')).kind).toBe('image');
    expect(mapping.fileRef(rawFile('scan', 'link')).kind).toBe('other');
    // ...but a known extension wins over a misleading type ("pdf" is what Yungu says for .numbers).
    expect(mapping.fileRef(rawFile('t.numbers', 'pdf')).kind).toBe('office');
  });

  it('tolerates a missing size and time', () => {
    const f = mapping.fileRef({ fileId: 1, fileName: 'x.bin', type: null, fileSizeByte: null, fileCreateTime: null });
    expect(f.size).toBe(0);
    expect(f.createdAt).toBe(0);
    expect(f.mime).toBe('application/octet-stream');
  });
});

// ------------------------------------------------------------------ comments
describe('comment', () => {
  it('maps author, mine, time and text', () => {
    const raw = load('comments_sample.json');
    expect(mapping.comment(raw[1], ME)).toEqual({
      id: '340558', author: 'Student C Alias 1', mine: true, createdAt: ms(2026, 10, 19, 22, 32, 19), text: 'Lorem comment 2',
    });
    const other = mapping.comment(raw[0], ME);
    expect(other.mine).toBe(false);
    expect(other.author).toBe('Teacher 1'); // no eName: no trailing space
    expect(other.id).toBe('289850');
  });

  it('mine ignores deletePermission', () => {
    const raw = load('comments_sample.json');
    expect(raw[1].deletePermission).toBe(false);
    expect(mapping.comment(raw[1], ME).mine).toBe(true);
    expect(raw[2].deletePermission).toBe(true);
    expect(mapping.comment(raw[2], ME).mine).toBe(false);
  });

  it('reads a time with a fraction', () => {
    expect(mapping.comment(load('comments_sample.json')[2], ME).createdAt).toBe(ms(2026, 10, 19, 9));
  });
});

// -------------------------------------------------------------------- detail
const detailOf = (mixed: any, ach: any, comments: any[], kept: string[] | null, listed?: any) =>
  mapping.detail(mixed, ach, comments, ME, kept, listed);

describe('detail', () => {
  it('of a submitted assignment', () => {
    const d = detailOf(load('mixed_submitted.json'), load('achievement_submitted.json'), [], null);
    expect(keys(d)).toEqual([...DETAIL_KEYS].sort());
    expect(d.id).toBe(21685);
    expect(d.title).toBe('Lorem title 1');
    expect(d.course).toBe('Course 10');
    expect(d.courseId).toBe(2713);
    expect(d.dueAt).toBe(ms(2026, 10, 16, 22));
    expect(d.assignedAt).toBe(ms(2026, 10, 9, 11, 37, 25));
    expect(d.estimatedMinutes).toBe(30);
    expect(d.status).toBe('Submitted');
    expect(d.submitted).toBe(true);
    expect(d.teacher).toBe('Teacher 1, Teacher 2');
    expect(d.instructionsHtml).toContain('<strong>'); // raw HTML; sanitising is a separate step
    expect(d.attachments).toEqual([]);
    expect(d.myFiles.map((f) => f.name)).toEqual(['File 1.txt']);
    expect(d.submittedFileIds).toEqual(['36355566']); // unknown hand-in list: the current files
    expect(d.comments).toEqual([]);
    expect(d.schoolGroup).toBeNull();
  });

  it('of a to-do assignment', () => {
    const d = detailOf(load('mixed_todo.json'), load('achievement_todo.json'), [], null);
    expect(d.id).toBe(44157);
    expect(d.status).toBe('To submit');
    expect(d.submitted).toBe(false);
    expect(d.myFiles).toEqual([]);
    expect(d.submittedFileIds).toEqual([]);
    expect('submittedAt' in d).toBe(false);
  });

  it("uses the service's kept submitted ids", () => {
    const ach = load('achievement_submitted.json');
    ach.ifEditStatus = true; // a draft differs from the hand-in
    let d = detailOf(load('mixed_submitted.json'), ach, [], ['1', '2']);
    expect(d.submittedFileIds).toEqual(['1', '2']);
    ach.achievementStatus = 1;
    d = detailOf(load('mixed_submitted.json'), ach, [], ['1', '2']);
    expect(d.submitted).toBe(false);
    expect(d.submittedFileIds).toEqual([]); // empty before the first hand-in
  });

  it("with no draft open Yungu's file list is the hand-in", () => {
    const ach = load('achievement_submitted.json');
    expect(ach.ifEditStatus).toBe(false);
    expect(ach.achievementStatus).toBe(4);
    const d = detailOf(load('mixed_submitted.json'), ach, [], ['1', '2']); // a stale kept list
    expect(d.submittedFileIds).toEqual(['36355566']);
    expect(mapping.handInOnYungu(load('mixed_submitted.json'), ach)).toEqual(['36355566']);
  });

  it.each<Record<string, unknown>>([{ ifEditStatus: true }, { ifEditStatus: null }, { achievementStatus: 1 }])(
    'Yungu shows no hand-in while a draft is open or before one (%j)',
    (change) => {
      const ach = { ...load('achievement_submitted.json'), ...change };
      expect(mapping.handInOnYungu(load('mixed_submitted.json'), ach)).toBeNull();
    },
  );

  it('with a draft open and no kept list every current file counts as handed in', () => {
    const ach = { ...load('achievement_submitted.json'), ifEditStatus: true };
    expect(detailOf(load('mixed_submitted.json'), ach, [], null).submittedFileIds).toEqual(['36355566']);
  });

  it('comments are oldest first', () => {
    const raw = load('comments_sample.json'); // fixture is newest first, as the API returns it
    const d = detailOf(load('mixed_submitted.json'), load('achievement_submitted.json'), raw, null);
    expect(d.comments.map((c) => c.id)).toEqual(['481940', '340558', '289850']);
    expect(d.comments.map((c) => c.mine)).toEqual([false, true, false]);
  });

  it('attachments skip embedded links and keep the rest', () => {
    const mixed = load('mixed_attachments.json');
    const d = detailOf(mixed, load('achievement_todo.json'), [], null);
    expect(mixed.fileList).toHaveLength(10);
    expect(d.attachments).toHaveLength(9); // the one 'link' is an embed
    const kinds = Object.fromEntries(d.attachments.map((f) => [f.name.split('.').pop(), f.kind]));
    expect(kinds.pdf).toBe('pdf');
    expect(kinds.mp4).toBe('video');
    expect(kinds.numbers).toBe('office');
    for (const f of d.attachments) expect(f.url).toBe(`/api/files/${f.id}`);
  });

  it('takes group and submittedAt from the listing', () => {
    const d = detailOf(load('mixed_submitted.json'), load('achievement_submitted.json'), [], null, { schoolGroup: 'Delayed', submittedAt: 123 });
    expect(d.schoolGroup).toBe('Delayed');
    expect(d.submittedAt).toBe(123);
  });

  it('takes revision from the to-do listing', () => {
    const mixed = load('mixed_todo.json');
    const achievement = load('achievement_todo.json');
    expect(detailOf(mixed, achievement, [], null).revision).toBe(false);
    expect(detailOf(mixed, achievement, [], null, { revision: true }).revision).toBe(true);
    // Handed in again: no longer waiting on a revision, whatever a stale list row says.
    const submitted = detailOf(load('mixed_submitted.json'), load('achievement_submitted.json'), [], null, { revision: true });
    expect(submitted.revision).toBe(false);
  });

  it('without an end time takes the listed due or no deadline', () => {
    const mixed = { ...load('mixed_submitted.json'), endTime: null };
    let d = detailOf(mixed, load('achievement_submitted.json'), [], null, { dueAt: 5, submittedAt: 5 });
    expect(d.dueAt).toBe(5);
    expect(d.submittedAt).toBe(5);
    d = detailOf(mixed, load('achievement_submitted.json'), [], null);
    expect(d.dueAt).toBe(mapping.NO_DEADLINE_MS);
  });

  it('needsFiles', () => {
    const mixed = load('mixed_submitted.json');
    const ach = load('achievement_submitted.json');
    expect(ach.needEnclosure).toBe(false);
    expect(detailOf(mixed, ach, [], null).needsFiles).toBe(false);
    // Achievement wins over the task-level flag; missing everywhere defaults to true (safe).
    expect(detailOf({ ...mixed, needEnclosure: false }, { ...ach, needEnclosure: true }, [], null).needsFiles).toBe(true);
    const ach2 = without(ach, 'needEnclosure');
    const mixed2 = without(mixed, 'needEnclosure');
    expect(detailOf(mixed2, ach2, [], null).needsFiles).toBe(true);
    expect(detailOf({ ...mixed2, needEnclosure: false }, ach2, [], null).needsFiles).toBe(false);
  });

  it('a null needEnclosure means files are required', () => {
    // Yungu sending needEnclosure: null is "unknown", like a missing key: never offer a no-file hand-in.
    const mixed = load('mixed_submitted.json');
    const ach = load('achievement_submitted.json');
    const mixedMissing = without(mixed, 'needEnclosure');
    expect(detailOf(mixedMissing, { ...ach, needEnclosure: null }, [], null).needsFiles).toBe(true);
    expect(detailOf({ ...mixed, needEnclosure: null }, { ...ach, needEnclosure: null }, [], null).needsFiles).toBe(true);
    expect(detailOf({ ...mixed, needEnclosure: null }, { ...ach, needEnclosure: false }, [], null).needsFiles).toBe(false);
  });

  it('carries the feedback', () => {
    const sample = load('feedback_samples.json').numeric_comment;
    const mixed = { ...load('mixed_submitted.json'), ...sample.mixed };
    const achievement = { ...load('achievement_submitted.json'), ...sample.achievement };
    expect(detailOf(mixed, achievement, [], null).feedback!.score).toBe('4.5/5');
    expect(detailOf(load('mixed_submitted.json'), load('achievement_submitted.json'), [], null).feedback).toBeNull();
  });
});

// --------------------------------------------------------------- no deadline
describe('no deadline', () => {
  it('a submitted item is due at its hand-in and never late', () => {
    const raw = { ...tasks(load('submitted_page1.json'))[0], deadlineTimeMillis: null, deadline: null };
    for (const late of [true, false, null]) {
      const a = mapping.assignment({ ...raw, ifTimeout: late }, 'list', NOW);
      expect(a.submittedAt).toBe(mapping.chinaMs(raw.modifiedTime));
      expect(a.submittedAt).toBe(a.dueAt);
      expect(Number.isInteger(a.assignedAt)).toBe(true);
    }
    const a = mapping.assignment({ ...raw, modifiedTime: null }, 'list', NOW);
    expect(a.submittedAt).toBe(NOW); // no hand-in time either: now
    expect(a.dueAt).toBe(NOW);
  });

  it('a to-do item sorts last and is never overdue', () => {
    const raw = { ...tasks(load('todo_page.json'))[0], deadlineTimeMillis: null, deadline: null };
    let a = mapping.assignment(raw, raw.group, NOW);
    expect(a.dueAt).toBe(mapping.NO_DEADLINE_MS);
    expect(a.dueAt).toBeGreaterThan(NOW);
    expect(Number.isInteger(a.dueAt)).toBe(true);
    expect(mapping.NO_DEADLINE_MS).toBe(ms(2099, 12, 31, 23, 59, 59));
    a = mapping.assignment({ ...raw, publishTimeMillis: null }, raw.group, NOW);
    expect(a.assignedAt).toBe(mapping.NO_DEADLINE_MS);
  });
});

// ----------------------------------------------------------- online documents
describe('online documents', () => {
  it('are marked and have no preview', () => {
    const raw = {
      fileId: 11117133, fileName: 'my favorite department', type: 'onlineDocument',
      url: '{"ops":[{"insert":"text"}]}', fileCreateTime: null, fileSizeByte: null,
    };
    const f = mapping.fileRef(raw);
    expect(f.online).toBe(true);
    expect(f.kind).toBe('other');
    expect('previewPdfUrl' in f).toBe(false);
    expect(f.url).toBe('/api/files/11117133');
    expect(f.size).toBe(0);
    expect('online' in mapping.fileRef({ fileId: 1, fileName: 'a.pdf', type: 'pdf' })).toBe(false);
  });

  it('carry their content', () => {
    const delta = readFileSync(join(FIXTURES, 'online_doc_delta.json'), 'utf8');
    const f = mapping.fileRef({ fileId: 11138501, fileName: 'doc', type: 'onlineDocument', url: delta, storeMeta: delta });
    expect(f.online).toBe(true);
    expect(f.content).toBe(delta);
  });

  it('content falls back to url, then empty', () => {
    const base = { fileId: 1, fileName: 'd', type: 'onlineDocument' };
    expect(mapping.fileRef({ ...base, storeMeta: null, url: '{"ops":[]}' }).content).toBe('{"ops":[]}');
    expect(mapping.fileRef({ ...base, storeMeta: '', url: null }).content).toBe('');
  });

  it('a plain file ref has no content', () => {
    expect('content' in mapping.fileRef({ fileId: 1, fileName: 'a.pdf', type: 'pdf' })).toBe(false);
  });

  it('the constant is Yungu\'s type name', () => {
    expect(mapping.ONLINE_DOCUMENT_TYPE).toBe('onlineDocument');
  });
});

// ------------------------------------------------------------------ feedback
const fb = (name: string) => {
  const sample = load('feedback_samples.json')[name];
  return mapping.feedback(sample.mixed, sample.achievement);
};

describe('feedback', () => {
  it('numeric score out of the total without a comment', () => {
    expect(fb('numeric_no_comment')).toEqual({ score: '5/5', comment: null, criteria: [], updatedAt: ms(2026, 10, 20, 16, 8, 55) });
  });

  it("numeric score with the teacher's comment", () => {
    const f = fb('numeric_comment')!;
    expect(f.score).toBe('4.5/5');
    expect(f.comment).toBe('Lorem feedback 1');
  });

  it('a level grade shows the English level name', () => {
    const f = fb('level_comment')!;
    expect(f.score).toBe('Level 2 [5]');
    expect(f.comment!.startsWith('Lorem feedback')).toBe(true);
    expect(f.criteria).toEqual([]);
  });

  it('rubric criteria take names and levels from the rubric', () => {
    const f = fb('level_rubric')!;
    expect(f.score).toBe('Level 7 [4]');
    expect(f.comment).toBeNull();
    expect(f.updatedAt).toBe(ms(2026, 6, 29, 14, 34, 14));
    expect(f.criteria).toHaveLength(1);
    const [c] = f.criteria;
    expect(c.name).toBe('Criterion 1');
    expect(c.result).toBe('Level 4');
    expect(c.description!.startsWith('Lorem description')).toBe(true);
  });

  it('is null before grading and without an evaluation', () => {
    expect(fb('not_graded')).toBeNull();
    expect(mapping.feedback({}, {})).toBeNull();
    expect(mapping.feedback({}, { evaluationItemResultResponse: null })).toBeNull();
  });

  it('a hidden or empty result is null', () => {
    const ach = (r: object) => ({ evaluationItemResultResponse: { totalScore: '5', itemResultResponses: [r] } });
    expect(mapping.feedback({}, ach({ scoreType: 1, score: '5', status: 0 }))).toBeNull();
    expect(mapping.feedback({}, ach({ scoreType: 1, score: null, feedback: '  ', status: 1 }))).toBeNull();
  });

  it('comment only, and a score without a total', () => {
    const ach = (total: string | null, r: object) => ({
      evaluationItemResultResponse: { totalScore: total, itemResultResponses: [{ status: 1, ...r }] },
    });
    const f = mapping.feedback({}, ach(null, { scoreType: 1, score: null, feedback: ' late submission. ' }))!;
    expect(f.score).toBe('');
    expect(f.comment).toBe('late submission.');
    expect(f.updatedAt).toBeNull();
    expect(mapping.feedback({ totalScore: '10' }, ach(null, { scoreType: 1, score: '8' }))!.score).toBe('8/10');
    expect(mapping.feedback({}, ach(null, { scoreType: 1, score: '8' }))!.score).toBe('8');
    const level = mapping.feedback({}, ach('5', { scoreType: 2, criterionItemResponse: { levelName: '超越 [5]', levelEName: null } }))!;
    expect(level.score).toBe('超越 [5]');
  });

  it("a criterion without a rubric falls back to its own fields", () => {
    const ach = {
      evaluationItemResultResponse: {
        itemResultResponses: [{
          status: 1, scoreType: 1, score: '3',
          itemIndicatorResultModelList: [{ indicatorId: 9, indicatorName: '论点', indicatorEname: null, score: '掌握', levelName: null, description: null }],
        }],
      },
    };
    expect(mapping.feedback({}, ach)!.criteria).toEqual([{ name: '论点', result: '掌握' }]);
  });
});

// ------------------------------------------------------------- notifications
const FEEDBACK_ITEM: any = {
  messageId: 5180327, messageSendTime: '2026-10-20 16:08', ifRead: true,
  title: '课程学习反馈已更新', titleEn: 'Course 7 learning feedback updated',
  content: '《作业》有新的学习反馈，请查看。',
  contentEn: '`Lorem title 4` has new learning feedback. Please review it.',
  messageUrl: 'https://task.yungu.org/#/taskInfo/58316/1/321', messageType: 24,
  templateCode: 'NEW_TASK_FEEDBACK', senderName: 'Teacher 1',
  attribute: { taskPublishId: 58316, distributionType: 1, messageType: 1, userId: 321, taskId: 612508 },
};

describe('notification', () => {
  it('prefers English and links the assignment', () => {
    expect(mapping.notification(FEEDBACK_ITEM)).toEqual({
      id: '5180327',
      title: 'Course 7 learning feedback updated',
      body: '`Lorem title 4` has new learning feedback. Please review it.',
      createdAt: ms(2026, 10, 20, 16, 8),
      read: true,
      taskId: 58316,
      target: null,
    });
  });

  it.each<[string | null, number | null]>([
    ['https://task.yungu.org/#/taskInfo/57402/1/321', 57402],
    ['https://task.yungu.org/umiTask#/stuTaskInfo/60417/1/null/1', 60417],
    ['https://task.yungu.org/#/task', null],
    ['https://task.yungu.org/#/studentTemplate', null],
    ['https://task.yungu.org/#/cardDetail/false/1/321/3920786', null],
    ['https://evaluation.yungu.org/#/portrait', null],
    [null, null],
  ])('taskId comes from the link only (%s)', (url, task) => {
    expect(mapping.notification({ ...FEEDBACK_ITEM, messageUrl: url }).taskId).toBe(task);
  });

  const BEHAVIOUR_ITEM = {
    messageId: 5180411, messageSendTime: '2026-10-20 14:58', ifRead: false, title: '行为管理通知',
    titleEn: null, content: '2026-10-20 14:58，Teacher 1（记录人）给你【Behaviour 1】+2分', contentEn: null,
    messageUrl: 'https://task.yungu.org/#/studentTemplate', messageType: 11, templateCode: 'BEHAVIOR_RECORD',
    senderName: 'Teacher 1', attribute: {},
  };

  it.each<[Record<string, unknown>, string | null]>([
    [{}, 'behaviour'],
    [{ messageUrl: null }, 'behaviour'], // Yungu sometimes leaves the link out
    [{ templateCode: 'BEHAVIOR_TIER', messageUrl: null }, 'behaviour'], // a tier penalty is a behaviour record too
    [{ templateCode: null }, null], // 校内安排 shares messageType 11: not by link alone
    [{ templateCode: 'NEW_TASK_FEEDBACK' }, null],
  ])('target names the behaviour page for behaviour records (%j)', (raw, target) => {
    const n = mapping.notification({ ...BEHAVIOUR_ITEM, ...raw });
    expect(n.target).toBe(target);
    expect(n.taskId).toBeNull();
  });

  it('an assignment notification has no target', () => {
    expect(mapping.notification(FEEDBACK_ITEM).target).toBeNull();
  });

  it.each<[Record<string, unknown>, boolean]>([
    [{ ifRead: false }, false], [{ ifRead: 1 }, true], [{ ifRead: '1' }, true], [{ ifRead: 'true' }, true],
    [{ ifRead: null, read: true }, true], [{ ifRead: 0 }, false], [{}, false],
  ])("the read flag is truthy like Yungu's client (%j)", (raw, read) => {
    const item = without(FEEDBACK_ITEM, 'ifRead', 'read');
    expect(mapping.notification({ ...item, ...raw }).read).toBe(read);
  });

  it('falls back to Chinese, then the sender', () => {
    const old = {
      messageId: 5, messageSendTime: '2025-01-02 08:00', ifRead: true, title: '您有新反馈',
      titleEn: null, content: '老师给了反馈', contentEn: '', messageUrl: null, senderName: 'Teacher 2',
    };
    const n = mapping.notification(old);
    expect(n.title).toBe('您有新反馈');
    expect(n.body).toBe('老师给了反馈');
    expect(n.taskId).toBeNull();
    const bare = mapping.notification({ messageId: 6, senderName: 'Teacher 2', messageSendTime: null });
    expect(bare.title).toBe('Teacher 2');
    expect(bare.body).toBe('');
    expect(bare.createdAt).toBe(0);
  });
});

// ------------------------------------------------------------ behaviour points
const BEHAVIOUR_KEYS = ['month', 'score', 'bonus', 'deduction', 'bonusCount', 'deductionCount', 'records'].sort();
const RECORD_KEYS = ['id', 'name', 'points', 'level', 'kind', 'at', 'subject', 'recorder', 'remark', 'revoked'].sort();

const utc = (text: string) => Date.parse(text);

/** A record-details row as Yungu sends it (only the fields the mapper reads). */
function rec(rid: number, score: string | null, at: string | null, type_: number | null = null, revoke: boolean | null = null, level: number | null = null, kw: any = {}) {
  if (type_ === null) type_ = (score ?? '').startsWith('+') ? 0 : 2;
  return {
    id: rid, type: type_, score, level, revoke, revokeIcon: Boolean(revoke), recordTime: at, sortTime: at, createDate: at,
    behaviorTypeName: kw.name ?? `行为${rid}`, behaviorTypeEnName: 'Behaviour',
    subjectId: kw.subject_id ?? -1, subjectName: '其他', subjectEnName: 'Others',
    creatorName: kw.creator ?? 'Teacher 1', creatorEnName: kw.creator ?? 'Teacher 1',
    recordActorName: 'Teacher 1', recordActorEnName: 'Teacher 1', desc: kw.desc ?? null,
  } as any;
}

const TOTAL = { score: 91.0, baseScore: 100.0, positiveScore: 8.0, negativeScore: -17.0 };

describe('monthWindow', () => {
  it('is the China calendar month', () => {
    expect(mapping.monthWindow('2026-10')).toEqual(['2026-10-01', '2026-10-31']);
    expect(mapping.monthWindow('2026-09')).toEqual(['2026-09-01', '2026-09-30']);
    expect(mapping.monthWindow('2028-02')).toEqual(['2028-02-01', '2028-02-29']);
    expect(mapping.monthWindow('2026-12')).toEqual(['2026-12-01', '2026-12-31']);
  });

  it.each(['2026-13', '2026-00', '2026-1', '26-10', '2026-10-01', '', null, '２０２６-10'])('rejects %s', (bad) => {
    expect(() => mapping.monthWindow(bad as any)).toThrow();
  });
});

describe('behaviour', () => {
  it('the capture carries no real staff ids', () => {
    // Staff user ids are placeholders (Teacher N -> 9000 + N, Yungu's system -> -1), and the system's
    // revocation reads as the system on both name fields, like its recordActor.
    for (const month of Object.values<any>(load('behaviour_records.json'))) {
      for (const row of month.data) {
        for (const [key, name] of [['creatorId', row.creatorName], ['revokeUserId', row.revokeUserName]]) {
          const value = row[key];
          if (value === null) continue;
          if (value === -1) {
            expect([row.revokeUserName, row.revokeUserEnName]).toEqual(['系统判定', 'System']);
          } else {
            expect(value).toBe(9000 + Number(name.replace(/^Teacher /, '')));
          }
        }
      }
    }
  });

  it('from the live October capture', () => {
    const detail = load('behaviour_detail.json')['2026-10'];
    const rows = load('behaviour_records.json')['2026-10'].data;
    const b = mapping.behaviour('2026-10', detail, rows);
    expect(keys(b)).toEqual(BEHAVIOUR_KEYS);
    for (const r of b.records) expect(keys(r)).toEqual(RECORD_KEYS);
    expect([b.month, b.score, b.bonus, b.deduction]).toEqual(['2026-10', 91, 8, -17]);
    for (const k of ['score', 'bonus', 'deduction'] as const) expect(Number.isInteger(b[k])).toBe(true);
    // 17 rows: 2 revocation pairs fold into 2 rows, so 15; 5 bonus, 7 deductions counted, 1 tier, 2 revoked
    expect(b.records).toHaveLength(15);
    expect([b.bonusCount, b.deductionCount]).toEqual([5, 7]);
    const revoked = b.records.filter((r) => r.revoked);
    expect(revoked.map((r) => r.id).sort()).toEqual(['5466350', '6675782']);
    const late = revoked.find((r) => r.id === '6675782')!;
    expect(late.points).toBe(-2);
    expect(late.kind).toBe('deduction');
    expect(late.subject).toBe('Subject 4');
    expect(late.at).toBe(utc('2026-10-19T04:10:54+00:00')); // the original's time, not the revocation's
    const tier = b.records.find((r) => r.kind === 'tier');
    expect(tier).toEqual({
      id: 'tier-87268', name: 'Behaviour 9', points: null, level: 1, kind: 'tier',
      at: utc('2026-10-19T00:06:31+00:00'), subject: null, recorder: 'System', remark: null, revoked: false,
    });
    expect(b.records[0]).toEqual({
      id: '4982274', name: 'Behaviour 1', points: 2, level: null, kind: 'bonus',
      at: utc('2026-10-20T06:58:22+00:00'), subject: null, recorder: 'Teacher 1', remark: 'Lorem remark 1', revoked: false,
    });
    const stamps = b.records.map((r) => r.at);
    expect(stamps).toEqual([...stamps].sort((x, y) => y - x));
    expect(new Set(b.records.map((r) => r.id)).size).toBe(b.records.length);
  });

  it('a revocation pair is one struck row, not counted', () => {
    const rows = [
      rec(2, '+5', '2026-10-12T02:00:00.000+00:00', 2, true),
      rec(2, '-5', '2026-10-10T02:00:00.000+00:00'),
      rec(1, '-2', '2026-10-09T02:00:00.000+00:00'),
    ];
    const b = mapping.behaviour('2026-10', { ...TOTAL, negativeScore: -2.0 }, rows);
    expect(b.records.map((r) => [r.id, r.points, r.kind, r.revoked])).toEqual([
      ['2', -5, 'deduction', true], ['1', -2, 'deduction', false],
    ]);
    expect(b.records[0].at).toBe(utc('2026-10-10T02:00:00+00:00'));
    expect([b.bonusCount, b.deductionCount]).toEqual([0, 1]);
    expect(b.deduction).toBe(-2); // Yungu's number, untouched
  });

  it('the revocation row first or last folds the same', () => {
    const a = rec(2, '-5', '2026-10-10T02:00:00.000+00:00');
    const r = rec(2, '+5', '2026-10-12T02:00:00.000+00:00', 2, true);
    expect(mapping.behaviour('2026-10', TOTAL, [a, r])).toEqual(mapping.behaviour('2026-10', TOTAL, [r, a]));
  });

  it('an original revoked in a later month shows revoked', () => {
    const row = { ...rec(3, '-2', '2026-09-28T02:00:00.000+00:00'), revokeIcon: true }; // its revocation is in October
    const b = mapping.behaviour('2026-09', TOTAL, [row]);
    expect(b.records[0].revoked).toBe(true);
    expect(b.records[0].points).toBe(-2);
    expect(b.deductionCount).toBe(0);
  });

  it('a lone revocation shows the original points at the revocation time', () => {
    const row = rec(4, '+2', '2026-10-02T02:00:00.000+00:00', 2, true); // the original is in September
    const b = mapping.behaviour('2026-10', TOTAL, [row]);
    expect(b.records.map((r) => [r.points, r.kind, r.revoked, r.at])).toEqual([[-2, 'deduction', true, utc('2026-10-02T02:00:00+00:00')]]);
    expect(b.deductionCount).toBe(0);
  });

  it('rows repeated across pages are kept once, newest first', () => {
    const rows = Array.from({ length: 120 }, (_, k) => {
      const i = k + 1;
      return rec(i, i % 3 ? '-1' : '+1', `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T0${i % 10}:00:00.000+00:00`);
    });
    const paged = [...rows.slice(0, 50), ...rows.slice(45, 100), ...rows.slice(95)]; // pages that shifted by a few rows
    const b = mapping.behaviour('2026-10', TOTAL, paged);
    expect(b.records).toHaveLength(120);
    expect(new Set(b.records.map((r) => r.id)).size).toBe(120);
    const stamps = b.records.map((r) => r.at);
    expect(stamps).toEqual([...stamps].sort((x, y) => y - x));
    expect(b.bonusCount + b.deductionCount).toBe(120);
  });

  it('record times are UTC instants and the month is China time', () => {
    const lateSept = rec(5, '-2', '2026-09-30T15:30:00.000+00:00'); // 2026-09-30 23:30 China
    const earlyOct = rec(6, '-2', '2026-09-30T16:30:00.000+00:00'); // 2026-10-01 00:30 China
    const sept = mapping.behaviour('2026-09', TOTAL, [lateSept, earlyOct]);
    const octo = mapping.behaviour('2026-10', TOTAL, [lateSept, earlyOct]);
    expect(sept.records.map((r) => r.id)).toEqual(['5']);
    expect(octo.records.map((r) => r.id)).toEqual(['6']);
    expect(sept.records[0].at).toBe(ms(2026, 9, 30, 23, 30));
    expect(octo.records[0].at).toBe(ms(2026, 10, 1, 0, 30));
  });

  it("the number is Yungu's score whatever the rows sum to", () => {
    const rows = [
      rec(1, '+2', '2026-10-03T02:00:00.000+00:00'),
      rec(2, '-5', '2026-10-04T02:00:00.000+00:00'),
      rec(2, '+5', '2026-10-05T02:00:00.000+00:00', 2, true),
      rec(9, null, '2026-10-04T02:00:00.000+00:00', 2, false, 2),
    ];
    const b = mapping.behaviour('2026-10', { score: 77.0, positiveScore: 3.0, negativeScore: -26.0 }, rows);
    expect([b.score, b.bonus, b.deduction]).toEqual([77, 3, -26]);
    expect([b.bonusCount, b.deductionCount]).toEqual([1, 0]);
  });

  it("an empty month still has Yungu's number", () => {
    const b = mapping.behaviour('2026-07', { score: 100.0, positiveScore: 0.0, negativeScore: 0.0 }, []);
    expect(b).toEqual({ month: '2026-07', score: 100, bonus: 0, deduction: 0, bonusCount: 0, deductionCount: 0, records: [] });
  });

  it('fractional points stay fractional', () => {
    const b = mapping.behaviour('2026-10', { score: 90.5, positiveScore: 0.5, negativeScore: -10.0 }, [rec(1, '+0.5', '2026-10-03T02:00:00.000+00:00')]);
    expect([b.score, b.bonus, b.records[0].points]).toEqual([90.5, 0.5, 0.5]);
  });

  it('record text fields', () => {
    const row = rec(7, '-2', '2026-10-03T02:00:00.000+00:00', null, null, null, { subject_id: 14, desc: '  上课睡觉 ', creator: 'Teacher 9' });
    Object.assign(row, { subjectName: '数学', subjectEnName: 'Math', creatorEnName: null });
    let r = mapping.behaviour('2026-10', TOTAL, [row]).records[0];
    expect([r.subject, r.remark, r.recorder]).toEqual(['Math', '上课睡觉', 'Teacher 9']);
    const blank = rec(8, '+1', '2026-10-03T02:00:00.000+00:00', null, null, null, { desc: '' });
    Object.assign(blank, {
      behaviorTypeName: null, creatorName: null, creatorEnName: null, recordActorName: null,
      recordActorEnName: null, subjectId: 3, subjectName: '化学', subjectEnName: '',
    });
    r = mapping.behaviour('2026-10', TOTAL, [blank]).records[0];
    expect([r.name, r.subject, r.remark, r.recorder]).toEqual(['Behaviour', '化学', null, null]);
  });

  it('rows without an id or a time are dropped', () => {
    const rows: any[] = [
      { score: '+1', recordTime: '2026-10-03T02:00:00.000+00:00' }, 'x', null,
      { ...rec(1, '+1', null), sortTime: null, createDate: null },
      rec(2, '+1', '2026-10-03T02:00:00.000+00:00'),
    ];
    expect(mapping.behaviour('2026-10', TOTAL, rows).records.map((r) => r.id)).toEqual(['2']);
  });

  it('a tier and a record with the same number stay apart', () => {
    const rows = [
      rec(5, null, '2026-10-04T02:00:00.000+00:00', 2, false, 3),
      rec(5, '-5', '2026-10-04T02:00:00.000+00:00'),
    ];
    const b = mapping.behaviour('2026-10', TOTAL, rows);
    expect(b.records.map((r) => [r.id, r.kind, r.level]).sort()).toEqual([['5', 'deduction', null], ['tier-5', 'tier', 3]]);
  });

  it('the September capture maps too', () => {
    const detail = load('behaviour_detail.json')['2026-09'];
    const rows = load('behaviour_records.json')['2026-09'].data;
    const b = mapping.behaviour('2026-09', detail, rows);
    expect([b.score, b.bonus, b.deduction]).toEqual([74, 5, -31]);
    expect(b.records).toHaveLength(19);
    expect(b.records.filter((r) => r.kind === 'tier')).toHaveLength(2);
    expect([b.bonusCount, b.deductionCount]).toEqual([3, 14]);
  });

  it("a later revocation listed in the original's month is one uncounted row", () => {
    // Live (2026-10-21, read-only): Yungu lists a revocation under the original's window even when it is
    // dated a later month, and the window's totals net the pair out. So the pair never splits: one revoked
    // row, counted on neither side.
    const original = { ...rec(41, '-5', '2026-05-08T01:55:01.000+00:00'), revokeIcon: true };
    const revocation = rec(41, '+5', '2026-07-06T09:55:56.000+00:00', 2, true);
    const kept = rec(42, '-3', '2026-05-09T01:00:00.000+00:00');
    const total = { score: 97.0, positiveScore: 0.0, negativeScore: -3.0 };
    const b = mapping.behaviour('2026-05', total, [revocation, original, kept]);
    expect(b.records.map((r) => [r.id, r.points, r.revoked])).toEqual([['42', -3, false], ['41', -5, true]]);
    expect([b.deduction, b.deductionCount, b.bonusCount]).toEqual([-3, 1, 0]);
  });
});

// ------------------------------------------------- behaviour outside Python's tests
describe('behaviour totals', () => {
  it('throws without a number for score', () => {
    expect(() => mapping.behaviour('2026-10', {}, [])).toThrow('stu/detail has no number for score');
  });
});
