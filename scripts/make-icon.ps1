# VideoHub's icon (a dark tile with a gauge), drawn with Windows' own System.Drawing and packed as PNG-in-ICO.
#   powershell -NoProfile -File scripts\make-icon.ps1 <out.ico>     (setup.ps1 writes datapp.ico for the Desktop shortcut)
param([Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = 'Stop'
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
New-Item -ItemType Directory -Force (Split-Path -Parent $Out) | Out-Null
[System.IO.File]::WriteAllBytes($Out, $ico.ToArray())
