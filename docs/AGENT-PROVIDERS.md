# Agent providers (Reasonix CLI and DeepSeek API)

VideoHub's original design assumes **Claude Code** or **OpenCode**: the review button copies a short message, and
the agent reads the notes through the local `videohub` MCP server. This copy adds two providers that need neither,
selectable in **Settings → Agent provider**:

| Provider | What "Send to <agent>" does | Can edit files? | Needs |
|---|---|---|---|
| `claude` (default) | Copies the message to the clipboard for Claude Code / OpenCode (the original behavior). | Yes, through the agent's own MCP session | Claude Code or OpenCode |
| `reasonix` | Starts the Reasonix CLI in the project folder with the notes and waits for it. | Yes — it has file tools | Reasonix CLI (`reasonix`, also called `r`) |
| `deepseek` | Calls the DeepSeek chat API and shows the answer in a dialog. | No; it answers with code/commands only | A DeepSeek API key |

Nothing changes until a provider is chosen: the default is still `claude`.

## Settings

**Settings → Agent provider** has:

- **Provider** — `claude`, `reasonix` or `deepseek`.
- **Reasonix**
  - CLI path: empty = auto-detect. Detection checks Settings, `REASONIX_EXE`, `PATH` (`reasonix`, `r`) and the npx
    cache, then reports the version.
  - Model: optional; empty uses Reasonix's own `config.toml` default.
  - Max tool steps: a hard stop for one run (default 80).
- **DeepSeek**
  - API key: stored in `data/config.json` on this computer. It is never sent back to the browser; the API reports only
    whether a key is saved. A blank field or the `********` mask keeps the saved key.
  - Base URL and model (default `https://api.deepseek.com` / `deepseek-chat`).
  - **Test** checks the endpoint and lists the models it returns.
  - **Import key from Reasonix** reads `DEEPSEEK_API_KEY` from Reasonix's global `.env`
    (`%APPDATA%\reasonix\.env`, `~/.reasonix/.env` or `~/.config/reasonix/.env`) and saves it here.

The agent name shown on buttons follows the provider when it is still one of the automatic names
(`Claude`, `Reasonix`, `DeepSeek`, `OpenCode`); a custom name is kept.

## How a Reasonix run works

The server runs, in the project folder:

```
reasonix run --dir <project> --permission-mode auto --max-steps <N> --output-format text [--model <M>] "<prompt>"
```

The prompt contains the open notes (time, frame, text, annotated picture paths) and tells the agent to work in the
project folder and not to render. The run is tracked in `data/agent-runs.json`; its log is
`data/agent-runs/<run-id>.log`. The Settings panel lists the last runs and can cancel a running one. The review panel
polls the run and shows the final output in a dialog with a Copy button.

If the user pasted a DeepSeek key in VideoHub, it is passed to the child process as `DEEPSEEK_API_KEY`; otherwise
Reasonix uses its own `.env`.

## How a DeepSeek call works

The server sends the notes, a bounded snapshot of the project files (`render.js`, `index.html`, `film.js`,
`scene.js`, `package.json`, `.videohub/project.json`) and a system prompt to
`POST <base>/chat/completions`. The answer appears in the review panel. This mode cannot write files; use Reasonix
when the agent should change the film.

## A project with no film code

A folder that contains only a finished MP4 (no `render.js`/`index.html`) is a **finished-video project**. The Render
dialog then offers **Re-encode the current film** instead of a code render: the current final is copied as the
picture and the film's sound (including timeline sound edits) is muxed again into a new version. Notes that ask for
new pictures (characters, text on screen) still have to be made by the agent or a new film; the dialog says so.

## Security notes

- The VideoHub server stays on `127.0.0.1`; the API key never leaves this computer except to the configured
  DeepSeek endpoint.
- Reasonix is started with `--permission-mode auto`. That lets it edit files inside the project folder without
  prompting; only select it if you trust the agent with that folder.
- Agent runs are cancelled surgically by their own PID tree; no other process is touched.
