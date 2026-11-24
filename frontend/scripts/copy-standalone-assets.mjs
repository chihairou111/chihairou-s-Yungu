// `next build` with output: 'standalone' leaves `.next/standalone/server.js` without the static files:
// copy `.next/static` and `public` (pdf.js assets included) next to it so `node .next/standalone/server.js` serves the app.
import { cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.next', 'standalone');
if (!existsSync(join(out, 'server.js'))) {
  console.error('copy-standalone-assets: .next/standalone/server.js is missing; run next build first.');
  process.exit(1);
}
cpSync(join(root, '.next', 'static'), join(out, '.next', 'static'), { recursive: true });
if (existsSync(join(root, 'public'))) cpSync(join(root, 'public'), join(out, 'public'), { recursive: true });
console.log('copied .next/static and public into .next/standalone');
