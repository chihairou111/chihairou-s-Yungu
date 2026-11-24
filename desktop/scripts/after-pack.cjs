// electron-builder afterPack: copy frontend/.next/standalone to <resources>/server, verbatim
// (node_modules and Next's symlinks included). The shell starts <resources>/server/server.js.
const { cpSync, existsSync, rmSync } = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const from = path.resolve(__dirname, '..', '..', 'frontend', '.next', 'standalone');
  if (!existsSync(path.join(from, 'server.js'))) throw new Error(`afterPack: ${from}/server.js is missing`);
  if (!existsSync(path.join(from, '.next', 'static'))) throw new Error(`afterPack: ${from}/.next/static is missing (the frontend build copies it)`);
  const resources =
    context.electronPlatformName === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources');
  const to = path.join(resources, 'server');
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  if (!existsSync(path.join(to, 'node_modules', 'next'))) throw new Error('afterPack: server/node_modules/next missing');
};
