@echo off
title Start Cold Calling Recorder Engine
echo ===================================================
echo Starting Cold Calling Pro Standalone Recorder Engine
echo ===================================================
adb devices
echo.
adb push start_engine.sh /data/local/tmp/start_engine.sh
adb shell "chmod 755 /data/local/tmp/start_engine.sh; sh /data/local/tmp/start_engine.sh"
echo.
echo Standalone Engine setup completed!
pause
