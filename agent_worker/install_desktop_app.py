#!/usr/bin/env python3
"""
Zero7 CRM & Agent Bridge — Windows Native App Installer
Creates Desktop, Start Menu, and Windows Startup shortcuts with high-resolution icons.
"""

import os
import sys
import subprocess
import shutil
import argparse
import json

parser = argparse.ArgumentParser(description="Zero7 Desktop App Installer")
parser.add_argument("--email", default=None, help="User email (e.g. abhijeet@zero7.space)")
parser.add_argument("--name", default=None, help="User display name")
parser.add_argument("--machine", default=None, help="Machine name")
args, _ = parser.parse_known_args()

USER_PROFILE = os.environ.get("USERPROFILE", os.path.expanduser("~"))
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Save worker_config.json if account parameters are provided
cfg_file = os.path.join(BASE_DIR, "agent_worker", "worker_config.json")
cfg = {}
if os.path.exists(cfg_file):
    try:
        with open(cfg_file, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        pass

if args.email:
    cfg["user_email"] = args.email
if args.name:
    cfg["user_name"] = args.name
if args.machine:
    cfg["machine_name"] = args.machine

if cfg:
    with open(cfg_file, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    print(f"[CONFIG] Linked worker account: {cfg.get('user_email', 'unknown')}")

if not cfg.get("user_email") or cfg["user_email"].lower() in ("unassigned", "m_hit@zero7.space", "unknown@zero7.space"):
    print("[AUTH] No linked founder account detected. Launching Zero7 Workstation Pairing dialog...")
    try:
        from agent_worker.login_dialog import show_pairing_dialog
        show_pairing_dialog()
        if os.path.exists(cfg_file):
            with open(cfg_file, "r", encoding="utf-8") as f:
                cfg = json.load(f)
    except Exception as e:
        print(f"[AUTH NOTE] Setup will continue. You can log in anytime via the tray companion. ({e})")
ICONS_DIR = os.path.join(BASE_DIR, "agent_worker", "icons")
CRM_ICO = os.path.join(ICONS_DIR, "zero7_crm.ico")
BRIDGE_ICO = os.path.join(ICONS_DIR, "zero7_bridge.ico")
START_SILENT_VBS = os.path.join(BASE_DIR, "agent_worker", "start_silent.vbs")

DESKTOP_DIR = os.path.join(USER_PROFILE, "Desktop")
START_MENU_DIR = os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs\Zero7")
STARTUP_DIR = os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs\Startup")

# Find Browser for standalone app mode (Chrome preferred, Edge fallback)
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
CHROME_PATH_X86 = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
EDGE_PATH_64 = r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"

browser_exe = None
for p in [CHROME_PATH, CHROME_PATH_X86, EDGE_PATH, EDGE_PATH_64]:
    if os.path.exists(p):
        browser_exe = p
        break

if not browser_exe:
    browser_exe = "msedge.exe"

print(f"[INSTALL] Found Browser for App Mode: {browser_exe}")

os.makedirs(START_MENU_DIR, exist_ok=True)
os.makedirs(STARTUP_DIR, exist_ok=True)

# PowerShell script to generate shortcuts cleanly via WScript.Shell
ps_script = f"""
$ws = New-Object -ComObject WScript.Shell

# 1. Desktop: Zero7 CRM
$s1 = $ws.CreateShortcut('{os.path.join(DESKTOP_DIR, "Zero7 CRM.lnk")}')
$s1.TargetPath = '{browser_exe}'
$s1.Arguments = '--app="https://cos.zero7.space/"'
$s1.WorkingDirectory = '{BASE_DIR}'
$s1.Description = 'Zero7 Multi-Business Operating System & Autonomous CRM'
$s1.IconLocation = '{CRM_ICO},0'
$s1.Save()
Write-Host "Created Desktop shortcut: Zero7 CRM"

# 2. Desktop: Zero7 Agent Bridge
$s2 = $ws.CreateShortcut('{os.path.join(DESKTOP_DIR, "Zero7 Agent Bridge.lnk")}')
$s2.TargetPath = 'wscript.exe'
$s2.Arguments = '"{START_SILENT_VBS}"'
$s2.WorkingDirectory = '{BASE_DIR}'
$s2.Description = 'Zero7 Agent Bridge & Google Antigravity Desktop Companion'
$s2.IconLocation = '{BRIDGE_ICO},0'
$s2.Save()
Write-Host "Created Desktop shortcut: Zero7 Agent Bridge"

# 3. Start Menu: Zero7 CRM
$s3 = $ws.CreateShortcut('{os.path.join(START_MENU_DIR, "Zero7 CRM.lnk")}')
$s3.TargetPath = '{browser_exe}'
$s3.Arguments = '--app="https://cos.zero7.space/"'
$s3.WorkingDirectory = '{BASE_DIR}'
$s3.Description = 'Zero7 Multi-Business Operating System & Autonomous CRM'
$s3.IconLocation = '{CRM_ICO},0'
$s3.Save()
Write-Host "Created Start Menu shortcut: Zero7 CRM"

# 4. Start Menu: Zero7 Agent Bridge
$s4 = $ws.CreateShortcut('{os.path.join(START_MENU_DIR, "Zero7 Agent Bridge.lnk")}')
$s4.TargetPath = 'wscript.exe'
$s4.Arguments = '"{START_SILENT_VBS}"'
$s4.WorkingDirectory = '{BASE_DIR}'
$s4.Description = 'Zero7 Agent Bridge & Google Antigravity Desktop Companion'
$s4.IconLocation = '{BRIDGE_ICO},0'
$s4.Save()
Write-Host "Created Start Menu shortcut: Zero7 Agent Bridge"

# 5. Startup Folder: Auto-launch Bridge on Windows Login
$s5 = $ws.CreateShortcut('{os.path.join(STARTUP_DIR, "Zero7_Agent_Bridge.lnk")}')
$s5.TargetPath = 'wscript.exe'
$s5.Arguments = '"{START_SILENT_VBS}"'
$s5.WorkingDirectory = '{BASE_DIR}'
$s5.Description = 'Zero7 CRM Antigravity Bridge Worker'
$s5.IconLocation = '{BRIDGE_ICO},0'
$s5.Save()
Write-Host "Created Windows Startup shortcut: Zero7_Agent_Bridge"
"""

res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_script], capture_output=True, text=True)
print(res.stdout)
if res.stderr:
    print("Warnings/Errors:", res.stderr)

print("\n[INSTALL COMPLETE] All native Windows shortcuts created successfully!")
