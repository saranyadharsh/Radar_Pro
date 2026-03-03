@echo off
echo ========================================
echo   NexRadar Pro - Starting All Services
echo ========================================
echo.
echo This will open 2 terminal windows:
echo   1. Backend Server (port 8000)
echo   2. Frontend Dev Server (port 5173)
echo.
echo Wait for both to start, then visit:
echo   http://localhost:5173
echo.
echo Press any key to continue...
pause >nul

start "NexRadar Backend" cmd /k "%~dp0start-backend.bat"
timeout /t 3 /nobreak >nul
start "NexRadar Frontend" cmd /k "%~dp0start-frontend.bat"

echo.
echo ========================================
echo   Services Starting...
echo ========================================
echo.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo Opening browser in 5 seconds...
timeout /t 5 /nobreak >nul
start http://localhost:5173
