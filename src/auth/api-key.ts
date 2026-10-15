import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export function generateRawKey(): string {
  return `ppk_${randomBytes(32).toString('base64url')}`;
}
export function keyPrefixOf(raw: string): string {
  return raw.slice(0, 12);
}
export function digestKey(raw: string, pepper: string): string {
  return createHmac('sha256', pepper).update(raw, 'utf8').digest('hex');
}
export function digestsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/.exec(header.trim());
  if (!m) return null;
  const raw = m[1];
  return raw.startsWith('ppk_') && raw.length >= 16 ? raw : null;
}
