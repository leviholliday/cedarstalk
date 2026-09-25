@echo off
rem Double-click to run cedarstalk. The first run installs Bun (one time, from
rem bun.sh) and opens the setup page. Leave the window open while you use it.
title cedarstalk
cd /d "%~dp0"
echo.
echo   cedarstalk
echo.

set "BUN="
where bun >nul 2>nul && set "BUN=bun"
if not defined BUN if exist "%USERPROFILE%\.bun\bin\bun.exe" set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if not defined BUN (
  echo   Installing Bun ^(one time, from bun.sh^)...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
  if exist "%USERPROFILE%\.bun\bin\bun.exe" set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
)
if not defined BUN (
  echo   Couldn't install Bun -- check your internet and double-click this again.
  pause
  exit /b 1
)

if not exist "data\.raycast-asked" (
  if not exist data mkdir data
  type nul > "data\.raycast-asked"
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\install-raycast.ps1" -Bun "%BUN%" -Ask
)

if not exist "data\.shortcut-v2" (
  if not exist data mkdir data
  type nul > "data\.shortcut-v2"
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\make-shortcut.ps1"
)

set CEDARSTALK_OPEN=1
"%BUN%" run src\index.ts
echo.
echo   cedarstalk stopped.
pause
