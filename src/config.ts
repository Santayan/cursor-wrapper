import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Config } from './types.js';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`[cursor-wrapper] FATAL: missing required env var ${name}`);
    process.exit(1);
  }
  return val;
}

function optionalInt(name: string, defaultVal: number): number {
  const raw = process.env[name];
  if (!raw) return defaultVal;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    console.error(`[cursor-wrapper] FATAL: ${name} must be a positive integer, got "${raw}"`);
    process.exit(1);
  }
  return n;
}

function loadConfig(): Config {
  const rawKeys = requireEnv('CURSOR_WRAPPER_API_KEYS');
  const apiKeyHashes = rawKeys
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => createHash('sha256').update(k).digest('hex'));

  if (apiKeyHashes.length === 0) {
    console.error('[cursor-wrapper] FATAL: CURSOR_WRAPPER_API_KEYS is empty');
    process.exit(1);
  }

  const workdirRoot = resolve(requireEnv('CURSOR_WORKDIR_ROOT'));
  if (!existsSync(workdirRoot)) {
    console.error(`[cursor-wrapper] FATAL: CURSOR_WORKDIR_ROOT does not exist: ${workdirRoot}`);
    process.exit(1);
  }

  const cursorBin = resolve(
    process.env['CURSOR_BIN'] ?? '/usr/local/bin/cursor',
  );

  const allowlistPath = resolve(
    process.env['CURSOR_ALLOWLIST_PATH'] ?? './config/allowlist.json',
  );

  return {
    port: optionalInt('CURSOR_WRAPPER_PORT', 3000),
    apiKeyHashes,
    cursorBin,
    allowlistPath,
    workdirRoot,
    timeoutMs: optionalInt('CURSOR_TIMEOUT_MS', 120_000),
    maxOutputBytes: optionalInt('CURSOR_MAX_OUTPUT_BYTES', 1_048_576),
    maxConcurrency: optionalInt('CURSOR_MAX_CONCURRENCY', 2),
  };
}

export const config: Readonly<Config> = Object.freeze(loadConfig());
