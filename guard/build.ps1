# Builds VideoHubAgent.exe (VideoHub's invisible render-protection agent; source RenderGuard.cs) with the C# compiler
# that ships with Windows (.NET Framework 4). No user paths: the source and the exe live next to this script (VideoHub\guard).
# The hub starts the agent itself (--agent); this script only restarts it if it was running.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
Add-Type -AssemblyName System.Drawing

# ---- icon: dark tile with a gauge (orange needle) - drawn in code, packed as PNG-in-ICO
function New-IconPng([int]$s) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.Clear([System.Drawing.Color]::Transparent)
  $r = [single]($s * 0.2); $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $w = [single]($s - 1)
  $path.AddArc(0, 0, $r * 2, $r * 2, 180, 90); $path.AddArc($w - $r * 2, 0, $r * 2, $r * 2, 270, 90)
  $path.AddArc($w - $r * 2, $w - $r * 2, $r * 2, $r * 2, 0, 90); $path.AddArc(0, $w - $r * 2, $r * 2, $r * 2, 90, 90); $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 30, 34, 44))), $path)
  $cx = $s / 2; $cy = $s * 0.62; $rad = $s * 0.33; $pw = [single]([Math]::Max(1.5, $s * 0.085))
  $rect = New-Object System.Drawing.RectangleF ([single]($cx - $rad)), ([single]($cy - $rad)), ([single]($rad * 2)), ([single]($rad * 2))
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 235, 235, 240)), $pw
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $g.DrawArc($pen, $rect, 180, 120)
  $hot = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 232, 116, 44)), $pw
  $hot.StartCap = 'Round'; $hot.EndCap = 'Round'
  $g.DrawArc($hot, $rect, 300, 60)
  $a = -140 * [Math]::PI / 180; $len = $rad * 0.82
  $needle = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 232, 116, 44)), ([single]($pw * 0.9))
  $needle.StartCap = 'Round'; $needle.EndCap = 'Round'
  $g.DrawLine($needle, [single]$cx, [single]$cy, [single]($cx + $len * [Math]::Cos($a)), [single]($cy + $len * [Math]::Sin($a)))
  $d = [single]($s * 0.13)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 235, 235, 240))), [single]($cx - $d / 2), [single]($cy - $d / 2), $d, $d)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  return , $ms.ToArray()
}
$sizes = 256, 48, 32, 16
$pngs = $sizes | ForEach-Object { , (New-IconPng $_) }
$ico = New-Object System.IO.MemoryStream; $bw = New-Object System.IO.BinaryWriter $ico
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$off = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $sz = $sizes[$i]; $b = if ($sz -ge 256) { 0 } else { $sz }
  $bw.Write([byte]$b); $bw.Write([byte]$b); $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]$pngs[$i].Length); $bw.Write([uint32]$off)
  $off += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }
[System.IO.File]::WriteAllBytes((Join-Path $here 'app.ico'), $ico.ToArray())

# ---- compile before stopping the resident agent
$fw = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$csc = Join-Path $fw 'csc.exe'
if (-not (Test-Path -LiteralPath $csc)) { throw ".NET Framework 4 compiler not found: $csc" }
$target = Join-Path $here 'VideoHubAgent.exe'
$legacy = Join-Path $here 'RenderGuard.exe'   # the agent's name before Nov 4
$candidate = Join-Path $here ("VideoHubAgent.build." + [guid]::NewGuid().ToString('N') + '.exe')
$compileArgs = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/codepage:65001', "/out:$candidate", "/win32icon:$here\app.ico",
  "/r:$fw\System.Management.dll", "/r:$fw\System.Windows.Forms.dll", "/r:$fw\System.Drawing.dll", "/r:$fw\System.Core.dll",
  "/r:$fw\System.Web.Extensions.dll", "$here\RenderGuard.cs")
& $csc @compileArgs
if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE); running guard left untouched" }

# Stop only the installed agent (this folder's VideoHubAgent.exe, or the old RenderGuard.exe), never test copies.
# Both listen to the same quit event; --quit lifts every CPU cap before the agent exits.
$was = @(Get-Process -Name VideoHubAgent, RenderGuard -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target -or $_.Path -eq $legacy })
$stopped = $false
try {
  if ($was.Count) {
    $quitter = if (Test-Path -LiteralPath $target) { $target } else { $legacy }
    Start-Process -FilePath $quitter -ArgumentList '--quit' -WindowStyle Hidden -Wait
    foreach ($p in $was) {
      if (-not $p.WaitForExit(10000)) { throw "agent did not exit; original exe retained" }
    }
    $stopped = $true
  }
  $stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '.' + [guid]::NewGuid().ToString('N')
  if (Test-Path -LiteralPath $target) {
    # Keep the previous binary for rollback; no hard deletion.
    [IO.File]::Replace($candidate, $target, (Join-Path $here "VideoHubAgent.backup.$stamp.exe"))
  } else {
    Move-Item -LiteralPath $candidate -Destination $target
  }
  # the old name must not stay startable (a stale shortcut would bring the separate "RenderGuard" back): keep it as a backup
  if (Test-Path -LiteralPath $legacy) { Move-Item -LiteralPath $legacy -Destination (Join-Path $here "RenderGuard.backup.$stamp.exe"); "old RenderGuard.exe kept as RenderGuard.backup.$stamp.exe" }
  "built $target"
} finally {
  if ($stopped) {
    Start-Process -FilePath $target -ArgumentList '--agent' -WindowStyle Hidden
    "restarted (invisible agent): $target"
  }
}
