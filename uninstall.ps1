# Optional compatibility entry point. `node scripts/install.mjs uninstall` also works when .ps1 scripts are blocked.
# Only owned integrations and launchers are removed; films, settings and the program folder remain.
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'Node.js 22+ is required to uninstall integrations.'; exit 1 }
$forward = @('uninstall')
if ($DryRun) { $forward += '--dry-run' }
& node (Join-Path $PSScriptRoot 'scripts/install.mjs') @forward
exit $LASTEXITCODE
