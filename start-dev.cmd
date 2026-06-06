@echo off
chcp 65001 >nul
title HRSystem Dev Launcher

set ROOT=%~dp0

echo Starting HRSystem backend and frontend...

start "HRSystem Backend" cmd /k "cd /d %ROOT%src\backend && node index.js"

start "HRSystem Frontend" cmd /k "cd /d %ROOT%src\frontend\app && set NODE_OPTIONS=--no-deprecation && npm start"

echo.
echo HRSystem backend and frontend started.
echo.
pause