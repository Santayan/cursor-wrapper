# cursor-wrapper

Lightweight HTTP service that exposes a secure API to run Cursor Agent (`cursor-agent`) programmatically and return structured results.

## Docker (recommended)

### Quick start

```bash
# 1. Create a .env file with your credentials
cp .env.example .env
# Edit .env and set CURSOR_WRAPPER_API_KEYS and CURSOR_API_KEY

# 2. Build the image (downloads cursor-agent during build)
docker compose build

# 3. Run
docker compose up -d
```

The service is available at `http://localhost:3000`.

### `.env` file

```bash
# Key callers must supply in X-API-Key to reach this service
CURSOR_WRAPPER_API_KEYS=your-secret-key

# Your Cursor API key (passed to cursor-agent for AI requests)
CURSOR_API_KEY=crsr_...
```

### Custom allowlist (without rebuilding)

Mount your own `allowlist.json` by uncommenting this line in `docker-compose.yml`:
```yaml
- ./config/allowlist.json:/app/config/allowlist.json:ro
```

Then restart the container — no rebuild needed.

---

## Local setup (no Docker)

### Requirements

- Node.js >= 20
- Cursor installed on the host machine

```bash
npm install
npm run build
mkdir -p /tmp/cursor-jobs
```

### Running

```bash
CURSOR_WRAPPER_API_KEYS=your-secret-key \
CURSOR_API_KEY=crsr_... \
CURSOR_WORKDIR_ROOT=/tmp/cursor-jobs \
CURSOR_BIN=/Applications/Cursor.app/Contents/Resources/app/bin/cursor \
npm start
```

Dev mode (auto-restarts on changes):
```bash
CURSOR_WRAPPER_API_KEYS=your-secret-key \
CURSOR_API_KEY=crsr_... \
CURSOR_WORKDIR_ROOT=/tmp/cursor-jobs \
CURSOR_BIN=/Applications/Cursor.app/Contents/Resources/app/bin/cursor \
npm run dev
```

---

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `CURSOR_WRAPPER_API_KEYS` | yes | — | Comma-separated list of service API keys |
| `CURSOR_WORKDIR_ROOT` | yes | — | Absolute path jobs are jailed inside |
| `CURSOR_API_KEY` | no | — | Cursor API key forwarded to cursor-agent |
| `CURSOR_BIN` | no | `/usr/local/bin/cursor` | Path to cursor-agent binary |
| `CURSOR_WRAPPER_PORT` | no | `3000` | HTTP listen port |
| `CURSOR_TIMEOUT_MS` | no | `120000` | Default per-request timeout (ms) |
| `CURSOR_MAX_OUTPUT_BYTES` | no | `1048576` | Max stdout+stderr size (1 MB) |
| `CURSOR_MAX_CONCURRENCY` | no | `2` | Max parallel cursor-agent processes |
| `CURSOR_ALLOWLIST_PATH` | no | `./config/allowlist.json` | Path to allowlist file |

---

## API

### `GET /health`

Returns `200 { "status": "ok" }`. Used by the Docker healthcheck and load balancers.

---

### `POST /v1/cursor/run`

**Headers:**
- `Content-Type: application/json`
- `X-API-Key: <your-service-api-key>`

**Request body:**

```json
{
  "command": "cursor",
  "args": ["--print", "--trust", "your prompt here"],
  "stdin": "optional text piped to the process",
  "workdir": "relative/path/inside/workdir-root",
  "timeoutMs": 30000
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `command` | string | yes | Must match an allowlist entry (use `"cursor"`) |
| `args` | string[] | no | Flags and prompt passed to cursor-agent |
| `stdin` | string | no | Text written to the process stdin |
| `workdir` | string | no | Relative path inside `CURSOR_WORKDIR_ROOT` |
| `timeoutMs` | number | no | Per-request timeout, capped at server max (120s) |

**Response:**

```json
{
  "command": "cursor",
  "args": ["--print", "--trust", "explain what a binary search tree is"],
  "stdout": "A binary search tree (BST) is...",
  "stderr": "",
  "exitCode": 0,
  "durationMs": 1823,
  "truncated": false
}
```

The AI response is in `stdout`. A non-zero `exitCode` is returned as HTTP `200` — it reflects the subprocess result, not an HTTP error. `exitCode: null` means the process was killed (timeout or output cap). `truncated: true` means output was cut at the configured byte limit.

**Error responses:**

| Status | Code | Reason |
|---|---|---|
| `400` | `INVALID_BODY` | Malformed JSON or missing `command` |
| `400` | `BODY_TOO_LARGE` | Request body exceeds 16 KB |
| `400` | `UNKNOWN_COMMAND` | Command not in allowlist |
| `400` | `UNKNOWN_SUBCOMMAND` | Subcommand not permitted |
| `400` | `INVALID_ARG` | Argument contains disallowed characters |
| `400` | `PATH_TRAVERSAL` | `workdir` escapes the allowed root |
| `401` | `UNAUTHORIZED` | Missing or invalid `X-API-Key` |
| `503` | `OVERLOADED` | Concurrency queue is full |
| `500` | `SPAWN_ERROR` | Failed to start the cursor-agent process |

---

## Sending prompts

### Basic prompt

```bash
curl -X POST "http://localhost:3000/v1/cursor/run" \
  -H "X-API-Key: some-key" \
  -H "Content-Type: application/json" \
  -d '{"command":"cursor","args":["--print","--trust","explain what a binary search tree is"]}'
```

`--print` runs cursor-agent non-interactively and writes the response to stdout.
`--trust` grants workspace trust without an interactive prompt (required for non-interactive use).

### Prompt with a specific model

```bash
curl -X POST "http://localhost:3000/v1/cursor/run" \
  -H "X-API-Key: some-key" \
  -H "Content-Type: application/json" \
  -d '{"command":"cursor","args":["--print","--trust","--model","claude-4.6-sonnet-medium","explain what a binary search tree is"]}'
```

### Output formats

```bash
# Plain text (default)
"args": ["--print", "--trust", "--output-format", "text", "your prompt"]

# Structured JSON
"args": ["--print", "--trust", "--output-format", "json", "your prompt"]

# Streaming JSON deltas
"args": ["--print", "--trust", "--output-format", "stream-json", "your prompt"]
```

### Execution modes

```bash
# Ask mode — Q&A / explanations, read-only, no file edits
"args": ["--print", "--trust", "--mode", "ask", "your prompt"]

# Plan mode — analyses and proposes plans, no file edits
"args": ["--print", "--trust", "--mode", "plan", "your prompt"]
```

### Working with a codebase

Mount or copy your project files inside the `CURSOR_WORKDIR_ROOT` directory, then pass the relative path as `workdir`. cursor-agent will have access to those files:

```bash
curl -X POST http://localhost:3000/v1/cursor/run \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "cursor",
    "args": ["--print", "--trust", "--mode", "ask", "review the code in this project"],
    "workdir": "my-project"
  }'
```

Files must be inside `CURSOR_WORKDIR_ROOT/my-project` on the host (or in the `cursor-jobs` Docker volume).

### Selecting a model

Pass `--model <id>` to use a specific model:

```bash
curl -X POST http://localhost:3000/v1/cursor/run \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "cursor",
    "args": ["--print", "--trust", "--model", "claude-4.6-sonnet-medium", "explain what a binary search tree is"]
  }'
```

To list all models available to your account:

```bash
curl -X POST http://localhost:3000/v1/cursor/run \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"command":"cursor","args":["models"]}'
```

**Available models (as of 2026-04):**

| Model ID | Name |
|---|---|
| `auto` | Auto (default) |
| **Claude** | |
| `claude-4.6-sonnet-medium` | Sonnet 4.6 1M |
| `claude-4.6-sonnet-medium-thinking` | Sonnet 4.6 1M Thinking |
| `claude-4.6-opus-high` | Opus 4.6 1M |
| `claude-4.6-opus-high-thinking` | Opus 4.6 1M Thinking |
| `claude-4.6-opus-max` | Opus 4.6 1M Max |
| `claude-4.6-opus-max-thinking` | Opus 4.6 1M Max Thinking |
| `claude-4.5-sonnet` | Sonnet 4.5 1M |
| `claude-4.5-sonnet-thinking` | Sonnet 4.5 1M Thinking |
| `claude-4.5-opus-high` | Opus 4.5 |
| `claude-4.5-opus-high-thinking` | Opus 4.5 Thinking |
| `claude-4-sonnet` | Sonnet 4 |
| `claude-4-sonnet-1m` | Sonnet 4 1M |
| `claude-4-sonnet-thinking` | Sonnet 4 Thinking |
| `claude-4-sonnet-1m-thinking` | Sonnet 4 1M Thinking |
| **GPT** | |
| `gpt-5.4-low` | GPT-5.4 1M Low |
| `gpt-5.4-medium` | GPT-5.4 1M |
| `gpt-5.4-medium-fast` | GPT-5.4 Fast |
| `gpt-5.4-high` | GPT-5.4 1M High |
| `gpt-5.4-xhigh` | GPT-5.4 1M Extra High |
| `gpt-5.4-mini-low` | GPT-5.4 Mini Low |
| `gpt-5.4-mini-medium` | GPT-5.4 Mini |
| `gpt-5.4-mini-high` | GPT-5.4 Mini High |
| `gpt-5.4-nano-medium` | GPT-5.4 Nano |
| `gpt-5.3-codex` | GPT-5.3 Codex |
| `gpt-5.3-codex-high` | GPT-5.3 Codex High |
| `gpt-5.2` | GPT-5.2 |
| `gpt-5.2-high` | GPT-5.2 High |
| `gpt-5.1` | GPT-5.1 |
| `gpt-5.1-high` | GPT-5.1 High |
| `gpt-5-mini` | GPT-5 Mini |
| **Gemini** | |
| `gemini-3.1-pro` | Gemini 3.1 Pro |
| `gemini-3-flash` | Gemini 3 Flash |
| **Other** | |
| `grok-4-20` | Grok 4.20 |
| `grok-4-20-thinking` | Grok 4.20 Thinking |
| `kimi-k2.5` | Kimi K2.5 |

> Run `cursor models` via the API to get the live list for your account.

### Resume a session

```bash
"args": ["--print", "--trust", "--resume", "<chatId>", "follow-up question"]
```

---

## Allowlist

`config/allowlist.json` controls which commands and flags are permitted. The current configuration uses `allowExtraArgs: true` so any flags can be passed to cursor-agent:

```json
[
  {
    "command": "cursor",
    "subcommands": ["--version", "-v", "--help", "--print", "--trust", "--yolo", "-f",
                    "--output-format", "--mode", "--plan", "--ask"],
    "allowExtraArgs": true
  }
]
```

Set `allowExtraArgs: false` to restrict callers to only the listed flags.

---

## Security notes

- **No shell**: processes are spawned with `child_process.spawn(..., { shell: false })` — shell injection via args is structurally impossible.
- **Workdir jail**: every resolved working directory is asserted to start with `CURSOR_WORKDIR_ROOT`. A `workdir: "../../etc"` request is rejected with `400`.
- **Minimal child env**: only `PATH`, `HOME`, `TMPDIR`, `CURSOR_API_KEY`, and `TERM` are forwarded to child processes. The parent env (including `CURSOR_WRAPPER_API_KEYS`) is never inherited by cursor-agent.
- **Constant-time auth**: API key comparison uses `crypto.timingSafeEqual` to prevent timing attacks.
- **Key rotation**: set multiple comma-separated values in `CURSOR_WRAPPER_API_KEYS` to rotate keys without downtime.

---

## Production deployment (macOS)

Create a launchd plist at `~/Library/LaunchAgents/com.yourorg.cursor-wrapper.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.yourorg.cursor-wrapper</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/cursor-wrapper/dist/server.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CURSOR_WRAPPER_API_KEYS</key>
    <string>your-secret-key</string>
    <key>CURSOR_API_KEY</key>
    <string>crsr_...</string>
    <key>CURSOR_WORKDIR_ROOT</key>
    <string>/var/cursor-jobs</string>
    <key>CURSOR_BIN</key>
    <string>/Applications/Cursor.app/Contents/Resources/app/bin/cursor</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/var/log/cursor-wrapper.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/cursor-wrapper.log</string>
</dict>
</plist>
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/com.yourorg.cursor-wrapper.plist
```
