@echo off
title Zero7 CRM - Antigravity Agent Local Worker
color 0A
cd /d "%~dp0\.."

echo ======================================================================
echo           ZERO7 CRM - GOOGLE ANTIGRAVITY BRIDGE WORKER
echo ======================================================================
echo  Connecting your Windows 11 PC (Google AI Pro Session) to Cloud CRM:
echo  Target: https://cos.zero7.space
echo ======================================================================
echo.

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not found in your PATH.
    echo Please install Python 3.10+ or ensure it is added to your environment variables.
    pause
    exit /b 1
)

python agent_worker\worker.py

if %errorlevel% neq 0 (
    echo.
    echo [WARNING] Worker process terminated with code %errorlevel%.
    pause
)
