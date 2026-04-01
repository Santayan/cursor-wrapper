import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.js';
import { loadAllowlist } from './allowlist.js';
import { handleRun } from './handler.js';

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

type RouteKey = `${string} ${string}`;
type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, { status: 'ok' });
}

const routes = new Map<RouteKey, Handler>([
  ['POST /v1/cursor/run', handleRun],
  ['GET /health', handleHealth],
]);

async function requestListener(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const start = Date.now();
  const key: RouteKey = `${req.method ?? 'GET'} ${req.url ?? '/'}`;

  const handler = routes.get(key);
  if (!handler) {
    sendJson(res, 404, { statusCode: 404, code: 'NOT_FOUND', message: `No route for ${key}` });
    log(req.method ?? '-', req.url ?? '-', 404, Date.now() - start);
    return;
  }

  try {
    await handler(req, res);
  } catch (err) {
    console.error('[cursor-wrapper] Unhandled error in handler:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' });
    }
  }

  log(req.method ?? '-', req.url ?? '-', res.statusCode, Date.now() - start);
}

function log(method: string, url: string, status: number, durationMs: number): void {
  const ts = new Date().toISOString();
  console.log(`${ts} ${method} ${url} ${status} ${durationMs}ms`);
}

// Startup sequence
loadAllowlist();

const server = createServer(requestListener);

server.listen(config.port, () => {
  console.log(`[cursor-wrapper] Listening on :${config.port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[cursor-wrapper] SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[cursor-wrapper] SIGINT received, shutting down');
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  console.error('[cursor-wrapper] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[cursor-wrapper] Unhandled rejection:', reason);
  process.exit(1);
});
