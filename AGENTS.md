# VideoHub agent instructions

Read [CLAUDE.md](CLAUDE.md) for the repository architecture, installation, update and development rules. These instructions apply to Claude Code, Codex and OpenCode. In short: test hubs run on a free test port (7797–7799) with scratch data, never on 7788; `npm test` must stay green without Electron; the UI never imports `server/`; the desktop shell lives only in `desktop/`.
