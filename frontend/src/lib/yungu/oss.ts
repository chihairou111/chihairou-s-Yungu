import { createHmac } from 'node:crypto';
import { YunguError, type Fetch } from './http';
import { isSuspension, Suspended } from '../data/errors';

/** `content` of GET /api/sts/token?type=1. */
export type Sts = {
  accessKeyId: string;
  accessSecret: string;
  stsToken: string;
  bucketName: string;
  endpoint: string;
  ossPath: string;
};

const REFERER = 'https://task.yungu.org/';

/** Aliyun OSS signature v1 with an STS token (same as the web app's ali-oss SDK). */
export function ossSignature(secret: string, ctype: string, date: string, stsToken: string, bucket: string, key: string): string {
  const toSign = `PUT\n\n${ctype}\n${date}\nx-oss-date:${date}\nx-oss-security-token:${stsToken}\n/${bucket}/${key}`;
  return createHmac('sha1', secret).update(toSign).digest('base64');
}

/** Python's `quote(key, safe='/')`: everything but letters, digits, `_.-~` and `/` is escaped. */
function quoteKey(key: string): string {
  return key
    .split('/')
    .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()))
    .join('/');
}

/** PUT one object to OSS. Sends no Yungu cookies. Anything but HTTP 200 is a YunguError. */
export async function ossPut(
  fetch: Fetch,
  sts: Sts,
  key: string,
  bytes: Uint8Array,
  ctype: string,
  date: string = new Date().toUTCString(),
  timeoutMs = 300_000,
): Promise<void> {
  const sig = ossSignature(sts.accessSecret, ctype, date, sts.stsToken, sts.bucketName, key);
  const host = sts.endpoint.replace('https://', '');
  const url = `https://${sts.bucketName}.${host}/${quoteKey(key)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `OSS ${sts.accessKeyId}:${sig}`,
        'x-oss-date': date,
        'x-oss-security-token': sts.stsToken,
        'Content-Type': ctype,
        Referer: REFERER,
      },
      body: bytes as BodyInit,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (isSuspension(e)) throw new Suspended(); // not the network blocking OSS: Suspension Mode
    throw new YunguError(`OSS PUT ${key} -> ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status !== 200) {
    let text = '';
    try {
      text = (await res.text()).slice(0, 300);
    } catch {
      // body unreadable; the status says enough
    }
    throw new YunguError(`OSS PUT ${key} -> HTTP ${res.status}: ${text}`, { status: res.status });
  }
}
