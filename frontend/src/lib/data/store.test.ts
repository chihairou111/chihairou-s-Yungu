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
    await expect(data.deleteComment(101, theirs.id)).rejects.toMatchObject({ name: 'CommentNotFound', status: 404 });
    expect((await data.getAssignmentDetail(101))!.comments.some((c) => c.id === theirs.id)).toBe(true);
  });

  it('returns null for an unknown assignment', async () => {
    expect(await data.getAssignmentDetail(999999)).toBeNull();
  });
});

const DELTA = '{"ops":[{"insert":"Hello 你好\\n"}]}';
const HANDED_IN = 'This document was handed in — save it as a new one.';

describe('mock needsFiles and Mark as submitted (empty submit), as the service decides', () => {
  it('every fixture says whether it needs files; 105 is a to-do that does not and has none', async () => {
    const all = [...(await data.getTodo()), ...(await data.getSubmitted())];
    for (const a of all) expect(typeof (await data.getAssignmentDetail(a.id))!.needsFiles, a.title).toBe('boolean');
    const free = (await data.getAssignmentDetail(105))!;
    expect(free).toMatchObject({ status: 'To submit', submitted: false, needsFiles: false, myFiles: [], submittedFileIds: [] });
    expect((await data.getAssignmentDetail(101))!.needsFiles).toBe(true);
  });

  it('marks an allowed assignment as submitted with no files', async () => {
    const { submittedAt } = await data.submit(105, []);
    expect((await data.getTodo()).some((a) => a.id === 105)).toBe(false);
    expect((await data.getSubmitted()).find((a) => a.id === 105)).toMatchObject({ status: 'Submitted', submittedAt });
    expect(await data.getAssignmentDetail(105)).toMatchObject({ submitted: true, myFiles: [], submittedFileIds: [] });
  });

  it('refuses an empty submit with "Add at least one file." when files are needed, it is submitted, or the draft has files', async () => {
    const refused = { name: 'ServiceError', status: 400, message: 'Add at least one file.' };
    await expect(data.submit(101, [])).rejects.toMatchObject(refused); // needsFiles
    await expect(data.submit(201, [])).rejects.toMatchObject(refused); // already submitted
    const ref = await data.uploadFile('a.pdf', 'application/pdf', bytes());
    await data.saveDraft(105, [ref.id]);
    await expect(data.submit(105, [])).rejects.toMatchObject(refused); // draft has files
    expect((await data.getAssignmentDetail(105))!.submitted).toBe(false);
    await data.saveDraft(105, []);
    await data.submit(105, []);
    await expect(data.submit(105, [])).rejects.toMatchObject(refused); // now submitted
  });

  it('an empty submit on an unknown assignment is a 404', async () => {
    await expect(data.submit(999999, [])).rejects.toMatchObject({ name: 'AssignmentNotFound', status: 404 });
  });
});

describe('mock online documents', () => {
  it('208 was handed in with an online document carrying a small delta', async () => {
    const d = (await data.getAssignmentDetail(208))!;
    expect(d.submitted).toBe(true);
    const docRef = d.myFiles.find((f) => f.online)!;
    expect(docRef).toMatchObject({ online: true, kind: 'other', size: 0 });
    expect(d.submittedFileIds).toContain(docRef.id);
    const delta = JSON.parse(docRef.content!);
    expect(Array.isArray(delta.ops)).toBe(true);
    expect(delta.ops.some((op: { attributes?: Record<string, unknown> }) => op.attributes?.header === 1)).toBe(true);
  });

  it('creates a document (trimmed title, the exact content) without adding it to the draft', async () => {
    const ref = await data.createOnlineDoc(103, '  My notes  ', DELTA);
    expect(ref).toMatchObject({ name: 'My notes', online: true, content: DELTA, kind: 'other', mime: 'application/octet-stream', size: 0 });
    expect(ref.url).toBe(`/api/files/${ref.id}`);
    expect((await data.getAssignmentDetail(103))!.myFiles).toEqual([]);
    await data.saveDraft(103, [ref.id]);
    expect((await data.getAssignmentDetail(103))!.myFiles).toEqual([ref]);
  });

  it('updates a draft document in place, keeping its id', async () => {
    const ref = await data.createOnlineDoc(103, 'Notes', DELTA);
    await data.saveDraft(103, [ref.id]);
    const next = '{"ops":[{"insert":"Changed\\n"}]}';
    const updated = await data.updateOnlineDoc(103, ref.id, ' Notes v2 ', next);
    expect(updated).toMatchObject({ id: ref.id, name: 'Notes v2', content: next, online: true });
    expect((await data.getAssignmentDetail(103))!.myFiles).toEqual([updated]);
  });

  it('refuses a blank title with 400 on create and update', async () => {
    const ref = await data.createOnlineDoc(103, 'Notes', DELTA);
    for (const write of [() => data.createOnlineDoc(103, '   ', DELTA), () => data.updateOnlineDoc(103, ref.id, '', DELTA)]) {
      await expect(write()).rejects.toMatchObject({ name: 'ServiceError', status: 400, message: 'Give the document a title.' });
    }
  });

  it('accepts 65 535 bytes and refuses one more with the 413 and the same N', async () => {
    const ref = await data.createOnlineDoc(103, 'Max', 'a'.repeat(65_535));
    expect(ref.content).toHaveLength(65_535);
    await expect(data.createOnlineDoc(103, 'Over', 'a'.repeat(65_536))).rejects.toMatchObject({
      name: 'DocumentTooLong',
      status: 413,
      message: 'Too long for Yungu — cut about 1 character.',
    });
    await expect(data.updateOnlineDoc(103, ref.id, 'Over', '研'.repeat(22_000))).rejects.toMatchObject({
      name: 'DocumentTooLong',
      status: 413,
      message: 'Too long for Yungu — cut about 155 characters.',
    });
  });

  it('refuses to update a handed-in document in place with 409, leaving it as it was', async () => {
    const before = (await data.getAssignmentDetail(208))!.myFiles.find((f) => f.online)!;
    await expect(data.updateOnlineDoc(208, before.id, 'Edited', DELTA)).rejects.toMatchObject({ name: 'DocumentHandedIn', status: 409, message: HANDED_IN });
    expect((await data.getAssignmentDetail(208))!.myFiles.find((f) => f.id === before.id)).toEqual(before);
  });

  it('a document created and saved after the hand-in can be updated in place; only a submit makes it handed in', async () => {
    const ref = await data.createOnlineDoc(208, 'New version', DELTA);
    await data.saveDraft(208, [ref.id]);
    await expect(data.updateOnlineDoc(208, ref.id, 'New version', DELTA)).resolves.toMatchObject({ id: ref.id });
    await data.submit(208, [ref.id]);
    await expect(data.updateOnlineDoc(208, ref.id, 'New version', DELTA)).rejects.toMatchObject({ status: 409 });
  });

  it('update 404s for an unknown assignment or a document the store does not hold', async () => {
    const ref = await data.createOnlineDoc(103, 'Notes', DELTA);
    await expect(data.updateOnlineDoc(999999, ref.id, 'Notes', DELTA)).rejects.toMatchObject({ name: 'AssignmentNotFound', status: 404 });
    await expect(data.updateOnlineDoc(103, 'nope', 'Notes', DELTA)).rejects.toMatchObject({ name: 'AssignmentNotFound', status: 404 });
    const upload = await data.uploadFile('a.pdf', 'application/pdf', bytes());
    await expect(data.updateOnlineDoc(103, upload.id, 'Notes', DELTA)).rejects.toMatchObject({ status: 404 });
  });
});
