@echo off
rem Double-click to (re)install the cedarstalk commands in Raycast for Windows.
title cedarstalk - Raycast
cd /d "%~dp0"
set "BUN="
where bun >nul 2>nul && set "BUN=bun"
if not defined BUN if exist "%USERPROFILE%\.bun\bin\bun.exe" set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if not defined BUN (
  echo   Run "Start cedarstalk" once first -- it installs what this needs.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\install-raycast.ps1" -Bun "%BUN%"
pause
