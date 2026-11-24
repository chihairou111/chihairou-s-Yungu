import { describe, expect, it } from 'vitest';
import { YunguError, type Fetch } from './http';
import { ossPut, ossSignature, type Sts } from './oss';
import { Suspended, YunguUnavailable } from '../data/errors';

const DATE = 'Mon, 24 Nov 2026 04:00:00 GMT';
const STS: Sts = {
  accessKeyId: 'AKID',
  accessSecret: 'test-secret',
  stsToken: 'STS-TOKEN',
  bucketName: 'yungu-common',
  endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
  ossPath: 'stu/1/',
};

describe('ossSignature', () => {
  it('matches the vector computed from the Python code', () => {
    expect(ossSignature('test-secret', 'text/plain', DATE, 'STS-TOKEN', 'yungu-common', 'stu/1/1764000000000_note.txt')).toBe(
      'IXsirLQgXKm+HBEyBoYXW4wme2c=',
    );
  });
});

describe('ossPut', () => {
  const key = 'stu/1/1764000000000_my note.txt';
  it('PUTs the bytes with the signed headers and no cookies', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: Fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: 200 });
    };
    await ossPut(fetch, STS, key, new Uint8Array([1, 2, 3]), 'text/plain', DATE);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe('https://yungu-common.oss-cn-hangzhou.aliyuncs.com/stu/1/1764000000000_my%20note.txt');
    expect(init.method).toBe('PUT');
    expect(init.redirect).toBe('manual');
    expect(init.body).toEqual(new Uint8Array([1, 2, 3]));
    const h = init.headers as Record<string, string>;
    expect(h).toEqual({
      Authorization: `OSS AKID:${ossSignature('test-secret', 'text/plain', DATE, 'STS-TOKEN', 'yungu-common', key)}`,
      'x-oss-date': DATE,
      'x-oss-security-token': 'STS-TOKEN',
      'Content-Type': 'text/plain',
      Referer: 'https://task.yungu.org/',
    });
  });

  it('raises YunguError on a non-200 answer', async () => {
    const fetch: Fetch = async () => new Response('denied', { status: 403 });
    await expect(ossPut(fetch, STS, key, new Uint8Array(), 'text/plain', DATE)).rejects.toMatchObject({
      name: 'YunguError',
      status: 403,
    });
  });

  it('wraps a network failure in YunguError', async () => {
    const fetch: Fetch = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(ossPut(fetch, STS, key, new Uint8Array(), 'text/plain', DATE)).rejects.toBeInstanceOf(YunguError);
  });

  it("passes the desktop app's Suspension Mode on as Suspended (never as a storage failure)", async () => {
    const fetch: Fetch = async () => {
      throw Object.assign(new Error('Suspension Mode: not sending anything to Yungu.'), { name: 'Suspended' });
    };
    const err = await ossPut(fetch, STS, key, new Uint8Array(), 'text/plain', DATE).catch((e) => e);
    expect(err).toBeInstanceOf(Suspended);
    expect(err).toBeInstanceOf(YunguUnavailable);
    expect(err.message).toBe("Can't reach Yungu right now. Try again.");
  });
});
