/**
 * A full navigation (not the client router): the next page is fetched fresh, so its own response headers apply. Its own module so tests can stand in for it.
 */
export function assignLocation(url: string): void {
  window.location.assign(url);
}
