@echo off
title Roblox Update Tracker Bot
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
echo Building Roblox Update Tracker...
call npm run build
if errorlevel 1 (
  echo.
  echo Build failed. Check the error above.
  pause
  exit /b 1
)
echo.
echo Starting Roblox Update Tracker bot...
node dist\index.js
echo.
echo Bot stopped or crashed. Check the output above.
pause
