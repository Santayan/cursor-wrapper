import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { config } from './config.js';

export function verifyApiKey(req: IncomingMessage): boolean {
  const header = req.headers['x-api-key'];
  const raw = Array.isArray(header) ? header[0] : header;

  // Always compute a hash (even if header is missing) to avoid timing leaks.
  const candidate = Buffer.from(
    createHash('sha256').update(raw ?? '').digest('hex'),
  );

  let matched = false;
  for (const stored of config.apiKeyHashes) {
    const storedBuf = Buffer.from(stored);
    if (
      candidate.length === storedBuf.length &&
      timingSafeEqual(candidate, storedBuf)
    ) {
      matched = true;
      // Do NOT break — always iterate all keys to avoid timing side-channels.
    }
  }
  return matched;
}
