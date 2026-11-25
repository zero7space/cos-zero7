#!/usr/bin/env python3
"""
Zero7 CRM — Windows Desktop System Tray Companion & Agent Bridge
Runs silently in the Windows 11 system tray (notification area).
Monitors Google Antigravity & Cloud CRM connection, handles background agent execution,
and gives the 3 Zero7 founders 1-click status, logs, and controls.
"""

import os
import sys
import time
import threading
import webbrowser
import subprocess
from PIL import Image, ImageDraw
import pystray

# Add workspace directory to sys.path so worker can be imported cleanly
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from agent_worker.worker import AntigravityWorker, SERVER_URL, ANTIGRAVITY_EXE, CREATE_NO_WINDOW

LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker.log")

# When launched via pythonw.exe or hidden process, stdout and stderr are None
if sys.stdout is None or sys.stderr is None:
    try:
        log_stream = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
        if sys.stdout is None:
            sys.stdout = log_stream
        if sys.stderr is None:
            sys.stderr = log_stream
    except Exception:
        pass
PROJECTS_DIR = os.path.join(os.path.expanduser("~"), "Desktop", "zero7 Consultancy", "Projects")
STARTUP_DIR = os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs\Startup")
SHORTCUT_PATH = os.path.join(STARTUP_DIR, "Zero7_Agent_Bridge.lnk")
ANTIGRAVITY_SHORTCUT_PATH = os.path.join(STARTUP_DIR, "Google_Antigravity.lnk")

def create_tray_icon_image(color_hex="#10b981", accent_hex="#ffffff"):
    """Generates a high-DPI circular status badge icon for the Windows taskbar tray."""
    size = (64, 64)
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    
    # Outer circle
    draw.ellipse((4, 4, 60, 60), fill=color_hex)
    
    # Inner accent dot
    draw.ellipse((22, 22, 42, 42), fill=accent_hex)
    return image

# Pre-render state icons
ICON_READY = create_tray_icon_image("#10b981", "#ffffff")     # Emerald Green
ICON_BUSY = create_tray_icon_image("#f59e0b", "#ffffff")      # Amber Yellow
ICON_WAITING = create_tray_icon_image("#f97316", "#ffffff")   # Orange
ICON_OFFLINE = create_tray_icon_image("#ef4444", "#ffffff")   # Rose Red

class TrayCompanion:
    def __init__(self):
        self.worker = None
        self.worker_thread = None
        self.icon = None
        self.current_state = "initializing"
        self.status_detail = "Starting..."
        self.crm_url = os.environ.get("CRM_SERVER_URL", SERVER_URL)

    def on_worker_status_change(self, status, detail=""):
        self.current_state = status
        self.status_detail = detail
        if not self.icon:
            return

        # Update tray icon color and tooltip
        if status == "ready":
            self.icon.icon = ICON_READY
            self.icon.title = f"Zero7 Agent Bridge: Ready (Antigravity active)\nCRM: {self.crm_url}"
        elif status == "busy":
            self.icon.icon = ICON_BUSY
            self.icon.title = f"Zero7 Agent Bridge: {detail}\nCRM: {self.crm_url}"
        elif status == "waiting":
            self.icon.icon = ICON_WAITING
            self.icon.title = f"Zero7 Agent Bridge: {detail}"
        else:
            self.icon.icon = ICON_OFFLINE
            self.icon.title = f"Zero7 Agent Bridge: Offline\n{detail}"

        try:
            self.icon.update_menu()
        except Exception:
            pass

    def on_worker_notification(self, title, message):
        if self.icon:
            try:
                self.icon.notify(message, title)
            except Exception:
                pass

    def start_worker_thread(self):
        """Starts or restarts the background AntigravityWorker."""
        if self.worker:
            self.worker.running = False
            time.sleep(1)

        self.worker = AntigravityWorker(
            on_status_change=self.on_worker_status_change,
            on_notification=self.on_worker_notification
        )
        self.worker_thread = threading.Thread(target=self.worker.start, daemon=True)
        self.worker_thread.start()

    # --- Menu Actions ---
    def open_crm(self, icon, item):
        webbrowser.open(self.crm_url)

    def open_antigravity(self, icon, item):
        if os.path.exists(ANTIGRAVITY_EXE):
            subprocess.Popen([ANTIGRAVITY_EXE])
        else:
            if self.icon:
                self.icon.notify("Antigravity executable not found at default path.", "Zero7 Agent Bridge")

    def open_projects_folder(self, icon, item):
        os.makedirs(PROJECTS_DIR, exist_ok=True)
        os.startfile(PROJECTS_DIR)

    def open_logs(self, icon, item):
        if not os.path.exists(LOG_FILE):
            with open(LOG_FILE, "w", encoding="utf-8") as f:
                f.write("=== Zero7 Agent Bridge Log Initialized ===\n")
        os.startfile(LOG_FILE)

    def is_startup_enabled(self, item=None):
        return os.path.exists(SHORTCUT_PATH)

    def toggle_startup(self, icon, item):
        if self.is_startup_enabled():
            # Remove startup shortcuts
            for path in [SHORTCUT_PATH, ANTIGRAVITY_SHORTCUT_PATH]:
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except Exception:
                        pass
            if self.icon:
                self.icon.notify("Zero7 Agent Bridge removed from Windows Startup.", "Auto-Start Disabled")
        else:
            # Create startup shortcuts
            os.makedirs(STARTUP_DIR, exist_ok=True)
            vbs_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "start_silent.vbs")
            ps_cmd = f"""
            $ws = New-Object -ComObject WScript.Shell
            $s = $ws.CreateShortcut('{SHORTCUT_PATH}')
            $s.TargetPath = 'wscript.exe'
            $s.Arguments = '"{vbs_script}"'
            $s.WorkingDirectory = '{BASE_DIR}'
            $s.Description = 'Zero7 CRM Antigravity Bridge Worker'
            $s.Save()

            if (Test-Path '{ANTIGRAVITY_EXE}') {{
                $s2 = $ws.CreateShortcut('{ANTIGRAVITY_SHORTCUT_PATH}')
                $s2.TargetPath = '{ANTIGRAVITY_EXE}'
                $s2.Description = 'Google Antigravity IDE'
                $s2.Save()
            }}
            """
            try:
                subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True, check=True, creationflags=CREATE_NO_WINDOW)
                if self.icon:
                    self.icon.notify("Zero7 Bridge & Antigravity will now launch automatically on Windows login.", "Auto-Start Enabled")
            except Exception as e:
                if self.icon:
                    self.icon.notify(f"Failed to set startup shortcut: {e}", "Error")

    def sync_all_client_repos(self, icon, item):
        """Scans Projects folder and runs git pull --rebase on every client repository."""
        def run_sync():
            if not os.path.exists(PROJECTS_DIR):
                if self.icon:
                    self.icon.notify("Projects directory does not exist yet.", "Sync Skipped")
                return

            if self.icon:
                self.icon.notify("Syncing all client project repositories from GitHub...", "Zero7 Agent Bridge")

            git_env = os.environ.copy()
            git_env["GIT_TERMINAL_PROMPT"] = "0"
            synced = 0
            failed = 0

            for entry in os.listdir(PROJECTS_DIR):
                full_p = os.path.join(PROJECTS_DIR, entry)
                if os.path.isdir(full_p) and os.path.exists(os.path.join(full_p, ".git")):
                    try:
                        res = subprocess.run(
                            ["git", "pull", "--rebase", "origin", "main"],
                            cwd=full_p, env=git_env, capture_output=True, text=True, timeout=25, creationflags=CREATE_NO_WINDOW
                        )
                        if res.returncode == 0:
                            synced += 1
                        else:
                            # Try theirs merge if rebase had conflict
                            subprocess.run(["git", "rebase", "--abort"], cwd=full_p, env=git_env, capture_output=True, timeout=10, creationflags=CREATE_NO_WINDOW)
                            res2 = subprocess.run(["git", "pull", "-X", "theirs", "origin", "main", "--no-edit"], cwd=full_p, env=git_env, capture_output=True, timeout=25, creationflags=CREATE_NO_WINDOW)
                            if res2.returncode == 0:
                                synced += 1
                            else:
                                failed += 1
                    except Exception:
                        failed += 1

            msg = f"Synced {synced} client repositories."
            if failed > 0:
                msg += f" ({failed} skipped or errored)"
            if self.icon:
                self.icon.notify(msg, "Client Vaults Updated")

        threading.Thread(target=run_sync, daemon=True).start()

    def restart_worker(self, icon=None, item=None):
        self.start_worker_thread()
        if self.icon:
            self.icon.notify("Restarting worker background thread...", "Zero7 Agent Bridge")

    def open_pairing_dialog(self, icon=None, item=None):
        def _launch():
            try:
                from agent_worker.login_dialog import show_pairing_dialog
                paired = show_pairing_dialog(on_success=lambda cfg: self.restart_worker())
                if paired:
                    self.restart_worker()
            except Exception as e:
                print(f"[PAIRING DIALOG ERROR] {e}")
        threading.Thread(target=_launch, daemon=True).start()

    def quit_app(self, icon=None, item=None):
        if self.worker:
            self.worker.running = False
        if self.icon:
            self.icon.stop()
        sys.exit(0)

    # --- Dynamic Menu Builder ---
    def get_status_label(self, item=None):
        if self.current_state == "ready":
            return "Status:  Ready (Idle)"
        elif self.current_state == "busy":
            return f"Status:  {self.status_detail}"
        elif self.current_state == "waiting":
            return f"Status:  {self.status_detail}"
        return "Status:  Offline / Error"

    def build_menu(self):
        return pystray.Menu(
            pystray.MenuItem("⚡ Zero7 Agent Bridge", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(self.get_status_label, None, enabled=False),
            pystray.MenuItem(lambda item: f"💻 Machine: {self.worker.machine_name if self.worker else 'Local PC'}", None, enabled=False),
            pystray.MenuItem(lambda item: f"👤 Account: {self.worker.user_name if self.worker and self.worker.user_name else 'Unlinked'} ({self.worker.user_email if self.worker and self.worker.user_email else 'No login'})", None, enabled=False),
            pystray.MenuItem(lambda item: f"📂 Installed: {self.worker.install_path if self.worker and hasattr(self.worker, 'install_path') else 'agent_worker'}", None, enabled=False),
            pystray.MenuItem(lambda item: f"🌐 Target: {self.crm_url}", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("🔑 Switch Account / Re-pair Workstation...", self.open_pairing_dialog),
            pystray.MenuItem("🌐 Open Cloud CRM", self.open_crm),
            pystray.MenuItem("🚀 Open Antigravity IDE", self.open_antigravity),
            pystray.MenuItem("📁 Open Client Projects Folder", self.open_projects_folder),
            pystray.MenuItem("🔄 Sync All Client Repositories", self.sync_all_client_repos),
            pystray.MenuItem("📋 View Live Worker Logs", self.open_logs),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("⚙️ Run on Windows Startup", self.toggle_startup, checked=self.is_startup_enabled),
            pystray.MenuItem("🔄 Restart Bridge Worker", self.restart_worker),
            pystray.MenuItem("❌ Exit", self.quit_app)
        )

    def run(self):
        # 1. Start worker thread in background
        self.start_worker_thread()

        # 2. Build and start system tray icon
        self.icon = pystray.Icon(
            name="zero7_agent_bridge",
            icon=ICON_WAITING,
            title="Zero7 Agent Bridge: Initializing...",
            menu=self.build_menu()
        )

        print("[TRAY] Zero7 Agent Bridge running in Windows System Tray.")
        self.icon.run()

if __name__ == "__main__":
    # Prevent duplicate tray bridge instances using Windows named mutex
    import ctypes
    mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "Zero7_Agent_Bridge_SingleInstance_Mutex")
    if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        print("[INFO] Zero7 Agent Bridge is already running.")
        sys.exit(0)

    try:
        app = TrayCompanion()
        app.run()
    except Exception as e:
        import traceback
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[TRAY CRASH] {traceback.format_exc()}\n")
