export interface Config {
  port: number;
  apiKeyHashes: string[];   // SHA-256 hex digests of the raw API keys
  cursorBin: string;
  allowlistPath: string;
  workdirRoot: string;
  timeoutMs: number;
  maxOutputBytes: number;
  maxConcurrency: number;
}

export interface RunRequest {
  command: string;
  args?: string[];
  stdin?: string;
  workdir?: string;
  timeoutMs?: number;
}

export interface RunResponse {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  truncated: boolean;
}

export interface AllowlistEntry {
  command: string;
  subcommands: string[];
  allowExtraArgs: boolean;
}

export interface HttpError {
  statusCode: number;
  code: string;
  message: string;
}

export function isHttpError(e: unknown): e is HttpError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'statusCode' in e &&
    'code' in e &&
    'message' in e
  );
}

export function httpError(
  statusCode: number,
  code: string,
  message: string,
): HttpError {
  return { statusCode, code, message };
}
