/** Limits shared by the browser and the Route Handlers, so both refuse the same input with the same words. */

/** The longest comment, in characters (UTF-16 code units, as a textarea's maxLength counts them). */
export const MAX_COMMENT = 2000;
export const COMMENT_TOO_LONG = 'Comments up to 2,000 characters.';

/** Yungu's limit on an online document: its stored delta JSON, in UTF-8 bytes. One byte more and Yungu refuses it. */
export const ONLINE_DOC_MAX_BYTES = 65_535;

/**
 * The service's 413 for an online document over Yungu's limit, or null when it fits. The same rule and
 * words as the service (`api/service/app.py`), over the content string exactly as stored:
 * excess = bytes − 65 535; N = max(1, ceil(excess × code points / bytes)) — "about", as scripts differ in bytes.
 */
export function docTooLongMessage(content: string): string | null {
  const bytes = new TextEncoder().encode(content).length;
  if (bytes <= ONLINE_DOC_MAX_BYTES) return null;
  const codePoints = [...content].length;
  const excess = bytes - ONLINE_DOC_MAX_BYTES;
  const n = Math.max(1, Math.ceil((excess * codePoints) / bytes));
  return `Too long for Yungu — cut about ${n} ${n === 1 ? 'character' : 'characters'}.`;
}
