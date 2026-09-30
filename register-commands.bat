@echo off
title Register Roblox Update Tracker Commands
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
call npm run register-commands
pause
