# Puts a "cedarstalk" shortcut with the cedarstalk icon on the Desktop. Called
# once by "Start cedarstalk.cmd"; the server window starts minimized, so what
# you see is the cedarstalk window itself.
$app = Split-Path -Parent $PSScriptRoot
try {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop "cedarstalk.lnk"))
  $shortcut.TargetPath = Join-Path $app "Start cedarstalk.cmd"
  $shortcut.WorkingDirectory = $app
  $shortcut.IconLocation = (Join-Path $app "assets\cedarstalk.ico") + ",0"
  $shortcut.WindowStyle = 7
  $shortcut.Description = "cedarstalk -- built on cedarengine by Kieran Klukas"
  $shortcut.Save()
  Write-Host "  Added a cedarstalk shortcut to your Desktop -- use it next time."
} catch {
  Write-Host "  Couldn't add a Desktop shortcut: $($_.Exception.Message)"
}
