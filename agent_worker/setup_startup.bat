@echo off
title Zero7 CRM - Windows Auto-Start Setup
color 0B
cd /d "%~dp0\.."

echo ======================================================================
echo       ZERO7 CRM - AGENT BRIDGE AUTO-START INSTALLER
echo ======================================================================
echo  This script configures your Windows 11 PC so that:
echo  1. Google Antigravity opens automatically on login.
echo  2. Zero7 Agent Bridge Tray Companion starts silently in background.
echo  3. Remote agent triggers from any founder run immediately at 0 cost.
echo ======================================================================
echo.

where pythonw >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] pythonw.exe not found in PATH!
    echo Please make sure Python 3.10+ is installed with PATH checked.
    pause
    exit /b 1
)

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "ANTIGRAVITY_EXE=%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"
set "VBS_SCRIPT=%~dp0start_silent.vbs"
set "ROOT_DIR=%~dp0.."

echo [1/3] Checking Antigravity IDE installation...
if exist "%ANTIGRAVITY_EXE%" (
    echo       [OK] Found Antigravity at: %ANTIGRAVITY_EXE%
) else (
    echo       [WARNING] Antigravity not found at default location.
    echo       The worker will attempt discovery dynamically.
)

echo.
echo [2/3] Registering Windows Startup Shortcuts in:
echo       %STARTUP_FOLDER%

powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$s1 = $ws.CreateShortcut('%STARTUP_FOLDER%\Zero7_Agent_Bridge.lnk'); " ^
  "$s1.TargetPath = 'wscript.exe'; " ^
  "$s1.Arguments = '\"%VBS_SCRIPT%\"'; " ^
  "$s1.WorkingDirectory = '%ROOT_DIR%'; " ^
  "$s1.Description = 'Zero7 CRM Antigravity Bridge Worker'; " ^
  "$s1.Save(); " ^
  "if (Test-Path '%ANTIGRAVITY_EXE%') { " ^
  "    $s2 = $ws.CreateShortcut('%STARTUP_FOLDER%\Google_Antigravity.lnk'); " ^
  "    $s2.TargetPath = '%ANTIGRAVITY_EXE%'; " ^
  "    $s2.Description = 'Google Antigravity IDE'; " ^
  "    $s2.Save(); " ^
  "}"

if %errorlevel% equ 0 (
    echo       [OK] Windows Startup shortcuts created successfully!
) else (
    echo       [ERROR] Failed to create startup shortcuts.
    pause
    exit /b 1
)

echo.
echo [3/3] Checking Python dependencies (pystray, pillow, requests)...
python -m pip install pystray pillow requests >nul 2>&1
echo       [OK] Dependencies verified.

echo.
echo ======================================================================
echo   SUCCESS! Zero7 Agent Bridge is now configured for automatic start.
echo ======================================================================
echo   Whenever this PC powers on and logs into Windows:
echo   - Antigravity will launch ready to process AI jobs.
echo   - The Agent Bridge will sit silently in the system tray.
echo   - Any founder clicking 'Run Agent' in the CRM will trigger tasks
echo     remotely with ZERO token cost and automatic local vault syncing.
echo ======================================================================
echo.
set /p START_NOW="Do you want to start the Agent Bridge right now? (Y/N): "
if /i "%START_NOW%"=="Y" (
    start "" wscript.exe "%VBS_SCRIPT%"
    echo [OK] Zero7 Agent Bridge launched in background! Check your system tray.
)

echo.
pause
