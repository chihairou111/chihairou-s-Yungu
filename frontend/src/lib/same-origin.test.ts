import { describe, expect, it } from 'vitest';
import { isSameOriginWrite } from './same-origin';

const HOST = 'yungu.chihairou.dev';
const req = (method: string, headers: Record<string, string> = {}) =>
  new Request('http://127.0.0.1:3000/api/assignments/1/submit', { method, headers: { host: HOST, ...headers } });
const own = { origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' };

describe('isSameOriginWrite', () => {
  it('lets every read through', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) expect(isSameOriginWrite(req(method, { 'sec-fetch-site': 'cross-site' }))).toBe(true);
  });

  it("lets the dashboard's own writes through: JSON, no body, and multipart from its own pages", () => {
    expect(isSameOriginWrite(req('POST', { ...own, 'content-type': 'application/json; charset=utf-8' }))).toBe(true);
    expect(isSameOriginWrite(req('POST', { ...own, 'content-length': '0' }))).toBe(true);
    expect(isSameOriginWrite(req('DELETE', own))).toBe(true);
    expect(isSameOriginWrite(req('POST', { ...own, 'content-type': 'multipart/form-data; boundary=x' }))).toBe(true);
    // Through nginx, the browser's host comes as X-Forwarded-Host.
    expect(isSameOriginWrite(new Request('http://127.0.0.1:3000/x', { method: 'PUT', headers: { ...own, host: '127.0.0.1:3000', 'x-forwarded-host': HOST, 'content-type': 'application/json' } }))).toBe(true);
  });

  it.each([
    ['a cross-site fetch', { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }],
    ['a same-site page elsewhere', { 'sec-fetch-site': 'same-site', 'content-type': 'application/json' }],
    ['another origin', { origin: 'https://evil.example', 'content-type': 'application/json' }],
    ['an opaque origin', { origin: 'null', 'content-type': 'application/json' }],
    ['a text/plain form post', { ...own, 'content-type': 'text/plain' }],
    ['an urlencoded form post', { ...own, 'content-type': 'application/x-www-form-urlencoded' }],
    ['multipart the browser does not vouch for', { 'content-type': 'multipart/form-data; boundary=x' }],
    ['multipart without an Origin', { 'sec-fetch-site': 'same-origin', 'content-type': 'multipart/form-data; boundary=x' }],
    ['a body without a type', { ...own, 'content-length': '12' }],
  ])('refuses %s', (_, headers) => {
    expect(isSameOriginWrite(req('POST', headers))).toBe(false);
  });
});
