# How long an agent's tool call may block (`hub_wait`)

`hub_wait` holds one MCP tool call open until the user does something in VideoHub (sends notes, answers a question,
approves the plan or a scene). Every client stops a tool call after its own limit, so `hub_wait` returns
"Nothing from the user yet; call hub_wait again." safely before that limit, and the agent simply calls it again.

Measured on 2026-11-21 on Windows 11 with a throwaway stdio MCP server whose one tool slept N seconds (and, when the
request carried a progress token, sent an MCP progress notification every 15 s). Nothing in the user's own agent
configuration was changed: Claude Code got `--mcp-config <file> --strict-mcp-config`, Codex got `-c` overrides with
`--ignore-user-config --ephemeral`.

| Client | Default limit | Setting | Measured |
|---|---|---|---|
| Claude Code 2.1.318 (`claude -p --model haiku`) | None hit: 650 s returned normally | `MCP_TOOL_TIMEOUT` (ms, environment) | 70 s, 200 s, 650 s: all returned. `MCP_TOOL_TIMEOUT=60000` with a 130 s call: stopped at 60.0 s ("timed out after 60s") and the server got a cancellation. Claude Code sends a progress token, but progress notifications did **not** extend the limit. |
| Codex CLI 0.167.0-alpha (bundled with the Codex desktop app, `%LOCALAPPDATA%\OpenAI\Codex\bin\…\codex.exe`; not on PATH) | 300 s ("timed out awaiting tools/call after 300s") | `tool_timeout_sec` per server in `config.toml` (`[mcp_servers.<name>]`) | 70 s with progress and 130 s without progress: returned. 650 s with progress: stopped at 300.0 s. `tool_timeout_sec = 30` with a 70 s call: stopped at 30.0 s. Codex sends a progress token; progress did **not** extend the limit. Codex's documentation states a 60 s default for `tool_timeout_sec`, so older versions may stop sooner. |
| OpenCode | 12 hours (`execution`) — **documentation only, not measured** (OpenCode is not installed here) | `mcp.timeout.execution` (ms) in `opencode.json`, per server `timeout.execution` | — |

Notes from the runs:
- Codex passes MCP servers a filtered environment: variables such as `VIDEOHUB_PORT` reach the server only through
  the entry's `env` table.
- `codex exec` reads extra input from stdin when stdin is not closed; give it `< /dev/null` in scripts.

## What VideoHub does with this
- `hub_wait` knows its client from the MCP handshake and waits, by default:
  Claude Code 540 s (or 90 % of `MCP_TOOL_TIMEOUT` when that is set); Codex 90 % of our entry's `tool_timeout_sec`,
  else 50 s (under the documented 60 s); OpenCode 540 s; unknown clients 45 s; the command line (`cli.js`) 100 s, under
  an agent shell's usual 2-minute command limit. `seconds` overrides it (at most 540).
- Setup gives VideoHub's Codex entry `tool_timeout_sec = 600`, so `hub_wait` and `hub_job` (which waits up to 9
  minutes for a render) fit inside one call. Only VideoHub's own `[mcp_servers.videohub]` table is touched.
- Inside one call, the tool long-polls the hub in pieces of at most 100 s (Node's `fetch` gives up on a response
  without headers after 300 s). The hub keeps a short grace between two pieces so the UI does not blink, forgets a wait
  whose client went away, and does not shut down for idleness while a wait is open.
- `hub_wait` sends a progress notification every 20 s when the client asked for progress (it shows that the agent is
  waiting); it does not rely on progress to stay alive.
