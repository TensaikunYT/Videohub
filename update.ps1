# Optional compatibility entry point. UPDATE.cmd runs Node directly and needs no PowerShell script permission.
# Existing execution policy is respected; no policy setting is changed.
param([string]$Target, [switch]$NoAgent, [switch]$NoGuard, [switch]$NoSkill, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'Node.js 22+ is required. Install it, then run UPDATE.cmd.'; exit 1 }
$forward = @('update')
foreach ($name in $PSBoundParameters.Keys) {
  $value = $PSBoundParameters[$name]
  if ($value -is [System.Management.Automation.SwitchParameter]) { if ($value.IsPresent) { $forward += "-$name" } }
  else { $forward += "-$name"; $forward += $value }
}
& node (Join-Path $PSScriptRoot 'scripts/install.mjs') @forward
exit $LASTEXITCODE
