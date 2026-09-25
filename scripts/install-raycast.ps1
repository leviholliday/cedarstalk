# Installs the cedarstalk Raycast commands on Windows. Called by "Start cedarstalk.cmd";
# needs only Bun -- a node.exe copy of Bun covers Raycast's own tooling.
param([string]$Bun = "bun")
$ErrorActionPreference = "Stop"
$root = Join-Path $env:USERPROFILE ".cedarstalk"
$dir  = Join-Path $root "raycast"
$shim = Join-Path $root "shim"
try {
  if (-not (Test-Path $Bun)) { $Bun = (Get-Command $Bun).Source }

  Write-Host "  Downloading the Raycast commands..."
  $zip = Join-Path $env:TEMP "cedarstalk-raycast.zip"
  $tmp = Join-Path $root "raycast-tmp"
  Invoke-WebRequest "https://github.com/leviholliday/cedarstalk-raycast/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip $tmp -Force
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
  Move-Item (Join-Path $tmp "cedarstalk-raycast-main") $dir
  Remove-Item $tmp -Recurse -Force
  Remove-Item $zip -Force

  New-Item -ItemType Directory -Force $shim | Out-Null
  Copy-Item $Bun (Join-Path $shim "node.exe") -Force
  $env:PATH = "$shim;$env:PATH"

  Push-Location $dir
  & $Bun install | Out-Null
  Write-Host "  Adding them to Raycast (about 30 seconds)..."
  $dev = Start-Process -FilePath (Join-Path $shim "node.exe") `
    -ArgumentList "node_modules/@raycast/api/bin/run.js", "develop" -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 30
  taskkill /T /F /PID $dev.Id 2>$null | Out-Null
  Pop-Location
  Write-Host "  Done -- open Raycast and type ""cedarstalk"". It asks for your token the first time."
  Write-Host ""
} catch {
  Write-Host "  Couldn't add them to Raycast: $($_.Exception.Message)"
  Write-Host "  cedarstalk itself still works -- this only skips Raycast."
  Write-Host ""
}
