# Opens VideoHub: starts the server if it is not running, then an app window (Edge, else Chrome, else default browser).
# -ServerOnly: just the server, no window (Windows start-up). The server starts the render protection agent itself.
param([switch]$ServerOnly)
$hub = $PSScriptRoot
$port = 7788
try { $cfg = Get-Content "$hub\data\config.json" -Raw -Encoding UTF8 | ConvertFrom-Json; if ($cfg.port) { $port = $cfg.port } } catch { }
$url = "http://127.0.0.1:$port"
function Alive { try { (Invoke-WebRequest "$url/api/ping" -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200 } catch { $false } }
if (-not (Alive)) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Node.js was not found. Run SETUP.cmd in the VideoHub folder.') | Out-Null; exit 1 }
  Start-Process $node -ArgumentList "`"$hub\server\hub.js`"" -WorkingDirectory $hub -WindowStyle Hidden
  for ($i = 0; $i -lt 40 -and -not (Alive); $i++) { Start-Sleep -Milliseconds 250 }
}
if ($ServerOnly) { exit 0 }
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) { Start-Process $edge "--app=$url" } elseif ($chrome) { Start-Process $chrome "--app=$url" } else { Start-Process $url }
