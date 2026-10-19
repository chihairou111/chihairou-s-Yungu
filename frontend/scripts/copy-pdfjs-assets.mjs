// Copies pdf.js's on-demand assets (CJK CMaps, standard fonts, image-decoder wasm, ICC profiles) from the
// installed pdfjs-dist into public/pdfjs/, so the app serves the versions matching its pdf.js build.
// Runs on postinstall and before dev/build; public/pdfjs/ is git-ignored.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pdfjs = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const target = join(root, 'public', 'pdfjs');

rmSync(target, { recursive: true, force: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const from = join(pdfjs, dir);
  if (existsSync(from)) cpSync(from, join(target, dir), { recursive: true });
}
console.log(`pdf.js assets copied to ${target}`);
