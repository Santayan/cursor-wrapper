import { readFileSync } from 'node:fs';
import { config } from './config.js';
import { httpError, type AllowlistEntry, type HttpError } from './types.js';

// Shell-injection characters that must not appear in any argument, as a
// defense-in-depth measure alongside using spawn() without shell: true.
const DANGEROUS_CHARS = /[;&|$`()<>\n\\]/;

let entries: AllowlistEntry[] = [];

export function loadAllowlist(): void {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(config.allowlistPath, 'utf8'));
  } catch (err) {
    console.error(`[cursor-wrapper] FATAL: cannot read allowlist at ${config.allowlistPath}:`, err);
    process.exit(1);
  }

  if (!Array.isArray(raw)) {
    console.error('[cursor-wrapper] FATAL: allowlist.json must be a JSON array');
    process.exit(1);
  }

  entries = raw as AllowlistEntry[];
  console.log(`[cursor-wrapper] Loaded ${entries.length} allowlist entry/entries`);
}

export function validateCommand(
  command: string,
  args: string[],
): true | HttpError {
  // Reject absolute paths as the command name.
  if (command.startsWith('/') || command.startsWith('.')) {
    return httpError(400, 'INVALID_COMMAND', 'Command must not be an absolute or relative path');
  }

  // Reject shell-injection characters in command name.
  if (DANGEROUS_CHARS.test(command)) {
    return httpError(400, 'INVALID_COMMAND', 'Command contains disallowed characters');
  }

  const entry = entries.find((e) => e.command === command);
  if (!entry) {
    return httpError(400, 'UNKNOWN_COMMAND', `Command "${command}" is not in the allowlist`);
  }

  for (const arg of args) {
    if (DANGEROUS_CHARS.test(arg)) {
      return httpError(400, 'INVALID_ARG', `Argument contains disallowed characters: "${arg}"`);
    }
  }

  if (!entry.allowExtraArgs && args.length > 0) {
    const subcommand = args[0];
    if (!entry.subcommands.includes(subcommand!)) {
      return httpError(
        400,
        'UNKNOWN_SUBCOMMAND',
        `Subcommand "${subcommand}" is not permitted for "${command}". Allowed: ${entry.subcommands.join(', ')}`,
      );
    }
  }

  return true;
}
