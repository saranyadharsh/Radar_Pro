@echo off
echo ========================================
echo   NexRadar Pro - Backend Server
echo ========================================
echo.
echo Starting backend on http://localhost:8000
echo WebSocket will be available at ws://localhost:8000/ws/live
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

cd /d "%~dp0"
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
