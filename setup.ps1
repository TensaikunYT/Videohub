# Optional compatibility entry point. SETUP.cmd runs Node directly and needs no PowerShell script permission.
# This wrapper respects the machine's existing execution policy and forwards the original Windows options.
param([switch]$DryRun, [switch]$Yes, [string]$Workspace = '', [ValidateSet('ask', 'yes', 'no')][string]$WatchFound = 'ask',
  [ValidateSet('ask', 'yes', 'no')][string]$GpuEncoder = 'ask', [ValidateSet('ask', 'yes', 'no')][string]$GlobalRule = 'ask',
  [ValidateSet('ask', 'yes', 'no')][string]$Shortcut = 'ask', [ValidateSet('ask', 'yes', 'no')][string]$Startup = 'ask',
  [ValidateSet('ask', 'yes', 'no')][string]$Example = 'ask', [string[]]$Agents = @(),
  [switch]$NoShortcut, [switch]$NoAgent, [switch]$NoGuard, [switch]$StartWithWindows, [switch]$Test)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'Node.js 22+ is required. Install it, then run SETUP.cmd.'; exit 1 }
$forward = @('setup')
foreach ($name in $PSBoundParameters.Keys) {
  $value = $PSBoundParameters[$name]
  if ($value -is [System.Management.Automation.SwitchParameter]) { if ($value.IsPresent) { $forward += "-$name" } }
  else { $forward += "-$name"; $forward += ($value -join ',') }
}
& node (Join-Path $PSScriptRoot 'scripts/install.mjs') @forward
exit $LASTEXITCODE
