@echo off
echo ========================================
echo   NexRadar Pro - Frontend Dev Server
echo ========================================
echo.
echo Starting frontend on http://localhost:5173
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

cd /d "%~dp0frontend"
npm run dev
