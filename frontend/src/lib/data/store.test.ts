import { beforeEach, describe, expect, it } from 'vitest';
import { data } from './index';
import { fileKind, resetMockStore } from './store';

const bytes = () => new Uint8Array([1, 2, 3, 4, 5]);

beforeEach(() => resetMockStore());

describe('fileKind', () => {
  it('classifies by mime, falling back to the extension', () => {
    expect(fileKind('application/pdf', 'a.pdf')).toBe('pdf');
    expect(fileKind('image/jpeg', 'a.jpg')).toBe('image');
    expect(fileKind('video/mp4', 'a.mp4')).toBe('video');
    expect(fileKind('audio/webm', 'a.webm')).toBe('audio');
    expect(fileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')).toBe('office');
    expect(fileKind('application/octet-stream', 'deck.pptx')).toBe('office');
    expect(fileKind('application/octet-stream', 'photo.PNG')).toBe('image');
    expect(fileKind('', 'notes.txt')).toBe('other');
  });
});

describe('mock store', () => {
  it('uploads and reads a file back', async () => {
    const b = bytes();
    const ref = await data.uploadFile('作业 1.pdf', 'application/pdf', b);
    expect(ref).toMatchObject({ name: '作业 1.pdf', kind: 'pdf', size: b.length, mime: 'application/pdf' });
    expect(ref.url).toBe(`/api/files/${ref.id}`);
    expect(ref.id).toMatch(/^[0-9a-f-]{36}$/);
    const got = await data.getFile(ref.id);
    expect(got && 'bytes' in got ? got.ref : null).toEqual(ref);
    expect(got && 'bytes' in got ? Array.from(got.bytes) : null).toEqual(Array.from(b));
    expect(await data.getFile('missing')).toBeNull();
  });

  it('submit moves a task from to-do to submitted', async () => {
    const ref = await data.uploadFile('a.pdf', 'application/pdf', bytes());
    expect((await data.getTodo()).some((a) => a.id === 102)).toBe(true);
    const { submittedAt } = await data.submit(102, [ref.id]);
    expect((await data.getTodo()).some((a) => a.id === 102)).toBe(false);
    const done = (await data.getSubmitted()).find((a) => a.id === 102);
    expect(done).toMatchObject({ status: 'Submitted', submittedAt });
    const detail = await data.getAssignmentDetail(102);
    expect(detail?.submitted).toBe(true);
    expect(detail?.myFiles.map((f) => f.id)).toEqual([ref.id]);
  });

  it('submitting after the due time is late', async () => {
    const ref = await data.uploadFile('a.pdf', 'application/pdf', bytes());
    const overdue = (await data.getTodo()).find((a) => a.id === 101)!;
    const { submittedAt } = await data.submit(101, [ref.id]);
    expect(submittedAt).toBeGreaterThan(overdue.dueAt);
    expect((await data.getSubmitted()).find((a) => a.id === 101)!.submittedAt).toBeGreaterThan(overdue.dueAt);
  });

  it('saveDraft keeps files without submitting and ignores unknown ids', async () => {
    const ref = await data.uploadFile('a.png', 'image/png', bytes());
    await data.saveDraft(103, [ref.id, 'nope']);
    const detail = await data.getAssignmentDetail(103);
    expect(detail?.myFiles.map((f) => f.id)).toEqual([ref.id]);
    expect(detail?.submitted).toBe(false);
    expect((await data.getTodo()).some((a) => a.id === 103)).toBe(true);
  });

  it('before any submit nothing is handed in; submitted fixtures list their handed-in files', async () => {
    expect((await data.getAssignmentDetail(102))?.submittedFileIds).toEqual([]);
    const done = (await data.getAssignmentDetail(201))!;
    expect(done.submittedFileIds).toEqual(done.myFiles.map((f) => f.id));
    expect(done.submittedFileIds.length).toBeGreaterThan(0);
  });

  it('draft edits after a submit leave the handed-in list alone; only submit changes it', async () => {
    const a = await data.uploadFile('a.pdf', 'application/pdf', bytes());
    const b = await data.uploadFile('b.pdf', 'application/pdf', bytes());
    await data.submit(102, [a.id]);
    await data.saveDraft(102, [b.id]);
    let detail = (await data.getAssignmentDetail(102))!;
    expect(detail.myFiles.map((f) => f.id)).toEqual([b.id]);
    expect(detail.submittedFileIds).toEqual([a.id]);
    expect(detail.submitted).toBe(true);
    await data.submit(102, [a.id, b.id]);
    detail = (await data.getAssignmentDetail(102))!;
    expect(detail.myFiles.map((f) => f.id)).toEqual([a.id, b.id]);
    expect(detail.submittedFileIds).toEqual([a.id, b.id]);
  });

  it('adds and deletes my comments', async () => {
    const c = await data.addComment(104, 'Is a calculator allowed?');
    expect(c).toMatchObject({ mine: true, text: 'Is a calculator allowed?' });
    expect((await data.getAssignmentDetail(104))!.comments.find((x) => x.id === c.id)).toMatchObject({ mine: true });
    await data.deleteComment(104, c.id);
    expect((await data.getAssignmentDetail(104))!.comments.some((x) => x.id === c.id)).toBe(false);
  });

  it('only lets me delete my own comments', async () => {
    const detail = (await data.getAssignmentDetail(101))!;
    const theirs = detail.comments.find((c) => !c.mine)!;
    await data.deleteComment(101, theirs.id);
    expect((await data.getAssignmentDetail(101))!.comments.some((c) => c.id === theirs.id)).toBe(true);
  });

  it('returns null for an unknown assignment', async () => {
    expect(await data.getAssignmentDetail(999999)).toBeNull();
  });
});
