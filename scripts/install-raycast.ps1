# Installs the cedarstalk Raycast commands on Windows -- and Raycast itself if it's missing.
# Needs only Bun: a node.exe copy of Bun covers Raycast's own tooling.
#   install-raycast.ps1 -Bun <path> [-Ask]    -Ask: the launcher's one-time question
param([string]$Bun = "bun", [switch]$Ask)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$root = Join-Path $env:USERPROFILE ".cedarstalk"
$dir  = Join-Path $root "raycast"
$shim = Join-Path $root "shim"
$storeId = "9PFXXSHC64H3"   # Raycast on the Microsoft Store, published by Raycast Technologies Ltd.

function Test-Raycast {
  if (Get-AppxPackage -Name "*Raycast*" -ErrorAction SilentlyContinue) { return $true }
  return (Test-Path (Join-Path $env:LOCALAPPDATA "Programs\Raycast"))
}

function Start-Raycast {
  $app = Get-StartApps | Where-Object { $_.Name -like "Raycast*" } | Select-Object -First 1
  if ($app) { Start-Process "explorer.exe" "shell:AppsFolder\$($app.AppID)" }
}

function Install-Raycast {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "  Installing Raycast from the Microsoft Store (this accepts the Store's and Raycast's terms)..."
    winget install --id $storeId --source msstore --accept-package-agreements --accept-source-agreements --silent | Out-Null
  }
  if (-not (Test-Raycast)) {
    Write-Host "  Opening Raycast in the Microsoft Store -- click Get, wait for it to install."
    Start-Process "ms-windows-store://pdp/?productid=$storeId"
    Read-Host "  Press Enter here once Raycast is installed" | Out-Null
  }
  if (-not (Test-Raycast)) { throw "Raycast didn't install." }
  Start-Raycast
  Read-Host "  Raycast just opened -- click through its welcome screens, then press Enter here" | Out-Null
}

try {
  if ($Ask -and (Read-Host "  Add the cedarstalk commands to Raycast (a free launcher app)? [Y/n]") -match "^[nN]") { exit 0 }
  # No need to ask whether Raycast is installed -- just look.
  if (-not (Test-Raycast)) {
    if ((Read-Host "  Raycast isn't on this computer yet. Install it now? [Y/n]") -match "^[nN]") { exit 0 }
    Install-Raycast
  }

  if (-not (Test-Path $Bun)) { $Bun = (Get-Command $Bun).Source }

  Write-Host "  Downloading the cedarstalk Raycast commands..."
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
  $log = Join-Path $root "raycast-install.log"
  Set-Content $log ""
  Write-Host "  Installing what the commands need..."
  & $Bun install *>> $log

  # Raycast runs each command from ~\.config\raycast\extensions\<name>. Build
  # straight into it and wait until every command is really there -- a fixed
  # timer stopped too early and left "missing executable" and no icons.
  $manifest = Get-Content "package.json" -Raw | ConvertFrom-Json
  $out = Join-Path $env:USERPROFILE ".config\raycast\extensions\$($manifest.name)"
  $node = Join-Path $shim "node.exe"
  $ray = "node_modules/@raycast/api/bin/run.js"
  function Test-Built {
    foreach ($c in $manifest.commands) { if (-not (Test-Path (Join-Path $out "$($c.name).js"))) { return $false } }
    return (Test-Path (Join-Path $out "assets"))
  }

  Write-Host "  Building the commands (this can take a minute the first time)..."
  & $node $ray build -e dev -o $out *>> $log
  if (-not (Test-Built)) {
    Write-Host "  The build didn't finish. The end of the log ($log):"
    Get-Content $log -Tail 15 | ForEach-Object { Write-Host "    $_" }
    Pop-Location
    exit 0
  }

  Write-Host "  Adding them to Raycast..."
  Start-Raycast
  $stamp = Get-Date
  $dev = Start-Process -FilePath $node -ArgumentList $ray, "develop" -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root "raycast-develop.log") -RedirectStandardError (Join-Path $root "raycast-develop-err.log")
  # develop rebuilds and registers with Raycast; wait for that rebuild to land.
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 2
    $pkg = Get-Item (Join-Path $out "package.json") -ErrorAction SilentlyContinue
    if ($pkg -and $pkg.LastWriteTime -ge $stamp -and (Test-Built)) { break }
  }
  Start-Sleep -Seconds 4
  taskkill /T /F /PID $dev.Id 2>$null | Out-Null
  Pop-Location
  Write-Host "  Done -- open Raycast and type ""cedarstalk"". It asks for your token the first time."
  Write-Host ""
} catch {
  Write-Host "  Couldn't add them to Raycast: $($_.Exception.Message)"
  Write-Host "  cedarstalk itself still works -- this only skips Raycast."
  Write-Host ""
}
