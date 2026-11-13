# Windows security and installation

VideoHub uses the installed Node.js runtime for setup, update, uninstall and launch. The clickable Windows installers call Node directly; PowerShell is still used for some installed Windows services, with transparent commands and the computer's existing policy.

| Task | From the VideoHub folder |
|---|---|
| Preview setup | `node scripts/install.mjs setup --dry-run` |
| Install | `SETUP.cmd` or `node scripts/install.mjs setup` |
| Preview update | From the new download: `node scripts/install.mjs update --target "C:/path/to/installed/VideoHub" --dry-run` |
| Update | Repeat the preview command without `--dry-run`, or use `UPDATE.cmd` |
| Open | `open.cmd` or `node scripts/install.mjs open` |
| Preview uninstall | From the installed folder: `node scripts/install.mjs uninstall --dry-run` |
| Uninstall integrations | `UNINSTALL.cmd` or repeat without `--dry-run`; films, notes, outputs, settings and program files remain |

The `.ps1` files are compatibility forwarders. If PowerShell policy blocks one, use the direct Node command. Setup does not lower policy, disable antivirus, add blanket exclusions, remove download protections or require an unsigned custom executable. An organization's application-control restrictions still need its approved deployment process.

The runtime folder picker loads installed WinForms; it falls back to typed folder entry if unavailable. Reversible deletion uses the installed .NET Recycle Bin API and retains disabled/unavailable/capacity checks. There is no inline C# compiler, custom P/Invoke, encoded command or generated PowerShell helper script. The source-distribution test rejects compiled executable helpers and app bundles. These are source and packaging checks, not an antivirus certification or a publisher signature.

## Understand the exact warning

The word "virus" alone does not identify the product or its verdict. Record the security product, exact message/detection ID, affected file and VideoHub version. A screenshot can help, but review it for personal paths or other private content before sharing.

| Warning | What it concerns |
|---|---|
| Antivirus malware detection | A named threat/detection for a particular file needs review of that exact file and verdict. Keep the blocked item blocked while investigating. |
| SmartScreen or unknown-publisher warning | Download reputation or publisher identity; this is separate from a named malware detection. |
| Smart App Control | Application trust/control; its exact block message matters. |
| PowerShell scripts disabled or unsigned-script error | Script execution policy; use the Node entry point while keeping that policy unchanged. |

Passing tests or simplifying the source does not establish that a detection is a false positive, guarantee that alerts disappear, or override a security product's decision. If a reviewed distributable still receives a malware detection, use the product vendor's official review process for the exact affected file. Review the submission contents and obtain permission before sharing anything; VideoHub does not upload automatically.

## Identify this source copy locally

Run `node scripts/windows-security.mjs` from this copy of VideoHub. It prints JSON with an aggregate `sourceFingerprint`, SHA-256 hashes/status for known source files and the names of detected retired launchers/helpers. It does not print absolute paths or file contents, read antivirus history, execute a helper, write a report file or send anything. Include the fingerprint with the product, exact alert and affected file when reporting an issue. The result identifies the examined source files; it is not an antivirus scan or proof of safety.

## Upgrade an older copy

Editing this repository does not update an archive already shared with someone else or another installation. Distribute the new version and use its updater against the intended install. The update preserves project data, checks active work, migrates owned integration paths and retires recognized obsolete helpers without executing them. If a shortcut/startup entry is unknown, unreadable or cannot be migrated safely, it keeps the old launcher files and warns; resolve that reference before retiring them. Old `RenderGuard.exe` / `VideoHubAgent.exe` filenames describe the retired helper; a filename alone cannot classify a current warning.
