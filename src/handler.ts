import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifyApiKey } from './auth.js';
import { validateCommand } from './allowlist.js';
import { getSemaphore } from './concurrency.js';
import { runCommand } from './runner.js';
import { httpError, isHttpError, type RunRequest } from './types.js';

const MAX_BODY_BYTES = 16 * 1024; // 16 KB

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

function parseBody(raw: string): RunRequest | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    if (typeof parsed.command !== 'string' || !parsed.command) return null;
    if (parsed.args !== undefined && !Array.isArray(parsed.args)) return null;
    if (parsed.stdin !== undefined && typeof parsed.stdin !== 'string') return null;
    if (parsed.workdir !== undefined && typeof parsed.workdir !== 'string') return null;
    if (parsed.timeoutMs !== undefined && typeof parsed.timeoutMs !== 'number') return null;
    return parsed as RunRequest;
  } catch {
    return null;
  }
}

export async function handleRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // 1. Auth
  if (!verifyApiKey(req)) {
    sendJson(res, 401, httpError(401, 'UNAUTHORIZED', 'Invalid or missing API key'));
    return;
  }

  // 2. Parse body
  const rawBody = await readBody(req);
  if (rawBody === null) {
    sendJson(res, 400, httpError(400, 'BODY_TOO_LARGE', `Request body exceeds ${MAX_BODY_BYTES} bytes`));
    return;
  }

  const body = parseBody(rawBody);
  if (!body) {
    sendJson(res, 400, httpError(400, 'INVALID_BODY', 'Request body must be a JSON object with a "command" string field'));
    return;
  }

  // 3. Allowlist check
  const args = body.args ?? [];
  const check = validateCommand(body.command, args);
  if (check !== true) {
    sendJson(res, check.statusCode, check);
    return;
  }

  // 4. Acquire concurrency slot
  const semaphore = getSemaphore();
  let release: (() => void) | undefined;
  try {
    release = await semaphore.acquire();
  } catch {
    sendJson(res, 503, httpError(503, 'OVERLOADED', 'Server is at capacity, try again later'));
    return;
  }

  // 5. Execute
  try {
    const result = await runCommand(body);
    if (isHttpError(result)) {
      sendJson(res, result.statusCode, result);
    } else {
      sendJson(res, 200, result);
    }
  } finally {
    release?.();
  }
}
