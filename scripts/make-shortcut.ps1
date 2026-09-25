# Puts a "cedarstalk" shortcut with the cedarstalk icon on the Desktop. Called
# once by "Start cedarstalk.cmd". It runs cedarstalk in the background (no
# console window) and opens it in its own window.
$app = Split-Path -Parent $PSScriptRoot
try {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop "cedarstalk.lnk"))
  $starter = Join-Path $app "scripts\start-hidden.vbs"
  # Extracted from a downloaded zip it carries the "from the internet" mark,
  # which would make Windows ask every single time.
  Unblock-File $starter -ErrorAction SilentlyContinue
  $shortcut.TargetPath = Join-Path $env:SystemRoot "System32\wscript.exe"
  $shortcut.Arguments = '"' + $starter + '"'
  $shortcut.WorkingDirectory = $app
  $shortcut.IconLocation = (Join-Path $app "assets\cedarstalk.ico") + ",0"
  $shortcut.Description = "cedarstalk -- built on cedarengine by Kieran Klukas"
  $shortcut.Save()
  Write-Host "  Added a cedarstalk shortcut to your Desktop -- use it next time."
} catch {
  Write-Host "  Couldn't add a Desktop shortcut: $($_.Exception.Message)"
}
