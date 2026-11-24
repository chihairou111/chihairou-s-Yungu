import { describe, expect, it } from 'vitest';
import { externalTarget, isAppUrl, redirectTarget } from './navigation';

const origin = 'http://127.0.0.1:51234';

describe('isAppUrl', () => {
  it('allows pages on the app origin', () => {
    expect(isAppUrl('http://127.0.0.1:51234/assignments', origin)).toBe(true);
    expect(isAppUrl('http://127.0.0.1:51234/login?next=%2Fcalendar', origin)).toBe(true);
  });

  it('refuses another port on the loopback address', () => {
    expect(isAppUrl('http://127.0.0.1:51235/assignments', origin)).toBe(false);
    expect(isAppUrl('http://127.0.0.1/assignments', origin)).toBe(false);
  });

  it('refuses another scheme or host', () => {
    expect(isAppUrl('https://127.0.0.1:51234/', origin)).toBe(false);
    expect(isAppUrl('http://localhost:51234/', origin)).toBe(false);
    expect(isAppUrl('https://task.yungu.org/assignments', origin)).toBe(false);
    expect(isAppUrl('file:///etc/passwd', origin)).toBe(false);
  });

  it('refuses credentials in the URL and nonsense', () => {
    expect(isAppUrl('http://user:pw@127.0.0.1:51234/', origin)).toBe(false);
    expect(isAppUrl('not a url', origin)).toBe(false);
    expect(isAppUrl('', origin)).toBe(false);
  });
});

describe('externalTarget', () => {
  it('sends http(s) links to the browser', () => {
    expect(externalTarget('https://task.yungu.org/some/page')).toBe('browser');
    expect(externalTarget('http://example.com/')).toBe('browser');
  });

  it('blocks everything else', () => {
    expect(externalTarget('file:///etc/passwd')).toBe('block');
    expect(externalTarget('javascript:alert(1)')).toBe('block');
    expect(externalTarget('mailto:someone@example.com')).toBe('block');
    expect(externalTarget('smb://server/share')).toBe('block');
    expect(externalTarget('garbage')).toBe('block');
  });
});

describe('externalTarget for loopback addresses', () => {
  it('blocks other local servers, whatever the port', () => {
    for (const url of [
      'http://127.0.0.1:51235/',
      'http://127.0.0.1/',
      'https://127.0.0.1:8443/x',
      'http://127.1.2.3:80/',
      'http://localhost:3000/',
      'http://LOCALHOST/',
      'http://app.localhost/',
      'http://[::1]:8080/',
      'http://0.0.0.0:5000/',
    ]) {
      expect(externalTarget(url), url).toBe('block');
    }
  });

  it('still sends ordinary hosts that only look similar to the browser', () => {
    expect(externalTarget('https://127.example.com/')).toBe('browser');
    expect(externalTarget('https://localhost.example.com/')).toBe('browser');
  });
});

describe('redirectTarget', () => {
  it('lets a redirect within the app go on', () => {
    expect(redirectTarget(`${origin}/assignments`, origin)).toBe('app');
  });

  it("downloads a redirect to Yungu's file storage (a signed file link)", () => {
    for (const url of [
      'https://yungu-common.oss-cn-hangzhou.aliyuncs.com/a/b.pdf?Expires=1&Signature=x',
      'https://yungu-public.oss-cn-hangzhou.aliyuncs.com/c.docx',
      'https://YUNGU-COMMON.oss-cn-hangzhou.aliyuncs.com/d.png',
    ]) {
      expect(redirectTarget(url, origin), url).toBe('download');
    }
  });

  it('sends any other web address to the browser, and blocks the rest', () => {
    for (const url of [
      'http://yungu-common.oss-cn-hangzhou.aliyuncs.com/a.pdf', // not https
      'https://evil.oss-cn-hangzhou.aliyuncs.com/a.pdf',
      'https://yungu-common.oss-cn-hangzhou.aliyuncs.com.evil.example/a.pdf',
      'https://user@yungu-common.oss-cn-hangzhou.aliyuncs.com/a.pdf',
      'https://task.yungu.org/x',
    ]) {
      expect(redirectTarget(url, origin), url).toBe('browser');
    }
    for (const url of ['file:///etc/passwd', 'http://127.0.0.1:1/', 'http://localhost:9/', 'javascript:alert(1)', 'not a url']) {
      expect(redirectTarget(url, origin), url).toBe('block');
    }
  });
});
