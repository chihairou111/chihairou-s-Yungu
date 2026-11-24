// Stand-in for `next/headers` for scripts/live-local.mjs (no Next request exists there): the one "page"
// is the script itself, whose session cookie the script sets after signing in.
const jar = new Map<string, string>();
export const setCookie = (name: string, value: string) => void jar.set(name, value);
export async function cookies() {
  return { get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) };
}
export async function headers() {
  return new Headers();
}
