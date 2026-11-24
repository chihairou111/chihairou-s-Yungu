// Live check of the local data layer against the real Yungu (not run in CI).
//   node scripts/live-local.mjs [credentials.json]     (default /var/lib/yungu-lms/credentials.json)
// Runs the real `directData` (src/lib/data/direct.ts) through Vite's SSR loader, with `next/headers`
// stubbed. Reads freely; the only write is one upload of a tiny text file (nothing is attached to any
// assignment). Prints step names (ok/FAIL), counts and the hostnames contacted: no credentials, no
// personal content. Credentials are read from the file at run time and never leave this process.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CREDENTIALS = process.argv[2] || '/var/lib/yungu-lms/credentials.json';
const ALLOWED = new Set([
  'login.yungu.org',
  'task.yungu.org',
  'yungu-common.oss-cn-hangzhou.aliyuncs.com',
  'yungu-public.oss-cn-hangzhou.aliyuncs.com',
]);
const FIXED_ASSIGNMENT = 93251; // read only here
const UPLOAD_NAME = 'local-test.txt';
const UPLOAD_TEXT = "chihairou's Yungu (local) live check";

// ---- the recorder: every request the data layer makes goes through here -------------------------------
const hosts = new Set();
let logins = 0;
const stsHosts = new Set(); // `<bucketName>.<endpoint host>` of an STS answer
async function recordingFetch(url, init) {
  const u = new URL(url);
  hosts.add(u.hostname);
  if (u.hostname === 'login.yungu.org' && u.pathname === '/cas/getPublicKey') logins += 1; // one per login
  const res = await fetch(url, init);
  if (u.pathname === '/api/sts/token') {
    try {
      const c = (await res.clone().json()).content;
      stsHosts.add(`${c.bucketName}.${new URL(c.endpoint).hostname}`);
    } catch {
      // the upload step will report the failure
    }
  }
  return res;
}

// ---- steps ------------------------------------------------------------------------------------------
let failures = 0;
async function step(name, run) {
  try {
    const detail = await run();
    console.log(`ok    ${name}${detail ? ` (${detail})` : ''}`);
    return true;
  } catch (e) {
    failures += 1;
    const status = e && typeof e === 'object' && 'status' in e && e.status ? ` HTTP ${e.status}` : '';
    console.log(`FAIL  ${name}: ${e instanceof Error ? e.constructor.name : typeof e}${status}`);
    return false;
  }
}
const need = (cond, what) => {
  if (!cond) throw new Error(what);
};

/** FileRef ids (url /api/files/<id>) anywhere in an answer, in order. */
function* fileIds(value) {
  if (Array.isArray(value)) for (const v of value) yield* fileIds(v);
  else if (value && typeof value === 'object') {
    const m = typeof value.url === 'string' ? /^\/api\/files\/([0-9]+)$/.exec(value.url) : null;
    if (m && String(value.id) === m[1]) yield m[1];
    for (const [k, v] of Object.entries(value)) if (k !== 'submittedFileIds') yield* fileIds(v);
  }
}

/** Stops with a fixed message and the error's class name only: Node quotes part of the input in some errors. */
function stop(what, e) {
  console.log(`FAIL  ${what}: ${e instanceof Error ? e.constructor.name : typeof e}`);
  process.exit(1);
}

let loginId;
let password;
try {
  ({ loginId, password } = JSON.parse(readFileSync(CREDENTIALS, 'utf8')));
  if (typeof loginId !== 'string' || typeof password !== 'string') throw new TypeError();
} catch (e) {
  // Never the parser's message: it quotes part of the file (the password, possibly).
  stop('read the credentials file (expected JSON {loginId, password})', e);
}
const stateDir = mkdtempSync(join(tmpdir(), 'yungu-live-'));
let vite;
try {
  vite = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
    resolve: {
      alias: [
        { find: 'next/headers', replacement: join(root, 'scripts/live-next-headers.ts') },
        { find: 'server-only', replacement: join(root, 'node_modules/server-only/empty.js') },
      ],
    },
  });
} catch (e) {
  rmSync(stateDir, { recursive: true, force: true });
  stop('start the Vite loader', e);
}
try {
  const { createDirectData } = await vite.ssrLoadModule('/src/lib/data/direct.ts');
  const { LocalAccount } = await vite.ssrLoadModule('/src/lib/yungu/account.ts');
  const { encodeSession } = await vite.ssrLoadModule('/src/lib/session-cookie.ts');
  const { setCookie } = await vite.ssrLoadModule('/scripts/live-next-headers.ts');
  const { chinaMonth } = await vite.ssrLoadModule('/src/lib/behaviour.ts');
  const { weekStartOf } = await vite.ssrLoadModule('/src/lib/time.ts');

  const account = new LocalAccount({ fetch: recordingFetch, stateDir });
  const data = createDirectData(() => account);
  let todo = [];
  let firstTodo = null;
  let detail93251 = null;
  let detailTodo = null;

  const signed = await step('sign in', async () => {
    const r = await data.signIn(loginId, password);
    need(r.ok, r.error);
    setCookie('yl_session', encodeSession(r.displayName, r.token));
  });
  if (signed) {
    await step('getTodo', async () => {
      todo = await data.getTodo();
      firstTodo = todo[0]?.id ?? null;
      return `${todo.length} items`;
    });
    await step('getSubmitted', async () => `${(await data.getSubmitted()).length} items`);
    await step('getCourses', async () => `${(await data.getCourses()).length} courses`);
    await step('getWeek(this week)', async () => `${(await data.getWeek(weekStartOf(Date.now()))).length} events`);
    await step('getBehaviour(this month)', async () => {
      const b = await data.getBehaviour(chinaMonth(Date.now()));
      return `${b.records?.length ?? '?'} records`;
    });
    await step('getUnreadCount', async () => {
      const n = await data.getUnreadCount();
      need(Number.isInteger(n), 'not a number');
      return `${n} unread`;
    });
    await step('getNotifications(unread, page 1)', async () => `${(await data.getNotifications(false, 1)).items.length} items`);
    if (firstTodo === null) console.log('skip  getAssignmentDetail(first to-do): nothing to do');
    else {
      await step('getAssignmentDetail(first to-do)', async () => {
        detailTodo = await data.getAssignmentDetail(firstTodo);
        need(detailTodo, 'not found');
      });
    }
    await step(`getAssignmentDetail(${FIXED_ASSIGNMENT})`, async () => {
      detail93251 = await data.getAssignmentDetail(FIXED_ASSIGNMENT);
      need(detail93251, 'not found');
    });
    await step('getFile(preview) + first bytes of the signed link', async () => {
      const candidates = [...new Set([...fileIds(detailTodo), ...fileIds(detail93251)])];
      need(candidates.length > 0, 'no attachment to open');
      let lastError = null;
      for (const id of candidates.slice(0, 5)) {
        try {
          const file = await data.getFile(id, { preview: true });
          need(file && 'redirect' in file, 'no link');
          const res = await recordingFetch(file.redirect, { method: 'GET', headers: { Range: 'bytes=0-15' }, redirect: 'manual' });
          const got = (await res.arrayBuffer()).byteLength;
          need(res.status === 200 || res.status === 206, `signed link answered HTTP ${res.status}`);
          need(got > 0, 'no bytes');
          return `${got} bytes, HTTP ${res.status}`;
        } catch (e) {
          lastError = e; // an online document has no preview; try the next file
        }
      }
      throw lastError;
    });
    await step(`uploadFile(${UPLOAD_NAME}) via STS + OSS`, async () => {
      const bytes = new TextEncoder().encode(UPLOAD_TEXT);
      const ref = await data.uploadFile(UPLOAD_NAME, 'text/plain', bytes);
      need(ref && ref.id, 'no file id');
      return `${bytes.length} bytes`;
    });

    // Expiry: the session cookie vanishes from the client's jar; the next read must log in again by itself.
    const before = logins;
    await step('expiry: read after clearing the cookie jar (silent re-login)', async () => {
      await account.call(async (c) => c.jar.clear());
      await data.refresh(); // so the read reaches Yungu rather than the 60 s cache
      const rows = await data.getCourses();
      need(Array.isArray(rows), 'no answer');
      need(logins === before + 1, `expected one re-login, saw ${logins - before}`);
    });
    await step('sign out', async () => {
      await data.signOut(account.token());
    });
  }

  console.log(`logins: ${logins} (expected 2)`);
  if (logins !== 2) failures += 1;
  const stsAllowed = [...stsHosts];
  const contacted = [...hosts].sort();
  console.log(`hosts contacted: ${contacted.join(', ')}`);
  const stray = contacted.filter((h) => !ALLOWED.has(h) && !stsAllowed.includes(h));
  console.log(`hosts named by STS: ${stsAllowed.sort().join(', ') || '(none)'}`);
  console.log(stray.length ? `FAIL  hosts outside the allowed list: ${stray.join(', ')}` : 'ok    every host is in the allowed list');
  if (stray.length) failures += 1;
} catch (e) {
  // Loading the modules (or anything outside a step) failed: the class name only, as for the steps.
  failures += 1;
  console.log(`FAIL  load the data layer: ${e instanceof Error ? e.constructor.name : typeof e}`);
} finally {
  try {
    await vite.close();
  } catch (e) {
    console.log(`FAIL  close the Vite loader: ${e instanceof Error ? e.constructor.name : typeof e}`);
  }
  rmSync(stateDir, { recursive: true, force: true });
}
console.log(failures ? `${failures} step(s) FAILED` : 'all steps ok');
process.exit(failures ? 1 : 0);
