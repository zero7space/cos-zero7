#!/usr/bin/env python3
"""
Zero7 Agent Bridge — Desktop Workstation Pairing & Login Dialog
Provides a native GUI for founders to securely authenticate their Zero7 CRM account
and attach their physical PC with installation path and workspace roots.
"""

import os
import sys
import json
import socket
import platform
import urllib.request
import urllib.error
import ssl
import tkinter as tk
from tkinter import ttk, messagebox

# Resolve canonical paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENT_DIR = os.path.join(BASE_DIR, "agent_worker")
CONFIG_PATH = os.path.join(AGENT_DIR, "worker_config.json")
DEFAULT_SERVER = os.environ.get("CRM_SERVER_URL", "https://cos.zero7.space").rstrip("/")

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

class DevicePairingDialog:
    def __init__(self, parent=None, on_success=None):
        self.root = parent or tk.Tk()
        self.on_success = on_success
        self.paired_successfully = False

        self.root.title("Zero7 Agent Bridge — Workstation Setup")
        self.root.geometry("480x560")
        self.root.resizable(False, False)
        self.root.configure(bg="#0f172a")  # Deep Slate Navy matching Zero7 Dark Mode

        # Set window icon if available
        ico_path = os.path.join(AGENT_DIR, "icons", "zero7_bridge.ico")
        if os.path.exists(ico_path):
            try:
                self.root.iconbitmap(ico_path)
            except Exception:
                pass

        # Load existing config for prefilling
        self.existing_cfg = {}
        if os.path.exists(CONFIG_PATH):
            try:
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    self.existing_cfg = json.load(f)
            except Exception:
                pass

        self.machine_name = os.environ.get("COMPUTERNAME") or socket.gethostname() or "FIZZY"
        self.install_path = AGENT_DIR
        self.projects_root = os.path.join(os.path.expanduser("~"), "Desktop", "zero7 Consultancy", "Projects")

        self.build_ui()

    def build_ui(self):
        # Header banner
        header = tk.Frame(self.root, bg="#1e293b", padx=24, pady=18)
        header.pack(fill="x")

        title = tk.Label(
            header,
            text="⚡ Zero7 Agent Bridge",
            font=("Segoe UI", 16, "bold"),
            fg="#f8fafc",
            bg="#1e293b"
        )
        title.pack(anchor="w")

        subtitle = tk.Label(
            header,
            text="Attach this physical PC to your Zero7 CRM account",
            font=("Segoe UI", 9.5),
            fg="#94a3b8",
            bg="#1e293b"
        )
        subtitle.pack(anchor="w", pady=(2, 0))

        # Main Form Container
        form = tk.Frame(self.root, bg="#0f172a", padx=28, pady=20)
        form.pack(fill="both", expand=True)

        # Server URL
        tk.Label(form, text="Cloud CRM URL", font=("Segoe UI", 9, "bold"), fg="#cbd5e1", bg="#0f172a").pack(anchor="w")
        self.server_entry = tk.Entry(form, font=("Segoe UI", 10), bg="#1e293b", fg="#f8fafc", insertbackground="#38bdf8", relief="flat", highlightthickness=1, highlightbackground="#334155")
        self.server_entry.insert(0, self.existing_cfg.get("server_url") or DEFAULT_SERVER)
        self.server_entry.pack(fill="x", pady=(4, 12), ipady=4)

        # Email
        tk.Label(form, text="Founder Email *", font=("Segoe UI", 9, "bold"), fg="#cbd5e1", bg="#0f172a").pack(anchor="w")
        self.email_entry = tk.Entry(form, font=("Segoe UI", 10), bg="#1e293b", fg="#f8fafc", insertbackground="#38bdf8", relief="flat", highlightthickness=1, highlightbackground="#334155")
        default_email = self.existing_cfg.get("user_email")
        if not default_email or default_email.lower() in ("unassigned", "m_hit@zero7.space"):
            default_email = "abhijeet@zero7.space"
        self.email_entry.insert(0, default_email)
        self.email_entry.pack(fill="x", pady=(4, 12), ipady=4)

        # Password
        tk.Label(form, text="CRM Password *", font=("Segoe UI", 9, "bold"), fg="#cbd5e1", bg="#0f172a").pack(anchor="w")
        self.pass_entry = tk.Entry(form, font=("Segoe UI", 10), show="•", bg="#1e293b", fg="#f8fafc", insertbackground="#38bdf8", relief="flat", highlightthickness=1, highlightbackground="#334155")
        self.pass_entry.pack(fill="x", pady=(4, 14), ipady=4)

        # Device & Hardware Info Section
        info_frame = tk.Frame(form, bg="#1e293b", padx=12, pady=10, relief="flat", highlightthickness=1, highlightbackground="#334155")
        info_frame.pack(fill="x", pady=(0, 16))

        tk.Label(info_frame, text=f"💻 Machine: {self.machine_name} ({platform.system()} {platform.release()})", font=("Segoe UI", 8.5), fg="#cbd5e1", bg="#1e293b").pack(anchor="w")
        tk.Label(info_frame, text=f"📂 Install Path: {self.install_path}", font=("Segoe UI", 8), fg="#94a3b8", bg="#1e293b").pack(anchor="w", pady=(2, 0))
        tk.Label(info_frame, text=f"📁 Vault Storage: {self.projects_root}", font=("Segoe UI", 8), fg="#94a3b8", bg="#1e293b").pack(anchor="w", pady=(1, 0))

        # Status text
        self.status_label = tk.Label(form, text="", font=("Segoe UI", 9), fg="#38bdf8", bg="#0f172a")
        self.status_label.pack(fill="x", pady=(0, 10))

        # Action Buttons
        btn_frame = tk.Frame(form, bg="#0f172a")
        btn_frame.pack(fill="x")

        self.submit_btn = tk.Button(
            btn_frame,
            text="Connect Workstation",
            font=("Segoe UI", 10, "bold"),
            bg="#2563eb",
            fg="#ffffff",
            activebackground="#1d4ed8",
            activeforeground="#ffffff",
            relief="flat",
            cursor="hand2",
            command=self.handle_pair
        )
        self.submit_btn.pack(fill="x", ipady=6)

        # Focus password
        self.pass_entry.focus()
        self.root.bind("<Return>", lambda e: self.handle_pair())

    def handle_pair(self):
        server = self.server_entry.get().strip().rstrip("/")
        email = self.email_entry.get().strip()
        pwd = self.pass_entry.get().strip()

        if not email or not pwd:
            self.status_label.configure(text="Please enter both email and password.", fg="#ef4444")
            return

        self.status_label.configure(text="Authenticating with Zero7 CRM...", fg="#38bdf8")
        self.submit_btn.configure(state="disabled")
        self.root.update()

        try:
            url = f"{server}/api/agent/device/pair"
            payload = {
                "email": email,
                "password": pwd,
                "machine_name": self.machine_name,
                "install_path": self.install_path,
                "projects_root": self.projects_root,
                "os_info": f"{platform.system()} {platform.release()}"
            }
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})

            with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
                res = json.loads(resp.read().decode("utf-8"))

            if res.get("status") == "paired":
                # Save verified pairing config
                cfg = {
                    "worker_id": res.get("worker_id"),
                    "machine_name": self.machine_name,
                    "user_name": res.get("user_name"),
                    "user_email": res.get("user_email"),
                    "user_id": res.get("user_id"),
                    "server_url": server,
                    "install_path": self.install_path,
                    "projects_root": self.projects_root,
                    "device_token": res.get("token"),
                    "paired": True,
                    "paired_at": json.loads(json.dumps(res)).get("paired_at") or os.environ.get("PAIRED_AT", "")
                }
                with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                    json.dump(cfg, f, indent=2)

                self.paired_successfully = True
                self.status_label.configure(text=f"✓ Workstation linked to {res.get('user_email')}!", fg="#10b981")
                messagebox.showinfo(
                    "Device Attached Successfully",
                    f"Workstation '{self.machine_name}' has been successfully linked to {res.get('user_name')} ({res.get('user_email')})!\n\nThe Zero7 Agent Bridge is now ready to receive autonomous AI jobs."
                )
                if self.on_success:
                    self.on_success(cfg)
                self.root.destroy()
            else:
                self.status_label.configure(text="Pairing failed. Please verify credentials.", fg="#ef4444")
                self.submit_btn.configure(state="normal")
        except urllib.error.HTTPError as he:
            err_msg = "Authentication failed"
            try:
                err_data = json.loads(he.read().decode("utf-8"))
                err_msg = err_data.get("detail") or err_msg
            except Exception:
                pass
            self.status_label.configure(text=f"Error: {err_msg}", fg="#ef4444")
            self.submit_btn.configure(state="normal")
        except Exception as e:
            self.status_label.configure(text=f"Network Error: {str(e)[:45]}", fg="#ef4444")
            self.submit_btn.configure(state="normal")

def show_pairing_dialog(on_success=None):
    dialog = DevicePairingDialog(on_success=on_success)
    dialog.root.mainloop()
    return dialog.paired_successfully

if __name__ == "__main__":
    show_pairing_dialog()
