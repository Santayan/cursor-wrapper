import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from './config.js';
import { httpError, type HttpError, type RunRequest, type RunResponse } from './types.js';

// Environment variables forwarded to the child process.
// Never forward the full parent env — it may contain CURSOR_WRAPPER_API_KEYS.
const ENV_PASSTHROUGH = ['PATH', 'HOME', 'TMPDIR', 'CURSOR_API_KEY', 'TERM'];

// Vars that must be explicitly cleared so the host Node runtime's options
// (e.g. NODE_OPTIONS=--use-system-ca set by the node:20-slim image) are not
// inherited by cursor-agent, which bundles its own Node and rejects unknown flags.
const ENV_CLEAR = ['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'VSCODE_NODE_OPTIONS'];

function buildChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_PASSTHROUGH) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  for (const key of ENV_CLEAR) {
    env[key] = '';
  }
  return env;
}

function resolveWorkdir(requested: string | undefined): string | HttpError {
  if (!requested) return config.workdirRoot;

  // path.resolve with a base prevents trivial traversal but we double-check.
  const joined = resolve(config.workdirRoot, requested);

  // Ensure the resolved path is still inside workdirRoot (jail check).
  const root = config.workdirRoot.endsWith('/')
    ? config.workdirRoot
    : `${config.workdirRoot}/`;

  if (!joined.startsWith(root) && joined !== config.workdirRoot) {
    return httpError(400, 'PATH_TRAVERSAL', 'Requested workdir is outside the allowed root');
  }

  return joined;
}

export async function runCommand(req: RunRequest): Promise<RunResponse | HttpError> {
  const workdir = resolveWorkdir(req.workdir);
  if (typeof workdir !== 'string') return workdir; // HttpError

  const args = req.args ?? [];
  const spawnArgs = [...args]; // cursor binary is the command; args are its arguments
  const effectiveTimeout = Math.min(
    req.timeoutMs ?? config.timeoutMs,
    config.timeoutMs,
  );

  const startMs = Date.now();
  let stdoutBuf = '';
  let stderrBuf = '';
  let truncated = false;
  const halfMax = Math.floor(config.maxOutputBytes / 2);

  return new Promise<RunResponse | HttpError>((resolve) => {
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn(config.cursorBin, spawnArgs, {
        cwd: workdir,
        env: buildChildEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve(httpError(500, 'SPAWN_ERROR', `Failed to spawn cursor: ${String(err)}`));
      return;
    }

    const timer = setTimeout(() => {
      truncated = true;
      child.kill('SIGTERM');
      // Force-kill if still running after 2 seconds.
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2_000);
    }, effectiveTimeout);

    child.stdout?.on('data', (chunk: Buffer) => {
      const remaining = halfMax - Buffer.byteLength(stdoutBuf);
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      stdoutBuf += chunk.toString('utf8').slice(0, remaining);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const remaining = halfMax - Buffer.byteLength(stderrBuf);
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      stderrBuf += chunk.toString('utf8').slice(0, remaining);
    });

    if (req.stdin !== undefined) {
      child.stdin?.write(req.stdin, 'utf8');
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve(httpError(500, 'PROCESS_ERROR', `Process error: ${err.message}`));
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startMs;
      resolve({
        command: req.command,
        args: spawnArgs,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        exitCode: code ?? (signal ? null : null),
        durationMs,
        truncated,
      });
    });
  });
}
