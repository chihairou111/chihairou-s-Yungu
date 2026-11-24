// Makes the anonymised test fixtures in src/lib/yungu/fixtures/ from recorded Yungu responses.
//
//   ANONYMISE_SALT=$(openssl rand -hex 32) node scripts/anonymise-fixtures.mjs [privateFixturesDir]
//
// ANONYMISE_SALT is required: the fake ids are a keyed hash of the real ones, and with a salt anyone can
// read here they could be turned back by trying every id. Use a fresh random salt for each run, never
// commit, print or keep it (the same input then gives different fakes on every run; tests that name a
// fake id are updated to the new fixtures).
//
// The default input is the owner's private checkout (/root/yungu-lms/api/tests/fixtures). It holds real
// names, ids, titles and text and must never be copied into this repository. NOT run in CI: it documents
// how the committed fixtures were made. The script itself holds no real value; every fake is derived from
// the original (first-seen order, or a hash keyed with the secret salt).
// Output file names never carry a real id: `<kind>_<digits>.json` (one recorded assignment, the handed-in
// one) is written as `<kind>_submitted.json`.
//
// Kept as they are: structure and keys, numbers that are not identifiers (scores, counts, timestamps,
// status codes), enum-like strings (status names, file types, list kinds), date strings, colours, the
// shape of URLs (Yungu hosts stay; paths, query values and any other host are replaced).
// Replaced: person names, ids (numeric, same digit count), titles, free text, file names (extension kept),
// rooms, groups, subjects, URLs' ids, text nodes of HTML and of Quill deltas.
// Anything not recognised is replaced.
import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] ?? '/root/yungu-lms/api/tests/fixtures';
const DEST = join(here, '..', 'src', 'lib', 'yungu', 'fixtures');
const SALT = process.env.ANONYMISE_SALT ?? '';
if (SALT.length < 32) {
  console.error('ANONYMISE_SALT must be set to a fresh random value (at least 32 characters), e.g. $(openssl rand -hex 32).');
  process.exit(2);
}
/** The committed name for a recorded file: no real id in it. */
const outName = (f) => f.replace(/_\d+\.json$/, '_submitted.json');

// ---------------------------------------------------------------- what is kept
// Enum-like strings the mapping reads (status names, school groups), and Yungu's automatic actor.
const KEEP_VALUES = new Set([
  'Submitted', 'To submit', 'To edit', 'Due today', 'Due recently', 'Delayed', 'Due update', 'list',
  'System', '系统判定',
]);
// Keys whose string value is a short code, never free text.
const KEEP_KEYS = new Set(['type', 'list', 'align', 'templateCode', 'originalType', 'transformType', 'fileSize']);
const ID_KEY = /(^id$|Id$|^createUser$|^grade$)/;
const NOT_ID_KEY = /(StatusId$|^taskStatusId$)/;
const ID_LIST_KEYS = new Set(['suitGradeList', 'suitSujectList']);
const DATE = /^(\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?|\d{2}[-.]\d{2}( \d{2}:\d{2})?)$/;
const NUMERIC_LIKE = /^[+-]?[\d.,/]+[A-Za-z]{0,2}$/;
const HEX_COLOUR = /^#[0-9A-Fa-f]{3,8}$/;
const FREE_TEXT = /(name$|^title$|^desc|^feedback$|^insert$|^playground$)/i;
const YUNGU_HOST = /(^|\.)(yungu\.org|aliyuncs\.com)$/i;

// -------------------------------------------------------------------- fakes
const counters = new Map(); // prefix -> Map(original -> index)
const fakeOut = new Set(); // every fake string produced (for the self-check)
const keptOut = new Set(); // strings deliberately kept (for the self-check)

function numbered(prefix, original, format = (n) => String(n)) {
  if (!counters.has(prefix)) counters.set(prefix, new Map());
  const m = counters.get(prefix);
  if (!m.has(original)) m.set(original, m.size + 1);
  const out = `${prefix} ${format(m.get(original))}`;
  fakeOut.add(out);
  return out;
}
const letter = (n) => String.fromCharCode(64 + ((n - 1) % 26) + 1) + (n > 26 ? String(Math.ceil(n / 26)) : '');

const idMap = new Map(); // original number -> fake
const idUsed = new Set();
function fakeId(n) {
  if (!Number.isInteger(n) || n === 0 || n === -1 || Math.abs(n) < 10) return n;
  if (idMap.has(n)) return idMap.get(n);
  const sign = n < 0 ? -1 : 1;
  const len = String(Math.abs(n)).length;
  const lo = 10 ** (len - 1);
  const span = 9 * lo;
  const h = createHmac('sha256', SALT).update(String(n)).digest();
  let v = lo + Number(h.readBigUInt64BE(0) % BigInt(span));
  while (v === Math.abs(n) || idUsed.has(sign * v)) v = lo + ((v - lo + 1) % span);
  idUsed.add(sign * v);
  idMap.set(n, sign * v);
  return sign * v;
}
const fakeDigits = (s) => String(fakeId(Number(s)));

// ------------------------------------------------------------ URLs and HTML
function anonUrl(u) {
  const m = /^(?:(https?:)?\/\/([^/?#]+))?([^?#]*)(\?[^#]*)?(#.*)?$/.exec(u);
  if (!m || !(m[2] || u.startsWith('/'))) return 'about:blank';
  const [, scheme, host, path = '', query = '', hash = ''] = m;
  const yungu = !host || YUNGU_HOST.test(host);
  const seg = (s) => (s === '' ? s : /^[A-Za-z0-9_.~-]{1,32}$/.test(s) ? s.replace(/\d{3,}/g, fakeDigits) : 'x');
  const segs = (p) => p.split('/').map(seg).join('/');
  const out = yungu ? `${path ? segs(path) : ''}` : '/x';
  const q = !yungu
    ? ''
    : query.replace(/([?&][^=&]*=)([^&]*)/g, (_, k, v) =>
        `${k}${/^\d{1,2}$|^(true|false)$/.test(v) ? v : /^\d+$/.test(v) ? fakeDigits(v) : 'x'}`);
  const h = yungu && hash ? '#' + segs(hash.slice(1).replace(/^\//, '/')) : '';
  return `${host ? `${scheme ?? 'https:'}//${yungu ? host : 'example.invalid'}` : ''}${out}${q}${h}`;
}

const KEEP_ATTRS = new Set(['class', 'style', 'width', 'height', 'frameborder', 'scrolling', 'border', 'framespacing',
  'allowfullscreen', 'target', 'rel', 'align', 'colspan', 'rowspan', 'dir', 'lang']);
function anonHtml(s) {
  return s
    .replace(/<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]*))?)*)\s*(\/?)>/g, (_, tag, attrs, close) => {
      const a = attrs.replace(/\s+([^\s=>/]+)(?:=("[^"]*"|'[^']*'|[^\s>]*))?/g, (__, name, val) => {
        if (val === undefined) return ` ${name}`;
        const q = /^["']/.test(val) ? val[0] : '"';
        const raw = /^["']/.test(val) ? val.slice(1, -1) : val;
        const lower = name.toLowerCase();
        let out;
        if (lower === 'src' || lower === 'href' || lower === 'poster') out = anonUrl(raw);
        else if (KEEP_ATTRS.has(lower)) out = raw.replace(/url\([^)]*\)/gi, 'url(about:blank)');
        else out = 'x';
        return ` ${name}=${q}${out}${q}`;
      });
      return `<${tag}${a}${close ? ' /' : ''}>`;
    })
    .replace(/(^|>)([^<>]+)(?=<|$)/g, (_, pre, text) => {
      if (!/[^\s]/.test(text) || /^(\s|&[#\w]+;)*$/.test(text)) return pre + text; // blank or only entities
      const lead = /^\s*/.exec(text)[0];
      const trail = /\s*$/.exec(text)[0];
      return pre + lead + numbered('Lorem text', text.trim()) + trail;
    });
}

// ------------------------------------------------------------------ walker
let studentIds = new Set();
function gatherStudentIds(o) {
  if (Array.isArray(o)) o.forEach(gatherStudentIds);
  else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if (k === 'stuId' && typeof v === 'number') studentIds.add(v);
      gatherStudentIds(v);
    }
  }
}

const hasAny = (o, ...keys) => keys.some((k) => k in o);

/** The fake for string `v` under key `k` of object `o` (parent array/object key `parent`). */
function fakeString(k, v, o, parent) {
  const lk = k.toLowerCase();
  // people
  if (/^(username|creatorname|creatorenname|recordactorname|recordactorenname|revokeusername|revokeuserenname|createusername|sendername)$/.test(lk)) {
    const student = typeof o.userId === 'number' && studentIds.has(o.userId);
    return student ? numbered('Student', v, letter) : numbered('Teacher', v);
  }
  if (lk === 'ename' && hasAny(o, 'startTime')) return o.courseId ? numbered('Course', v) : numbered('Routine', v);
  if (lk === 'ename') return numbered('Alias', v);
  if (lk === 'name' && hasAny(o, 'startTime')) return o.courseId ? numbered('Course', v) : numbered('Routine', v);
  if ((lk === 'name' || lk === 'enname') && (hasAny(o, 'stuId', 'stuGroupName', 'studentTotalScore') || (lk === 'enname' && 'name' in o))) {
    return numbered('Student', v, letter);
  }
  if (lk === 'name' && parent === 'list') return numbered('Level', v);
  if (lk === 'name') return numbered('Criterion', v);
  if (lk === 'filename') {
    const ext = /\.([A-Za-z0-9]{1,8})$/.exec(v);
    const base = numbered('File', v);
    fakeOut.add(`${base}.${ext?.[1]}`);
    return ext ? `${base}.${ext[1]}` : base;
  }
  if (/^(levelename|levelname)$/.test(lk)) {
    const tail = /\s*(\[\d+\])$/.exec(v);
    const base = numbered('Level', v.replace(/\s*\[\d+\]$/, ''));
    return tail ? `${base} ${tail[1]}` : base;
  }
  if (/^(indicatorname|indicatorename|parentname|parentenname)$/.test(lk)) return numbered('Criterion', v);
  // courses, titles, text
  if (/^(coursename|courseenname)$/.test(lk)) return numbered('Course', v);
  if (lk === 'title' || lk === 'tasktitle') return numbered('Lorem title', v);
  if (lk === 'descript') return numbered('Lorem comment', v);
  if (lk === 'feedback') return numbered('Lorem feedback', v);
  if (lk === 'description' || lk === 'descriptionen' || lk === 'descriptioncn') return numbered('Lorem description', v);
  if (lk === 'desc') return numbered('Lorem remark', v);
  if (lk === 'revokereason') return numbered('Lorem reason', v);
  if (lk === 'playground') return numbered('Room', v);
  if (/^(groupname|groupenname|stugroupname|stugroupenname)$/.test(lk)) return numbered('Group', v);
  if (/^(collegename|collegeenname)$/.test(lk)) return numbered('House', v);
  if (/^(subjectname|subjectenname)$/.test(lk)) return numbered('Subject', v);
  if (/^(behaviortypename|behaviortypeenname)$/.test(lk)) return numbered('Behaviour', v);
  if (lk === 'suitgradename') return numbered('Grades', v);
  if (lk === 'schoolyearname') return numbered('Year', v);
  return numbered('Text', v);
}

function walkString(k, v, o, parent) {
  if (v.trim() === '') return v;
  if (KEEP_VALUES.has(v) || KEEP_KEYS.has(k)) {
    keptOut.add(v);
    return v;
  }
  if (ID_KEY.test(k) && !NOT_ID_KEY.test(k) && /^\d+$/.test(v)) return fakeDigits(v);
  // A JSON document inside a string (an online document's delta): anonymise it as JSON.
  if (/^[[{]/.test(v.trim())) {
    try {
      return JSON.stringify(walk(JSON.parse(v), k, o));
    } catch {
      /* not JSON: carry on */
    }
  }
  if (!FREE_TEXT.test(k) && (DATE.test(v) || HEX_COLOUR.test(v) || NUMERIC_LIKE.test(v))) {
    keptOut.add(v);
    return v;
  }
  if (k === 'insert') return numbered('Lorem text', v);
  if (!/\s/.test(v) && (/^(https?:)?\/\//.test(v) || v.startsWith('/'))) return anonUrl(v);
  if (/<[a-zA-Z][^>]*>/.test(v)) return anonHtml(v);
  if (k === 'link') return anonUrl(v);
  return fakeString(k, v, o ?? {}, parent);
}

function walk(v, key = '', obj = null, parent = '') {
  if (Array.isArray(v)) return v.map((x) => walk(x, key, obj, key));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = walk(x, k, v, key);
    // Staff ids are placeholders tied to their (fake) names: Teacher N -> 9000 + N; Yungu's system stays -1.
    for (const [idKey, nameKey] of [['creatorId', 'creatorName'], ['revokeUserId', 'revokeUserName']]) {
      const m = typeof out[nameKey] === 'string' && /^Teacher (\d+)$/.exec(out[nameKey]);
      if (m && typeof out[idKey] === 'number') out[idKey] = 9000 + Number(m[1]);
    }
    return out;
  }
  if (typeof v === 'string') return walkString(key, v, obj, parent);
  if (typeof v === 'number' && ((ID_KEY.test(key) && !NOT_ID_KEY.test(key)) || ID_LIST_KEYS.has(key))) return fakeId(v);
  return v;
}

// -------------------------------------------------------------- self-check
function strings(o, acc = []) {
  if (typeof o === 'string') acc.push(o);
  else if (Array.isArray(o)) o.forEach((x) => strings(x, acc));
  else if (o && typeof o === 'object') Object.values(o).forEach((x) => strings(x, acc));
  return acc;
}
function selfCheck(originals, outputs) {
  const expand = (list) => {
    const all = new Set();
    for (const s of list) {
      all.add(s);
      try {
        if (/^[[{]/.test(s.trim())) strings(JSON.parse(s)).forEach((x) => all.add(x));
      } catch { /* plain text */ }
    }
    return all;
  };
  const orig = expand(originals);
  const out = expand(outputs);
  const allowed = new Set([...keptOut, ...fakeOut]);
  // Words of the text only: URLs and HTML markup keep their shape on purpose.
  const plain = (s) => (!/\s/.test(s) && /^(https?:)?\/|^\//.test(s) ? '' : s.replace(/<[^>]*>/g, ' '));
  const exact = [...orig].filter((s) => s.length >= 2 && out.has(s) && !allowed.has(s) && !DATE.test(s) && !NUMERIC_LIKE.test(s) && plain(s) !== '');
  const words = (set) => new Set([...set].flatMap((s) => plain(s).match(/[\p{L}]{3,}/gu) ?? []));
  const allowedWords = words(allowed);
  const outWords = words(out);
  const wordLeaks = [...words(orig)].filter((w) => outWords.has(w) && !allowedWords.has(w));
  const cjkLeaks = [...out].filter((s) => /[㐀-鿿]/.test(s) && !allowed.has(s));
  console.log(`self-check: ${orig.size} original strings, ${out.size} output strings`);
  console.log(`  identical to an original (not kept by rule): ${exact.length}`);
  console.log(`  shared words (not from kept values or fake labels): ${wordLeaks.length}`);
  console.log(`  output strings with CJK text (not kept): ${cjkLeaks.length}`);
  return exact.length + wordLeaks.length + cjkLeaks.length;
}

// -------------------------------------------------------------------- main
const files = readdirSync(SRC).filter((f) => f.endsWith('.json')).sort();
if (new Set(files.map(outName)).size !== files.length) throw new Error('two recorded files would get the same name');
const inputs = files.map((f) => [f, JSON.parse(readFileSync(join(SRC, f), 'utf8'))]);
inputs.forEach(([, d]) => gatherStudentIds(d));
mkdirSync(DEST, { recursive: true });
const origStrings = [];
const outStrings = [];
for (const [f, data] of inputs) {
  const anon = walk(data);
  writeFileSync(join(DEST, outName(f)), JSON.stringify(anon, null, 2) + '\n');
  origStrings.push(...strings(data));
  outStrings.push(...strings(anon));
}
console.log(`wrote ${files.length} files to src/lib/yungu/fixtures`);
const problems = selfCheck(origStrings, outStrings);
if (problems) {
  console.error('self-check found possible leaks; do not commit');
  process.exitCode = 1;
}
