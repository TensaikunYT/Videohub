# VideoHub Studio: plan

Goal: one calm window for making videos with a coding agent (Claude Code, Codex, OpenCode), so the user stops reading
and copying text. The user sees what the agent is doing, its plan, its questions, the film's files and the skills, and
answers by clicking. There is no chat box: the first request is still typed in the agent's own window.

Approved design: a static clickable mockup, not part of the repo (one thing per screen; a film opens as tabs Review /
Plan / Files; the agent in a drawer behind a top-bar pill; Skills is its own page).
Each phase was reviewed in a browser on a test hub before the next one started.

Rules for every phase: `CLAUDE.md` (test hubs on a free test port 7797–7799 with scratch data, never the real hub or films; `npm test`
green; the UI never imports `server/`; no sync walks in request paths; no compiled helpers, no policy overrides; English).
Nothing reachable today may become unreachable. No rail entry, tab or button may lead to something that does not work.

## Phase 1: shell and look (done)
Design tokens shared by every stylesheet, SVG icons instead of emoji, left rail + top bar, Films grid, a film's Review tab
(stage left, notes right), the old project page as "Film details". 342/342 tests.

## Phase 2: Now (what is running, without spending tokens) (done)
Done: `server/activity.js` reads Claude Code and Codex session files passively (OpenCode not read: format unverified); Now page, agent pill, film-card mark, Settings switch.
The request: "I can't see what the agent is doing in the background or when it will finish; it must not eat tokens."
So the hub reads what agents already write to disk; it never asks an agent to report.
- **Sources.** Claude Code: `~/.claude/projects/*/<session>.jsonl` (records with `type`, `timestamp`, `cwd`,
  `message.content[]` tool_use blocks, `custom-title`). Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
  (`session_meta.cwd`, `event_msg` task_started / task_complete, `response_item` function / custom tool calls).
  OpenCode: its storage folder (`~/.local/share/opencode/storage`), built from its documented format and tested with
  fixtures only.
- **Cheap reading.** Only files changed in the last hours; read new bytes from a remembered offset (first read: the last
  few hundred KB); poll every few seconds only while a page listens, otherwise rarely; async, yielding.
- **What is derived (and nothing else).** Agent, session title, folder, film (cwd or edited paths matched against the
  scan), state (working / waiting for you / idle), current step and steps done/total (from TodoWrite, `update_plan` or
  the desktop app's plan tool), when the current turn started, elapsed time, last action in plain words ("Edited
  scenes/03.js", "Opened the live preview", "Loaded skill scanline-shorts"), skills used, files changed. Prompt text,
  answers and file contents are never stored or shown.
- **Time left.** Renders: real remaining time from the queue. Agent work: steps and elapsed time; an estimate only when
  enough steps are done, always labelled as an estimate.
- **UI.** Rail entry "Now" with a count; a page with Working, Waiting for you, Finished recently and the render queue;
  a small "agent working" mark on film cards; an agent pill in a film's top bar.
- **Off switch.** Settings → "Show agent activity" (on by default; off = the hub never reads agent folders).

## Phase 3: Files tab and Skills page (done)
Done: `server/film-files.js` + Files tab; `server/skills.js`, `server/skill-usage.js` + Skills page with the DOM-only Markdown renderer.
- **Files** (a film's second tab): Source, Voice and sound, Images and models, Renders, Leftovers, with sizes, a
  "changed recently" filter and the existing per-film tidy-up; big generated folders shown as one row.
- **Skills** (rail page): skills from the Claude, Codex, OpenCode and shared `~/.agents` skill folders; which agents have
  each one; file tree; SKILL.md rendered by a small safe Markdown renderer (DOM nodes, no innerHTML); other text files as
  text, binaries as an info card; films that used it and when (from the Phase 2 reader); open folder / open in editor.
  Read-only; every path checked to stay inside its skill folder.

## Phase 4: agent channel (no more copy-paste) (done)
Done: `server/channel.js`, `hub_plan` / `hub_ask` / `hub_wait` (limits in `docs/AGENT-WAIT.md`), agent drawer, Plan tab, Send to agent; Codex in the installer.
- **Wait tool first.** Measure how long a tool call may block in Claude Code, Codex (`tool_timeout_sec`) and OpenCode.
  `hub_wait` long-polls: it returns as soon as the user sends notes, answers a question or approves / comments the plan,
  and on timeout returns "nothing yet, call again", so a short client limit still works.
- **Tools.** `hub_plan` (scene cards: title, seconds, narration), `hub_ask` (question with options, optional preview
  pictures, a recommended option), `hub_wait`. Stored in the film's `.videohub/`.
- **UI.** "Send to agent" delivers straight to a waiting agent (copy remains as fallback); the agent drawer (status from
  Phase 2, open questions answered by click, plan approval); the Plan tab (cards, side detail, approve scene / plan,
  note per scene).
- **Codex** joins the installer next to Claude Code and OpenCode (MCP entry, skill, optional rule), with tests on a
  fake home. The skill and the global rule teach the loop: plan → build → live preview → `hub_wait` → fix.

## Phase 5: desktop shell and docs (done)
Done: `desktop/` (Electron 44.9.3, tried for real on a test hub), README / CLAUDE.md / AGENTS.md / ARCHITECTURE / MIGRATING, seven new screenshots from a fake home, upload rules.
Optional Electron shell in its own folder (`desktop/`, own package.json; nothing in the main install downloads
Electron; no binaries committed) that starts or reuses the hub and opens it in a window. README, CLAUDE.md,
ARCHITECTURE and MIGRATING updated; new screenshots from a test hub with the example film.

## Phase 6: finish (done)
Full tests and a browser pass on every page, first on a read-only test hub over a real film library, then a real
install updated with `scripts/install.mjs update` once its render queue was empty (the Codex entry gets
`tool_timeout_sec = 600`).

## After the plan
Thumbnail Studio was removed, and startup was made faster: folder walks yield on a time budget, the skills list and
the skill-usage index load when the Skills page asks for them, and the first agent-activity request waits for the first
paint (warm start to the first film cards: about 6.2 s before, 3.3 s after, on a 211-film library).
