type Fetch = typeof fetch;

/** The fetch for Yungu's file storage: the desktop shell's own when it installs one (`__yunguFetch`), else Node's. */
export function ossFetch(): Fetch {
  return (globalThis as { __yunguFetch?: Fetch }).__yunguFetch ?? fetch;
}
