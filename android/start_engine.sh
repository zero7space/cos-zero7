#!/system/bin/sh
# Terminate existing daemon if running
PID=$(pgrep -f "[S]tandaloneDaemon")
if [ -n "$PID" ]; then
    echo "Stopping existing daemon (PID: $PID)..."
    kill -9 $PID 2>/dev/null
    sleep 0.5
fi

# Get APK path of com.coldcalling.app
APK=$(pm path com.coldcalling.app | head -n1 | cut -d: -f2)
if [ -z "$APK" ]; then
    echo "ERROR: Cold Calling Pro (com.coldcalling.app) is not installed on this device!"
    exit 1
fi

echo "APK located at: $APK"
export CLASSPATH=$APK

# Launch daemon in background with nohup
nohup app_process / com.coldcalling.app.recording.StandaloneDaemon >/data/local/tmp/daemon.log 2>&1 &
sleep 1

NEW_PID=$(pgrep -f "[S]tandaloneDaemon")
if [ -n "$NEW_PID" ]; then
    echo "=================================================="
    echo "Recorder Engine started successfully (PID: $NEW_PID)"
    echo "Listening on: 127.0.0.1:58432"
    echo "Ready for seamless 2-way call recording!"
    echo "=================================================="
else
    echo "ERROR: Failed to launch StandaloneDaemon."
    cat /data/local/tmp/daemon.log
    exit 1
fi
