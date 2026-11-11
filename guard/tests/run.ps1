$ErrorActionPreference='Stop'
$fw=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$testWork=Join-Path ([IO.Path]::GetTempPath()) ('RenderGuard-regression-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $testWork | Out-Null
$src=Join-Path (Split-Path $PSScriptRoot -Parent) 'RenderGuard.cs'
$test=Join-Path $PSScriptRoot 'RegressionTests.cs'
$testExe=Join-Path $testWork 'RegressionTests.exe'
& "$fw/csc.exe" /nologo /target:exe /main:Tests /platform:x64 /codepage:65001 "/out:$testExe" "/r:$fw/System.Management.dll" "/r:$fw/System.Windows.Forms.dll" "/r:$fw/System.Drawing.dll" "/r:$fw/System.Core.dll" "/r:$fw/System.Web.Extensions.dll" $src $test
if($LASTEXITCODE -ne 0){throw 'Test compilation failed'}
Push-Location $testWork
try {
 & $testExe
 if($LASTEXITCODE -ne 0){throw 'Regression tests failed'}
} finally { Pop-Location }
