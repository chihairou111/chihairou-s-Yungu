/**
 * Runs once when the Next server starts. Under the desktop app (Electron utilityProcess, so a parent
 * port exists) in direct mode, make the local account now: it connects the credentials bridge and a
 * missing YUNGU_LOCAL_STATE_DIR fails at launch, not at the first sign-in. Never in tests or hosted builds.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.DATA_SOURCE !== 'direct') return;
  if (!(process as unknown as { parentPort?: unknown }).parentPort) return;
  const { localAccount } = await import('./lib/data/direct');
  localAccount();
}
