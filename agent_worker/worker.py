#!/usr/bin/env python3
"""
Zero7 CRM — Google Antigravity Local Bridge Worker
Runs on the user's Windows 11 host PC.
Connects Cloud CRM (cos.zero7.space) directly to the local Google Antigravity Engine
using your personal Google AI Pro session at ZERO additional token cost.
"""

import os
import sys
import time
import json
import re
import uuid
import ssl
import shutil
import urllib.request
import urllib.error
import subprocess
import threading
import platform
import socket

# Local Machine & Account Identity
MACHINE_NAME = os.environ.get("COMPUTERNAME") or socket.gethostname() or platform.node() or "Unknown-PC"
CURRENT_USER_NAME = os.environ.get("USERNAME") or os.environ.get("USER") or "Zero7 Team"
OS_PLATFORM_INFO = f"{platform.system()} {platform.release()}"
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker_config.json")

def load_worker_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                if cfg.get("user_email") and cfg["user_email"].lower() not in ("unassigned", "m_hit@zero7.space", "unknown@zero7.space"):
                    return cfg
        except Exception:
            pass
    # Never fabricate a fake user email from the Windows OS username (e.g. m_hit).
    clean_machine = re.sub(r'[^a-zA-Z0-9_\-]', '', str(MACHINE_NAME).replace(' ', '_'))
    return {
        "worker_id": f"{clean_machine}_unlinked",
        "machine_name": MACHINE_NAME,
        "user_name": "Unlinked Workstation",
        "user_email": "",
        "paired": False,
        "install_path": os.path.dirname(os.path.abspath(__file__)),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

_log_p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker.log")
class TeeWriter:
    def __init__(self, log_path, original_stream):
        self.original_stream = original_stream
        self.file = open(log_path, "a", encoding="utf-8", buffering=1)

    def write(self, data):
        if self.original_stream:
            try:
                self.original_stream.write(data)
                self.original_stream.flush()
            except Exception:
                pass
        try:
            self.file.write(data)
            self.file.flush()
        except Exception:
            pass

    def flush(self):
        if self.original_stream:
            try:
                self.original_stream.flush()
            except Exception:
                pass
        try:
            self.file.flush()
        except Exception:
            pass

sys.stdout = TeeWriter(_log_p, sys.stdout)
sys.stderr = TeeWriter(_log_p, sys.stderr)

# Configuration
SERVER_URL = os.environ.get("CRM_SERVER_URL", "https://cos.zero7.space").rstrip("/")
POLL_INTERVAL_SECS = 2.5
HEARTBEAT_INTERVAL_SECS = 20.0
USER_HOME = os.path.expanduser("~")
PROJECTS_CONFIG_DIR = os.path.join(USER_HOME, ".gemini", "config", "projects")
BRAIN_DIR = os.path.join(USER_HOME, ".gemini", "antigravity", "brain")

def get_canonical_projects_root():
    """Resolves OS-agnostic canonical projects directory for Zero7 client vaults."""
    env_dir = os.environ.get("ZERO7_PROJECTS_DIR")
    if env_dir:
        return os.path.abspath(env_dir)
    desktop_projects = os.path.join(USER_HOME, "Desktop", "zero7 Consultancy", "Projects")
    if os.path.exists(os.path.join(USER_HOME, "Desktop")):
        return desktop_projects
    return os.path.join(USER_HOME, "Zero7", "Projects")

# Locate agentapi.bat
def find_agentapi_bat():
    cand = shutil.which("agentapi")
    if cand:
        return cand
    default_path = os.path.join(USER_HOME, ".gemini", "antigravity", "bin", "agentapi.bat")
    if os.path.exists(default_path):
        return default_path
    python_scripts = os.path.join(USER_HOME, "AppData", "Local", "Programs", "Python", "Python312", "Scripts", "agentapi.bat")
    if os.path.exists(python_scripts):
        return python_scripts
    return "agentapi.bat"

AGENTAPI_BAT = find_agentapi_bat()

def ensure_git_exe():
    if shutil.which("git"):
        return "git"
    candidates = [
        os.path.join(USER_HOME, "AppData", "Local", "Microsoft", "WinGet", "Packages", "Git.MinGit_Microsoft.Winget.Source_8wekyb3d8bbwe", "cmd"),
        r"C:\Program Files\Git\cmd",
        r"C:\Program Files (x86)\Git\cmd",
    ]
    for c in candidates:
        if os.path.exists(os.path.join(c, "git.exe")):
            if c not in os.environ.get("PATH", ""):
                os.environ["PATH"] = c + os.pathsep + os.environ.get("PATH", "")
            return os.path.join(c, "git.exe")
    return "git"

ensure_git_exe()

# SSL context for local/remote calls
ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0
ANTIGRAVITY_EXE = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Antigravity", "Antigravity.exe")

class AntigravityWorker:
    def __init__(self, on_status_change=None, on_notification=None):
        self.server_url = SERVER_URL
        self.agentapi_path = AGENTAPI_BAT
        self.ls_address = None
        self.csrf_token = None
        self.ls_pid = None
        self.running = True
        self.current_job_id = None
        self.status = "initializing"
        self.status_detail = "Initializing worker..."
        self.on_status_change = on_status_change
        self.on_notification = on_notification

        # Identity & Device Pairing
        cfg = load_worker_config()
        self.machine_name = cfg.get("machine_name") or MACHINE_NAME
        self.user_name = cfg.get("user_name") or "Unlinked Workstation"
        self.user_email = cfg.get("user_email") or ""
        self.worker_id = cfg.get("worker_id") or f"{self.machine_name}_unlinked"
        self.install_path = cfg.get("install_path") or os.path.dirname(os.path.abspath(__file__))
        self.projects_root = cfg.get("projects_root") or get_canonical_projects_root()
        self.device_token = cfg.get("device_token")
        self.is_paired = cfg.get("paired", False)
        self.os_info = OS_PLATFORM_INFO

    def set_status(self, status, detail=""):
        self.status = status
        self.status_detail = detail
        if self.on_status_change:
            try:
                self.on_status_change(status, detail)
            except Exception:
                pass

    def notify(self, title, message):
        if self.on_notification:
            try:
                self.on_notification(title, message)
            except Exception:
                pass

    def is_connection_alive(self):
        """Quickly checks if current ls_address and csrf_token respond."""
        if not self.ls_address or not self.csrf_token:
            return False
        try:
            port = self.ls_address.split(":")[-1]
            url = f"http://127.0.0.1:{port}/"
            req = urllib.request.Request(url, headers={"X-CSRF-Token": self.csrf_token})
            with urllib.request.urlopen(req, timeout=1.2, context=ssl_ctx) as r:
                return r.status == 200
        except Exception:
            return False

    def ensure_active_connection(self):
        """Verifies active connection; if stale or dead, runs auto-discovery."""
        if self.is_connection_alive():
            return True
        print("[BRIDGE] Current connection dead or uninitialized. Re-discovering Antigravity engine...")
        return self.ensure_antigravity_running()

    def discover_language_server(self):
        """Scans running Windows processes for language_server.exe and probes active port."""
        print("[DISCOVERY] Scanning for active Google Antigravity language_server.exe...")
        ps_script = """
        $procs = Get-CimInstance Win32_Process -Filter "Name = 'language_server.exe'" | Sort-Object CreationDate -Descending
        if (-not $procs) { exit 1 }
        $results = @()
        foreach ($p in $procs) {
            $ports = Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort
            $results += @{
                pid = $p.ProcessId
                cmdline = $p.CommandLine
                ports = @($ports)
            }
        }
        $results | ConvertTo-Json -Compress
        """
        try:
            res = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps_script],
                capture_output=True, text=True, timeout=10, creationflags=CREATE_NO_WINDOW
            )
            if res.returncode != 0 or not res.stdout.strip():
                print("[DISCOVERY] language_server.exe is not currently running.")
                return False
            
            raw_data = json.loads(res.stdout)
            data_list = raw_data if isinstance(raw_data, list) else [raw_data]

            for info in data_list:
                cand_pid = info.get("pid")
                cmdline = info.get("cmdline", "")
                csrf_match = re.search(r'--csrf_token[=\s]+([a-f0-9\-]+)', cmdline)
                cand_csrf = csrf_match.group(1) if csrf_match else ""
                
                ports = info.get("ports", [])
                if isinstance(ports, int):
                    ports = [ports]
                
                for port in ports:
                    try:
                        url = f"http://127.0.0.1:{port}/"
                        req = urllib.request.Request(url, headers={"X-CSRF-Token": cand_csrf})
                        with urllib.request.urlopen(req, timeout=1.5, context=ssl_ctx) as r:
                            if r.status == 200:
                                self.ls_pid = cand_pid
                                self.csrf_token = cand_csrf
                                self.ls_address = f"localhost:{port}"
                                print(f"[DISCOVERY] Verified Antigravity Engine at {self.ls_address} (PID: {self.ls_pid})")
                                return True
                    except Exception:
                        pass
        except Exception as e:
            print(f"[DISCOVERY ERROR] {e}")
        
        return False

    def ensure_antigravity_running(self):
        """Checks if Antigravity language_server.exe is running. If not, auto-launches Antigravity.exe."""
        if self.discover_language_server():
            return True
        
        if os.path.exists(ANTIGRAVITY_EXE):
            print(f"[AUTO-LAUNCH] Antigravity not active. Launching from {ANTIGRAVITY_EXE}...")
            self.set_status("waiting", "Launching Antigravity IDE...")
            try:
                flags = (subprocess.DETACHED_PROCESS | CREATE_NO_WINDOW) if hasattr(subprocess, "DETACHED_PROCESS") else CREATE_NO_WINDOW
                subprocess.Popen([ANTIGRAVITY_EXE], creationflags=flags)
                for _ in range(8):
                    time.sleep(2)
                    if self.discover_language_server():
                        return True
            except Exception as e:
                print(f"[AUTO-LAUNCH ERROR] Could not start Antigravity: {e}")
        return False

    def ensure_project_config(self, project_name, project_path):
        """Ensures client workspace folder and ~/.gemini/config/projects/<id>.json exist with Turbo Mode."""
        import urllib.parse
        os.makedirs(project_path, exist_ok=True)
        os.makedirs(PROJECTS_CONFIG_DIR, exist_ok=True)

        norm_target = os.path.normpath(project_path).lower().replace("/", "\\")

        # 1. Check existing Antigravity configs by folder URI or name
        for fname in os.listdir(PROJECTS_CONFIG_DIR):
            if fname.endswith(".json"):
                fpath = os.path.join(PROJECTS_CONFIG_DIR, fname)
                try:
                    with open(fpath, "r", encoding="utf-8") as jf:
                        cfg = json.load(jf)
                        res_list = cfg.get("projectResources", {}).get("resources", [])
                        cfg_name = (cfg.get("name") or "").strip().lower()

                        matched = False
                        if cfg_name and cfg_name == project_name.strip().lower():
                            matched = True

                        if not matched:
                            for res in res_list:
                                if not res: continue
                                uri = res.get("folderUri") or (res.get("gitFolder") and res["gitFolder"].get("folderUri"))
                                if uri and uri.startswith("file:///"):
                                    raw = uri[8:]
                                    raw = urllib.parse.unquote(raw).lower().replace("/", "\\")
                                    if len(raw) > 1 and raw[1] == ":":
                                        raw = raw[0].upper() + raw[1:]
                                    if raw.lower() == norm_target:
                                        matched = True
                                        break

                        if matched:
                            # Update Turbo Mode & Auto-Approval flags if needed
                            changed = False
                            if cfg.get("name") != project_name and (len(project_name) > len(cfg.get("name") or "") or cfg.get("name") in ("J", "Client", "Lead")):
                                cfg["name"] = project_name
                                changed = True
                            settings = cfg.setdefault("settings", {})
                            if settings.get("autoExecutionPolicy") != "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER":
                                settings["autoExecutionPolicy"] = "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER"
                                changed = True
                            if settings.get("artifactReviewMode") != "ARTIFACT_REVIEW_MODE_TURBO":
                                settings["artifactReviewMode"] = "ARTIFACT_REVIEW_MODE_TURBO"
                                changed = True
                            if settings.get("internetPolicy") != "AGENT_SETTING_POLICY_ALLOW":
                                settings["internetPolicy"] = "AGENT_SETTING_POLICY_ALLOW"
                                changed = True
                            if settings.get("fileAccessPolicy") != "AGENT_SETTING_POLICY_ALLOW":
                                settings["fileAccessPolicy"] = "AGENT_SETTING_POLICY_ALLOW"
                                changed = True
                            
                            perm_grants = cfg.setdefault("permissionGrants", {}).setdefault("permissionGrants", {})
                            current_allow = perm_grants.get("allow", [])
                            needed_grants = ["read_url(*)", "mcp(*)", "command(python *)", "command(node *)", "command(powershell *)"]
                            for ng in needed_grants:
                                if ng not in current_allow:
                                    current_allow.append(ng)
                                    changed = True
                            perm_grants["allow"] = current_allow

                            if changed:
                                with open(fpath, "w", encoding="utf-8") as out_jf:
                                    json.dump(cfg, out_jf, indent=2)
                            return cfg.get("id")
                except Exception:
                    pass

        # 2. Create new project config with Turbo Mode & Auto-Permissions
        norm_path = os.path.normpath(project_path).replace("\\", "/")
        folder_uri_part = norm_path.replace(":", "%3A")
        if not folder_uri_part.startswith("/"):
            folder_uri_part = "/" + folder_uri_part
        folder_uri = f"file://{folder_uri_part}"

        new_proj_id = str(uuid.uuid4())
        config_data = {
            "id": new_proj_id,
            "name": project_name,
            "projectResources": {
                "resources": [
                    {
                        "folderUri": folder_uri
                    }
                ]
            },
            "permissionGrants": {
                "permissionGrants": {
                    "allow": [
                        "read_url(*)",
                        "mcp(*)",
                        "command(python *)",
                        "command(node *)",
                        "command(powershell *)"
                    ]
                }
            },
            "settings": {
                "fileAccessPolicy": "AGENT_SETTING_POLICY_ALLOW",
                "internetPolicy": "AGENT_SETTING_POLICY_ALLOW",
                "sandboxMode": False,
                "autoExecutionPolicy": "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER",
                "artifactReviewMode": "ARTIFACT_REVIEW_MODE_TURBO"
            },
            "isWorkspaceOnly": False
        }
        target_json = os.path.join(PROJECTS_CONFIG_DIR, f"{new_proj_id}.json")
        with open(target_json, "w", encoding="utf-8") as out_jf:
            json.dump(config_data, out_jf, indent=2)
        print(f"[CONFIG] Created Turbo Mode project config with Auto-Permissions: {target_json}")
        return new_proj_id

    def associate_conversation_with_project(self, conv_id, project_id, project_name, project_path, title=None):
        """Links conversation directly to its Antigravity Project so it displays under that project in Antigravity Manager sidebar."""
        if not conv_id:
            return
        import sqlite3

        norm_path = os.path.normpath(project_path).replace("\\", "/")
        uri_part = norm_path.replace(":", "%3A")
        if not uri_part.startswith("/"):
            uri_part = "/" + uri_part
        workspace_uri = f"file://{uri_part}"

        # 1. Update conversation_summaries.db
        db_path = os.path.join(USER_HOME, ".gemini", "antigravity", "conversation_summaries.db")
        if os.path.exists(db_path):
            try:
                conn = sqlite3.connect(db_path)
                c = conn.cursor()
                if title:
                    c.execute("""
                        UPDATE conversation_summaries
                        SET project_id = ?, workspace_uris = ?, title = ?
                        WHERE conversation_id = ?
                    """, (project_id or "", json.dumps([workspace_uri]), title, conv_id))
                else:
                    c.execute("""
                        UPDATE conversation_summaries
                        SET project_id = ?, workspace_uris = ?
                        WHERE conversation_id = ?
                    """, (project_id or "", json.dumps([workspace_uri]), conv_id))
                conn.commit()
                conn.close()
                print(f"[ANTIGRAVITY SYNC] Pinned conversation {conv_id} under project '{project_name}' ({project_id})")
            except Exception as e:
                print(f"[ANTIGRAVITY SYNC ERROR] {e}")

        # 2. Update conversations/<conv_id>.db trajectory_metadata_blob if exists
        conv_db = os.path.join(USER_HOME, ".gemini", "antigravity", "conversations", f"{conv_id}.db")
        if os.path.exists(conv_db) and project_id:
            try:
                conn = sqlite3.connect(conv_db)
                c = conn.cursor()
                c.execute("SELECT id, data FROM trajectory_metadata_blob WHERE id = 'main'")
                row = c.fetchone()
                if row and row[1]:
                    blob_bytes = row[1]
                    blob_str = blob_bytes.decode("latin1")
                    m = re.search(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})", blob_str[-100:])
                    if m:
                        old_id = m.group(1)
                        if old_id != project_id:
                            new_str = blob_str[:-100] + blob_str[-100:].replace(old_id, project_id)
                            c.execute("UPDATE trajectory_metadata_blob SET data = ? WHERE id = 'main'", (new_str.encode("latin1"),))
                            conn.commit()
                conn.close()
            except Exception:
                pass

    def get_all_local_projects(self):
        """Scans Antigravity Manager projects, ordering them by recency in Antigravity Manager sidebar."""
        import urllib.parse
        import sqlite3
        projects = []
        seen_paths = set()
        seen_ids = set()

        # 1. Projects active in Antigravity Manager (from conversation_summaries.db)
        active_project_order = {}
        db_path = os.path.join(USER_HOME, ".gemini", "antigravity", "conversation_summaries.db")
        if os.path.exists(db_path):
            try:
                conn = sqlite3.connect(db_path)
                c = conn.cursor()
                c.execute("""
                    SELECT project_id, MAX(last_modified_time) as last_active
                    FROM conversation_summaries
                    WHERE project_id != '' AND project_id != 'outside-of-project'
                    GROUP BY project_id
                    ORDER BY last_active DESC
                """)
                for idx, (pid, last_active) in enumerate(c.fetchall()):
                    active_project_order[pid] = idx
                conn.close()
            except Exception:
                pass

        # 2. ~/.gemini/config/projects/*.json (primary Antigravity configs)
        if os.path.exists(PROJECTS_CONFIG_DIR):
            for fname in os.listdir(PROJECTS_CONFIG_DIR):
                if fname.endswith(".json"):
                    p = os.path.join(PROJECTS_CONFIG_DIR, fname)
                    try:
                        with open(p, "r", encoding="utf-8") as f:
                            data = json.load(f)
                            name = data.get("name")
                            pid = data.get("id")
                            if not name or name == "Outside of Project":
                                continue

                            res_list = data.get("projectResources", {}).get("resources", [])
                            for r in res_list:
                                if not r: continue
                                uri = r.get("folderUri") or (r.get("gitFolder") and r["gitFolder"].get("folderUri"))
                                if uri and uri.startswith("file:///"):
                                    raw = uri[8:]
                                    raw = urllib.parse.unquote(raw)
                                    path = raw.replace("/", "\\")
                                    if len(path) > 1 and path[1] == ":":
                                        path = path[0].upper() + path[1:]
                                    if path and os.path.exists(path) and path.lower() not in seen_paths:
                                        seen_paths.add(path.lower())
                                        seen_ids.add(pid)
                                        projects.append({
                                            "name": name,
                                            "path": path,
                                            "id": pid,
                                            "is_antigravity": True,
                                            "active_rank": active_project_order.get(pid, 999)
                                        })
                    except Exception:
                        pass

        # 3. Client Projects directory (Canonical OS-Agnostic Projects Directory)
        cons_dir = get_canonical_projects_root()
        if os.path.exists(cons_dir):
            for item in os.listdir(cons_dir):
                full = os.path.join(cons_dir, item)
                if os.path.isdir(full) and full.lower() not in seen_paths:
                    seen_paths.add(full.lower())
                    projects.append({
                        "name": item,
                        "path": full,
                        "id": None,
                        "is_antigravity": False,
                        "active_rank": 1000
                    })

        # Sort: active in Antigravity first (ordered as seen in Antigravity Manager), then others alphabetically
        projects.sort(key=lambda x: (x["active_rank"], (x["name"] or "").lower()))

        # Inspect and attach zero7.json manifest metadata to all discovered projects
        for p in projects:
            m_path = os.path.join(p["path"], "zero7.json")
            if os.path.exists(m_path):
                try:
                    with open(m_path, "r", encoding="utf-8") as jf:
                        m_data = json.load(jf)
                        p["lead_id"] = m_data.get("lead_id")
                        p["client_slug"] = m_data.get("client_slug")
                        p["business_name"] = m_data.get("business_name")
                except Exception:
                    pass

        return projects

    def get_all_project_conversations(self):
        """Scans conversation_summaries.db for top-level conversations, grouped by project ID, project name, and paths."""
        import sqlite3
        import urllib.parse
        db_path = os.path.join(USER_HOME, ".gemini", "antigravity", "conversation_summaries.db")
        if not os.path.exists(db_path):
            return {"by_project_id": {}, "by_project_name": {}}

        try:
            conn = sqlite3.connect(db_path)
            c = conn.cursor()
            c.execute("""
                SELECT conversation_id, project_id, title, preview, step_count, last_modified_time, workspace_uris
                FROM conversation_summaries
                WHERE (parent_conversation_id = '' OR parent_conversation_id IS NULL)
                  AND nesting_depth = 0
                ORDER BY last_modified_time DESC
            """)
            rows = c.fetchall()
            conn.close()

            by_project_id = {}
            by_project_name = {}

            # Also build a project ID -> project name mapping from config files
            proj_id_to_name = {}
            if os.path.exists(PROJECTS_CONFIG_DIR):
                for fname in os.listdir(PROJECTS_CONFIG_DIR):
                    if fname.endswith(".json"):
                        try:
                            with open(os.path.join(PROJECTS_CONFIG_DIR, fname), "r", encoding="utf-8") as f:
                                d = json.load(f)
                                if d.get("id") and d.get("name"):
                                    proj_id_to_name[d["id"]] = d["name"].lower().strip()
                        except Exception:
                            pass

            for cid, pid, title, preview, steps, last_mod, uris_raw in rows:
                display_title = (title or preview or "Untitled Conversation").strip()
                last_mod_str = str(last_mod) if last_mod else ""
                
                # Workspace paths
                workspace_paths = []
                folder_names = []
                if uris_raw:
                    try:
                        parsed_uris = json.loads(uris_raw)
                        for u in parsed_uris:
                            if u and u.startswith("file:///"):
                                raw_p = urllib.parse.unquote(u[8:]).replace("/", "\\")
                                if len(raw_p) > 1 and raw_p[1] == ":":
                                    raw_p = raw_p[0].upper() + raw_p[1:]
                                workspace_paths.append(raw_p)
                                folder_names.append(os.path.basename(raw_p).lower())
                    except Exception:
                        pass

                conv_item = {
                    "id": cid,
                    "project_id": pid or "",
                    "title": display_title,
                    "step_count": steps or 0,
                    "last_modified": last_mod_str,
                    "workspace_paths": workspace_paths
                }

                # Index by project_id
                if pid:
                    by_project_id.setdefault(pid, []).append(conv_item)

                # Index by project name (from config or folder name)
                pname = proj_id_to_name.get(pid)
                if pname:
                    by_project_name.setdefault(pname, []).append(conv_item)
                for fn in folder_names:
                    if fn and fn != pname:
                        by_project_name.setdefault(fn, []).append(conv_item)

            return {
                "by_project_id": by_project_id,
                "by_project_name": by_project_name
            }
        except Exception as e:
            print(f"[CONVERSATION SYNC ERROR] {e}")
            return {"by_project_id": {}, "by_project_name": {}}

    def get_conversation_transcript(self, conv_id, max_messages=100):
        """Reads transcript_full.jsonl or transcript.jsonl and extracts formatted dialogue turns."""
        full_path = os.path.join(BRAIN_DIR, conv_id, ".system_generated", "logs", "transcript_full.jsonl")
        compact_path = os.path.join(BRAIN_DIR, conv_id, ".system_generated", "logs", "transcript.jsonl")
        path = full_path if os.path.exists(full_path) else (compact_path if os.path.exists(compact_path) else None)
        if not path:
            return []

        messages = []
        current_thought = []
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    if not line.strip():
                        continue
                    try:
                        step = json.loads(line)
                        stype = step.get("type")
                        scontent = step.get("content") or ""
                        sthink = step.get("thinking") or ""
                        created = step.get("created_at")
                        stools = step.get("tool_calls") or []

                        if sthink:
                            current_thought.append(sthink)
                        if stools:
                            for t in stools:
                                if isinstance(t, dict):
                                    tname = t.get("name") or t.get("toolAction") or t.get("toolSummary") or "tool"
                                    current_thought.append(f"⚡ [{tname}]")

                        if stype == "USER_INPUT" and scontent:
                            m = re.search(r"<USER_REQUEST>(.*?)</USER_REQUEST>", scontent, re.DOTALL)
                            clean = m.group(1).strip() if m else scontent.strip()
                            clean = re.sub(r"You are the Zero7.*?Target Client Project Directory.*?\n\nUser Instruction:\n", "", clean, flags=re.DOTALL)
                            messages.append({
                                "role": "user",
                                "content": clean.strip(),
                                "created_at": created
                            })
                            current_thought = []
                        elif stype == "PLANNER_RESPONSE" and scontent.strip():
                            thoughts_text = "\n\n".join(current_thought).strip()
                            messages.append({
                                "role": "assistant",
                                "content": scontent.strip(),
                                "thoughts": thoughts_text,
                                "created_at": created
                            })
                            current_thought = []
                    except Exception:
                        pass
            return messages[-max_messages:]
        except Exception as e:
            print(f"[TRANSCRIPT ERROR] {e}")
            return []

    def upload_conversation_transcript(self, conv_id, messages, project_id=None):
        """Uploads dialogue turns of a conversation to Cloud CRM cache."""
        url = f"{self.server_url}/api/agent/worker/conversations/{conv_id}/transcript"
        payload = {
            "conversation_id": conv_id,
            "project_id": project_id or "",
            "messages": messages
        }
        try:
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as r:
                return r.status == 200
        except Exception as e:
            print(f"[UPLOAD ERROR] Could not sync transcript for {conv_id}: {e}")
            return False

    def create_new_project(self, project_name, project_path=None):
        """Creates a new Antigravity project directory and config."""
        if not project_path:
            project_path = os.path.join(USER_HOME, "Desktop", "zero7 Consultancy", "Projects", project_name)
        proj_id = self.ensure_project_config(project_name, project_path)
        print(f"[PROJECT CREATED] '{project_name}' ({proj_id}) at {project_path}")
        return proj_id

    def handle_worker_command(self, cmd):
        """Executes administrative or sync commands queued by Cloud CRM."""
        if not cmd:
            return
        ctype = cmd.get("type")
        print(f"[COMMAND] Received worker command: {ctype}")
        try:
            if ctype == "get_transcript":
                cid = cmd.get("conversation_id")
                if cid:
                    msgs = self.get_conversation_transcript(cid)
                    self.upload_conversation_transcript(cid, msgs)
                    print(f"[COMMAND] Synced {len(msgs)} messages for {cid}")
            elif ctype == "create_project":
                pname = cmd.get("name")
                ppath = cmd.get("path")
                if pname:
                    self.create_new_project(pname, ppath)
                    # Trigger immediate heartbeat to broadcast new project
                    self.send_heartbeat()
        except Exception as e:
            print(f"[COMMAND ERROR] {e}")

    def send_heartbeat(self):
        """Sends periodic heartbeat to Cloud CRM with active projects and conversations."""
        if not self.user_email or self.user_email.lower() in ("unassigned", "m_hit@zero7.space", "unknown@zero7.space"):
            # Workstation is not paired with a verified CRM user account
            return False

        url = f"{self.server_url}/api/agent/worker/heartbeat"
        projects_list = self.get_all_local_projects()
        conversations_map = self.get_all_project_conversations()
        payload = {
            "worker_id": self.worker_id,
            "machine_name": self.machine_name,
            "user_email": self.user_email,
            "user_name": self.user_name,
            "os_info": self.os_info,
            "install_path": getattr(self, "install_path", None),
            "projects_root": getattr(self, "projects_root", None),
            "device_token": getattr(self, "device_token", None),
            "metadata": {
                "ls_address": self.ls_address,
                "pid": self.ls_pid,
                "status": "busy" if self.current_job_id else "ready",
                "turbo_mode": True,
                "current_job": self.current_job_id,
                "install_path": getattr(self, "install_path", None),
                "projects_root": getattr(self, "projects_root", None),
                "projects": projects_list,
                "conversations": conversations_map
            }
        }
        try:
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=8, context=ssl_ctx) as r:
                return r.status == 200
        except Exception as e:
            return False

    def heartbeat_worker(self):
        """Heartbeat loop running in background thread."""
        while self.running:
            try:
                if not self.is_connection_alive():
                    self.discover_language_server()
                if self.ls_address:
                    self.send_heartbeat()
            except Exception:
                pass
            time.sleep(HEARTBEAT_INTERVAL_SECS)

    def poll_for_job(self):
        """Polls Cloud CRM for next pending agent job or worker command."""
        url = f"{self.server_url}/api/agent/worker/poll"
        try:
            req = urllib.request.Request(url, data=b"{}", headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=5, context=ssl_ctx) as r:
                res = json.loads(r.read().decode("utf-8"))
                if res.get("command"):
                    self.handle_worker_command(res["command"])
                return res.get("job")
        except Exception:
            return None

    def stream_update(self, job_id, stream_output, thoughts, conversation_id):
        """Posts incremental stream output back to CRM."""
        url = f"{self.server_url}/api/agent/worker/jobs/{job_id}/stream"
        payload = {
            "stream_output": stream_output,
            "thoughts": thoughts,
            "conversation_id": conversation_id
        }
        try:
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=5, context=ssl_ctx) as r:
                pass
        except Exception as e:
            print(f"[STREAM ERROR] {e}")

    def complete_job(self, job_id, status, stream_output, thoughts, conversation_id, artifacts=None, error_message=None):
        """Notifies CRM that the job is finished or failed."""
        url = f"{self.server_url}/api/agent/worker/jobs/{job_id}/complete"
        payload = {
            "status": status,
            "stream_output": stream_output,
            "thoughts": thoughts,
            "conversation_id": conversation_id,
            "artifacts": artifacts or [],
            "error_message": error_message
        }
        try:
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=8, context=ssl_ctx) as r:
                print(f"[JOB COMPLETE] Job {job_id} marked as {status}")
        except Exception as e:
            print(f"[COMPLETE ERROR] {e}")

    def sync_client_vault(self, job, conv_id, project_path, accumulated_output, thoughts_str):
        """
        Implements the 'Agent Workshop + Client Vault' synchronization pattern.
        Ensures the client folder on disk:
          C:\\Users\\m_hit\\Desktop\\zero7 Consultancy\\Projects\\<Client_Slug>\\
        contains 4 subdirectories:
          - context/
          - raw_files/
          - prototypes/
          - conversations/
        1. Exports human-readable Markdown transcript into conversations/{job_id}_{agent_slug}_transcript.md.
        2. Detects any HTML prototype generated (either files on disk or ```html blocks in output),
           saves them to prototypes/v{N}_{slug}.html and prototypes/index.html,
           and publishes to Cloud CRM via POST /api/leads/{id}/publish-prototype.
        3. Detects any staged actions in the response (e.g. [ACTION: ...]) and registers them in CRM.
        4. Updates context/with a summary of latest deliverables.
        5. Returns an updated artifacts list for the job.
        """
        artifacts = []
        if not project_path:
            return artifacts

        client_name = job.get("project_name") or os.path.basename(project_path) or "Client"
        agent_slug = job.get("agent_slug") or job.get("role") or "prototype_maker"
        job_id = job.get("id") or "job"
        lead_id = job.get("lead_id")

        # 1. Ensure 4 subdirectories in Client Vault
        context_dir = os.path.join(project_path, "context")
        raw_files_dir = os.path.join(project_path, "raw_files")
        prototypes_dir = os.path.join(project_path, "prototypes")
        conversations_dir = os.path.join(project_path, "conversations")

        for d in [context_dir, raw_files_dir, prototypes_dir, conversations_dir]:
            os.makedirs(d, exist_ok=True)

        # 2. Export Human-Readable Markdown Transcript
        if conv_id:
            try:
                msgs = self.get_conversation_transcript(conv_id)
                clean_agent_title = agent_slug.replace("_", " ").title()
                ts = time.strftime('%Y-%m-%d %H:%M:%S')
                md_content = [
                    f"# Conversation Transcript: {clean_agent_title}",
                    f"- **Client / Project**: {client_name}",
                    f"- **Job ID**: `{job_id}`",
                    f"- **Conversation ID**: `{conv_id}`",
                    f"- **Date**: {ts}",
                    f"- **Engine**: Google Antigravity Local",
                    "",
                    "---",
                    "",
                    "### Dialogue History",
                    ""
                ]
                for m in msgs:
                    role_icon = "👤 **User**" if m.get("role") == "user" else f"🤖 **{clean_agent_title}**"
                    md_content.append(f"#### {role_icon} *({m.get('created_at', '')})*")
                    if m.get("thoughts"):
                        md_content.append(f"> **Reasoning & Tool Calls:**\n> {m['thoughts'].replace(chr(10), chr(10) + '> ')}\n")
                    md_content.append(f"{m.get('content', '')}\n")
                    md_content.append("---\n")

                ts_prefix = time.strftime('%Y-%m-%d_%H%M%S')
                transcript_name = f"{ts_prefix}_{agent_slug}_transcript.md"
                transcript_path = os.path.join(conversations_dir, transcript_name)
                with open(transcript_path, "w", encoding="utf-8") as tf:
                    tf.write("\n".join(md_content))
                print(f"[VAULT SYNC] Saved human-readable transcript: {transcript_path}")
                artifacts.append({
                    "name": transcript_name,
                    "path": transcript_path,
                    "size": os.path.getsize(transcript_path),
                    "type": "conversation_transcript"
                })
            except Exception as e:
                print(f"[VAULT SYNC ERROR] Could not save transcript: {e}")

        # 3. Detect and Version HTML Prototypes
        html_content = ""
        # Option A: Check files in project_path or prototypes_dir
        for cand_dir in [prototypes_dir, project_path]:
            if os.path.exists(cand_dir):
                for f in os.listdir(cand_dir):
                    if f.endswith(".html") and not f.startswith("v"):
                        try:
                            with open(os.path.join(cand_dir, f), "r", encoding="utf-8") as hf:
                                content = hf.read()
                                if "<html" in content.lower() or "<!doctype html" in content.lower():
                                    html_content = content
                                    break
                        except Exception:
                            pass
            if html_content:
                break

        # Option B: Extract from accumulated_output markdown
        if not html_content and accumulated_output:
            html_match = re.search(r"```html\s*(<!DOCTYPE html.*?)```", accumulated_output, re.DOTALL | re.IGNORECASE)
            if not html_match:
                html_match = re.search(r"(<!DOCTYPE html.*?>.*?</html>)", accumulated_output, re.DOTALL | re.IGNORECASE)
            if not html_match:
                html_match = re.search(r"(<html.*?>.*?</html>)", accumulated_output, re.DOTALL | re.IGNORECASE)
            if html_match:
                html_content = html_match.group(1).strip()

        if html_content:
            try:
                existing_versions = [f for f in os.listdir(prototypes_dir) if f.startswith("v") and f.endswith(".html")]
                version = len(existing_versions) + 1
                proto_filename = f"v{version}_{agent_slug}.html"
                proto_file_path = os.path.join(prototypes_dir, proto_filename)
                with open(proto_file_path, "w", encoding="utf-8") as pf:
                    pf.write(html_content)
                # Also update index.html in prototypes and root
                with open(os.path.join(prototypes_dir, "index.html"), "w", encoding="utf-8") as pf:
                    pf.write(html_content)
                with open(os.path.join(project_path, "index.html"), "w", encoding="utf-8") as pf:
                    pf.write(html_content)

                print(f"[VAULT SYNC] Saved prototype v{version}: {proto_file_path}")
                artifacts.append({
                    "name": proto_filename,
                    "path": proto_file_path,
                    "size": len(html_content),
                    "type": "prototype_html"
                })

                # Publish directly to Cloud CRM
                if lead_id:
                    pub_url = f"{self.server_url}/api/leads/{lead_id}/publish-prototype"
                    pub_payload = {
                        "title": f"{client_name} Prototype (v{version})",
                        "description": f"Generated by {agent_slug.replace('_', ' ').title()}",
                        "html_content": html_content
                    }
                    try:
                        pdata = json.dumps(pub_payload).encode("utf-8")
                        preq = urllib.request.Request(pub_url, data=pdata, headers={"Content-Type": "application/json"})
                        with urllib.request.urlopen(preq, timeout=8, context=ssl_ctx) as pr:
                            if pr.status == 200:
                                res_j = json.loads(pr.read().decode("utf-8"))
                                print(f"[VAULT SYNC] Published prototype to CRM: {res_j.get('public_url')}")
                    except Exception as pe:
                        print(f"[VAULT SYNC ERROR] Could not publish prototype to CRM: {pe}")
            except Exception as pe:
                print(f"[VAULT SYNC ERROR] Could not save prototype: {pe}")

        # 4. Detect and Stage Actions for Human Approval
        if accumulated_output:
            action_match = re.search(r"\[ACTION:\s*([A-Z_]+)\]\s*(\{.*?\})", accumulated_output, re.DOTALL)
            if action_match:
                act_type = action_match.group(1).lower()
                try:
                    payload_json = json.loads(action_match.group(2))
                    stage_url = f"{self.server_url}/api/actions"
                    stage_payload = {
                        "lead_id": lead_id,
                        "agent_slug": agent_slug,
                        "action_type": act_type,
                        "payload": payload_json
                    }
                    sdata = json.dumps(stage_payload).encode("utf-8")
                    sreq = urllib.request.Request(stage_url, data=sdata, headers={"Content-Type": "application/json"})
                    with urllib.request.urlopen(sreq, timeout=5, context=ssl_ctx) as sr:
                        if sr.status == 200:
                            print(f"[ACTION QUEUE] Staged high-stakes action '{act_type}' for human approval!")
                except Exception as ae:
                    print(f"[ACTION QUEUE ERROR] Could not stage action: {ae}")

        # 5. Scan remaining files in project_path for artifacts list
        try:
            for fname in os.listdir(project_path):
                fpath = os.path.join(project_path, fname)
                if os.path.isfile(fpath) and fname not in [a["name"] for a in artifacts]:
                    artifacts.append({
                        "name": fname,
                        "path": fpath,
                        "size": os.path.getsize(fpath),
                        "type": "file"
                    })
        except Exception:
            pass

        # 6. Auto-Git Commit & Push of Deliverables and Transcripts
        git_target = project_path
        if not os.path.exists(os.path.join(project_path, ".git")) and os.path.exists(os.path.join(project_path, "Project", ".git")):
            git_target = os.path.join(project_path, "Project")

        git_dir = os.path.join(git_target, ".git")
        if os.path.exists(git_dir):
            try:
                git_env = os.environ.copy()
                git_env["GIT_TERMINAL_PROMPT"] = "0"

                # Pre-fetch & rebase to absorb any remote changes from Cloud AI Gateway or other founders
                pull_res = subprocess.run(
                    ["git", "pull", "--rebase", "origin", "main"],
                    cwd=git_target, env=git_env, capture_output=True, text=True, timeout=20, creationflags=CREATE_NO_WINDOW
                )
                if pull_res.returncode != 0:
                    # If rebase encountered conflicts, abort cleanly and do theirs-merge fallback
                    subprocess.run(["git", "rebase", "--abort"], cwd=git_target, env=git_env, capture_output=True, timeout=10, creationflags=CREATE_NO_WINDOW)
                    subprocess.run(["git", "pull", "-X", "theirs", "origin", "main", "--no-edit"], cwd=git_target, env=git_env, capture_output=True, timeout=20, creationflags=CREATE_NO_WINDOW)

                commit_ts = time.strftime('%Y-%m-%d %H:%M:%S')
                commit_msg = f"agent({agent_slug}): completed {job_id} [{commit_ts}]"
                subprocess.run(["git", "add", "-A"], cwd=git_target, env=git_env, capture_output=True, timeout=10, creationflags=CREATE_NO_WINDOW)
                res_c = subprocess.run(["git", "commit", "-m", commit_msg], cwd=git_target, env=git_env, capture_output=True, text=True, timeout=10, creationflags=CREATE_NO_WINDOW)
                if res_c.returncode == 0:
                    print(f"[GIT SYNC] Committed deliverables to local git repo: {commit_msg}")
                    # Push local branch to origin main
                    res_p = subprocess.run(["git", "push", "origin", "main"], cwd=git_target, env=git_env, capture_output=True, text=True, timeout=25, creationflags=CREATE_NO_WINDOW)
                    if res_p.returncode == 0:
                        print(f"[GIT SYNC] Successfully pushed deliverables to GitHub remote!")
                    else:
                        print(f"[GIT SYNC WARNING] Push warning/error: {res_p.stderr or res_p.stdout}")
            except Exception as ge:
                print(f"[GIT SYNC ERROR] {ge}")

        # 7. Notify CRM Server of refreshed workspace file list for instant @ autocomplete
        lead_id = job.get("lead_id")
        if lead_id:
            try:
                scanned = []
                for root, dirs, files in os.walk(project_path):
                    dirs[:] = [d for d in dirs if d not in {'.git', 'node_modules', '.next', '.vercel', '__pycache__', '.venv', 'dist', 'build'} and not d.startswith('.')]
                    rel_dir = os.path.relpath(root, project_path)
                    depth = 0 if rel_dir == '.' else len(rel_dir.split(os.sep))
                    if depth > 4:
                        dirs.clear()
                        continue
                    for f in files:
                        ext = os.path.splitext(f)[1].lower()
                        if ext in {'.exe', '.dll', '.bin', '.pyc', '.woff', '.woff2'} or f.startswith('.'):
                            continue
                        f_full = os.path.join(root, f)
                        rel_f = os.path.relpath(f_full, project_path).replace('\\', '/')
                        f_size = os.path.getsize(f_full)
                        size_fmt = f"{round(f_size/1024, 1)} KB" if f_size < 1024*1024 else f"{round(f_size/(1024*1024), 1)} MB"
                        badge = (ext.lstrip('.').upper() or 'FILE')[:5]
                        folder = os.path.dirname(rel_f) or 'root'
                        scanned.append({
                            "tag": f"@file:{rel_f}",
                            "label": f,
                            "path": rel_f,
                            "size": f_size,
                            "size_fmt": size_fmt,
                            "category": "Repository File",
                            "ext": ext,
                            "badge": badge,
                            "desc": f"{folder}/ • {size_fmt}",
                            "insert": f"@file:{rel_f} ",
                            "source": "workspace"
                        })
                if scanned:
                    sync_url = f"{self.server_url}/api/leads/{lead_id}/vault-files/sync"
                    payload = {"files": scanned}
                    req = urllib.request.Request(sync_url, data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
                    with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
                        print(f"[VAULT SYNC] Refreshed CRM cache with {len(scanned)} workspace files")
            except Exception as se:
                print(f"[VAULT SYNC WARNING] {se}")

        return artifacts

    def execute_job(self, job):
        """Runs the agent task using Antigravity engine and tails live transcript."""
        job_id = job["id"]
        self.current_job_id = job_id
        client_name = job.get("project_name") or "Client"
        # Resolve client project path locally on this host machine (machine-independent)
        local_base = get_canonical_projects_root()
        clean_slug = re.sub(r'[^a-zA-Z0-9_\-\s]', '', client_name.lower())
        safe_slug = re.sub(r'[\s_\-]+', '-', clean_slug).strip('-') or "client"
        client_dir_name = safe_slug if safe_slug.startswith("client-") else f"client-{safe_slug}"

        provided_path = job.get("project_path")
        if provided_path and os.path.isabs(provided_path) and os.path.exists(provided_path):
            project_path = provided_path
        else:
            cand_1 = os.path.join(local_base, client_dir_name)
            cand_2 = os.path.join(local_base, client_name)
            cand_3 = os.path.join(local_base, safe_slug)
            if os.path.exists(cand_1):
                project_path = cand_1
            elif os.path.exists(cand_2):
                project_path = cand_2
            elif os.path.exists(cand_3):
                project_path = cand_3
            else:
                project_path = cand_1
        os.makedirs(project_path, exist_ok=True)

        # Pull latest changes from remote Git before running agent task
        git_target = project_path
        if not os.path.exists(os.path.join(project_path, ".git")) and os.path.exists(os.path.join(project_path, "Project", ".git")):
            git_target = os.path.join(project_path, "Project")
        if os.path.exists(os.path.join(git_target, ".git")):
            try:
                git_env = os.environ.copy()
                git_env["GIT_TERMINAL_PROMPT"] = "0"
                pull_res = subprocess.run(
                    ["git", "pull", "--rebase", "origin", "main"],
                    cwd=git_target, env=git_env, capture_output=True, text=True, timeout=15, creationflags=CREATE_NO_WINDOW
                )
                if pull_res.returncode != 0:
                    subprocess.run(["git", "rebase", "--abort"], cwd=git_target, env=git_env, capture_output=True, timeout=10, creationflags=CREATE_NO_WINDOW)
            except Exception as pe:
                print(f"[GIT PRE-PULL WARNING] {pe}")

        conv_id = job.get("conversation_id")
        user_prompt = job.get("prompt", "").strip()
        raw_model = (job.get("model") or "flash").lower().strip()
        if "lite" in raw_model:
            model = "flash_lite"
            model_display = "Antigravity Flash Lite (flash_lite)"
        elif "claude" in raw_model:
            model = "pro"
            model_display = f"Antigravity Claude Route ({raw_model})"
        elif "pro" in raw_model:
            model = "pro"
            model_display = "Antigravity Pro (pro)"
        else:
            model = "flash"
            model_display = "Antigravity Flash (flash)"

        role = (job.get("role") or "engineer").lower().strip()
        agent_slug = job.get("agent_slug") or job.get("role") or "prototype_maker"
        self.set_status("busy", f"Executing {agent_slug} for {client_name}")
        role_personas = {
            "engineer": f"You are the Zero7 Lead Full-Stack Engineer working on client '{client_name}'. Target workspace: '{project_path}'. Focus on robust production code, backend architecture, clean frontend components, and executable solutions.",
            "sow": f"You are the Zero7 Solutions Architect & Consultant working on client '{client_name}'. Target workspace: '{project_path}'. Focus on drafting comprehensive client Scope of Work (SOW), milestones, deliverables, pricing, and project roadmap.",
            "researcher": f"You are the Zero7 Senior Market & Competitor Analyst working on client '{client_name}'. Target workspace: '{project_path}'. Focus on deep competitor teardowns, market benchmarking, and AI automation opportunities.",
            "prototype": f"You are the Zero7 Rapid Prototyping Specialist working on client '{client_name}'. Target workspace: '{project_path}'. Focus on designing and creating responsive web prototypes, user flows, and interactive mockups.",
            "prototype_maker": f"You are Zero7's Principal Prototype Architect working on client '{client_name}'. Target workspace: '{project_path}'. Build high-fidelity, single-file responsive Tailwind HTML mockups, provision live subdomains, and draft conversion-focused WhatsApp hooks.",
            "lead_researcher": f"You are Zero7's Senior Enterprise Solutions Strategist working on client '{client_name}'. Target workspace: '{project_path}'. Map operational bottlenecks, architect custom software solutions, and estimate budget tiers in INR.",
            "whatsapp_nudge": f"You are Zero7's AI Client Relationship Manager working on client '{client_name}'. Target workspace: '{project_path}'. Draft concise, highly contextual WhatsApp follow-ups and nudges referencing specific call points and deliverables."
        }
        role_context = role_personas.get(agent_slug, role_personas.get(role, role_personas["engineer"]))

        print(f"\n========================================================")
        print(f"[EXECUTE] Running Job {job_id} for '{client_name}' ({agent_slug})")
        print(f"[TARGET WORKSPACE] {project_path}")
        print(f"[MODEL] {model_display} (tier: {model})")
        print(f"[ROLE] {role.upper()}")
        print(f"========================================================")

        # 1. Provision project workspace & config
        proj_id = job.get("project_id") or self.ensure_project_config(client_name, project_path)

        # 2. Build scoped prompt (with Sales Rep Tactical Briefing if present)
        rep_ctx = job.get("rep_context") or {}
        rep_ctx_text = ""
        if isinstance(rep_ctx, dict) and any(rep_ctx.values()):
            screens = rep_ctx.get("key_screens", [])
            screens_str = ", ".join(screens) if isinstance(screens, list) else str(screens)
            rep_ctx_text = (
                f"\n--- SALES REP TACTICAL PROTOTYPE BRIEFING ---\n"
                f"- Primary Workflow to Showcase: {rep_ctx.get('primary_workflow', 'Core Operational Flow')}\n"
                f"- Critical Required Screens / Features: {screens_str}\n"
                f"- Rep Tactical Notes / Closing Hook: {rep_ctx.get('tactical_notes', 'N/A')}\n"
                f"- Target Viewport: {rep_ctx.get('target_viewport', 'Desktop & Mobile')}\n"
                f"- Visual Style: {rep_ctx.get('visual_style', 'Zero7 Dark Modern')}\n"
                f"----------------------------------------------\n\n"
            )

        scoped_prompt = (
            f"{role_context}\n"
            f"Target Client Project Directory: '{project_path}'.\n"
            f"All code, files, deliverables, and analysis for this client MUST be saved inside '{project_path}'.\n\n"
            f"{rep_ctx_text}"
            f"User Instruction:\n{user_prompt}"
        )

        # Resolve any attached @file: or @shorthand file pills from local disk
        file_tokens = set(re.findall(r'@file:([a-zA-Z0-9_\-./]+)', user_prompt) + re.findall(r'@([a-zA-Z0-9_\-./]+\.(?:md|csv|html|json|py|txt|sql|ts|tsx|js|jsx))', user_prompt))
        if file_tokens:
            file_blocks = []
            for fref in file_tokens:
                fref_clean = fref.strip().lstrip('/')
                cand_paths = [
                    os.path.join(project_path, fref_clean.replace('/', os.sep)),
                    os.path.join(project_path, "Project", fref_clean.replace('/', os.sep)),
                    os.path.join(project_path, "raw_files", fref_clean.replace('/', os.sep)),
                ]
                abs_f = next((p for p in cand_paths if os.path.exists(p) and os.path.isfile(p)), None)
                if abs_f:
                    ext = os.path.splitext(abs_f)[1].lower()
                    try:
                        with open(abs_f, "r", encoding="utf-8", errors="replace") as ff:
                            f_content = ff.read(51200)
                        file_blocks.append(f"### Attached Vault File: {fref_clean}\n```{ext.lstrip('.') or 'text'}\n{f_content}\n```")
                    except Exception:
                        pass
            if file_blocks:
                scoped_prompt += "\n\n=== ATTACHED VAULT FILES ===\n" + "\n\n".join(file_blocks)

        env = os.environ.copy()
        # Strictly scrub all parent conversation variables so Antigravity never treats this as a COS Theta subagent
        for k in list(env.keys()):
            if "ANTIGRAVITY" in k:
                del env[k]
        if proj_id:
            env["ANTIGRAVITY_PROJECT_ID"] = proj_id

        # Verify active connection before invoking agentapi!
        if not self.ensure_active_connection():
            raise RuntimeError("Google Antigravity language_server is not reachable on localhost.")

        env["ANTIGRAVITY_LS_ADDRESS"] = self.ls_address
        env["ANTIGRAVITY_CSRF_TOKEN"] = self.csrf_token

        # 3. Spawn or Resume Conversation
        transcript_path_cand = os.path.join(BRAIN_DIR, conv_id, ".system_generated", "logs", "transcript.jsonl") if conv_id else None
        conversation_exists = conv_id and transcript_path_cand and os.path.exists(transcript_path_cand)
        
        clean_title = f"{client_name}: {user_prompt[:40]}".strip()
        start_line_count = 0
        if conversation_exists:
            try:
                with open(transcript_path_cand, "r", encoding="utf-8") as f:
                    start_line_count = sum(1 for line in f if line.strip())
            except Exception:
                start_line_count = 0
            print(f"[AGENT] Resuming conversation {conv_id} (existing steps: {start_line_count})...")
            cmd = [self.agentapi_path, "send-message", conv_id, scoped_prompt]
        else:
            if conv_id:
                print(f"[AGENT] Previous conversation {conv_id} transcript not found. Starting fresh conversation...")
            conv_id = None
            print(f"[AGENT] Creating new conversation for project '{client_name}' (Model: {model})...")
            cmd = [self.agentapi_path, "new-conversation", f"--model={model}", f"--title={clean_title}", scoped_prompt]

        def run_agentapi(c):
            return subprocess.run(
                c, cwd=project_path, env=env, capture_output=True, text=True,
                timeout=25, creationflags=CREATE_NO_WINDOW
            )

        try:
            proc = run_agentapi(cmd)
            # If port changed between checks or connection refused, re-discover and retry once!
            err_text = (proc.stderr or "") + " " + (proc.stdout or "")
            if proc.returncode != 0 and any(kw in err_text.lower() for kw in ["connection error", "actively refused", "unavailable", "transport"]):
                print("[RETRY] Connection refused. Re-discovering active Antigravity port...")
                if self.discover_language_server():
                    env["ANTIGRAVITY_LS_ADDRESS"] = self.ls_address
                    env["ANTIGRAVITY_CSRF_TOKEN"] = self.csrf_token
                    proc = run_agentapi(cmd)

            if proc.returncode != 0:
                if conv_id:
                    print(f"[AGENT] send-message failed for {conv_id} ({proc.stderr or proc.stdout}). Retrying with new-conversation...")
                    conv_id = None
                    start_line_count = 0
                    cmd = [self.agentapi_path, "new-conversation", f"--model={model}", f"--title={clean_title}", scoped_prompt]
                    proc = run_agentapi(cmd)
                if proc.returncode != 0:
                    raise RuntimeError(f"agentapi failed: {proc.stderr or proc.stdout}")

            res_json = json.loads(proc.stdout)
            if not conv_id:
                conv_id = res_json.get("response", {}).get("newConversation", {}).get("conversationId")

            if not conv_id:
                raise RuntimeError(f"Could not retrieve conversationId from response: {proc.stdout}")

            print(f"[AGENT CONVERSATION] Active conversation ID: {conv_id}")
            self.associate_conversation_with_project(conv_id, proj_id, client_name, project_path, title=clean_title)
            self.stream_update(job_id, "Agent initiated task. Processing...", "", conv_id)

            # 4. Tail transcript_full.jsonl (or transcript.jsonl)
            full_path = os.path.join(BRAIN_DIR, conv_id, ".system_generated", "logs", "transcript_full.jsonl")
            compact_path = os.path.join(BRAIN_DIR, conv_id, ".system_generated", "logs", "transcript.jsonl")
            
            start_wait = time.time()
            while not (os.path.exists(full_path) or os.path.exists(compact_path)) and time.time() - start_wait < 15:
                time.sleep(0.5)

            transcript_path = full_path if os.path.exists(full_path) else compact_path

            accumulated_output = ""
            accumulated_thoughts = []
            last_sent_output = ""
            last_sent_thoughts = ""
            is_done = False
            last_stream_time = 0
            last_line_count = 0
            stable_unchanged_count = 0

            max_execution_time = 360  # 6 minutes max per turn
            exec_start = time.time()

            while time.time() - exec_start < max_execution_time:
                time.sleep(0.1)  # 100ms fast-poll loop
                if os.path.exists(full_path):
                    transcript_path = full_path
                elif os.path.exists(compact_path):
                    transcript_path = compact_path
                else:
                    continue

                thoughts_list = []
                latest_content = ""
                latest_status = None
                latest_step_type = None
                current_total_lines = 0
                is_final_response = False

                try:
                    with open(transcript_path, "r", encoding="utf-8") as tf:
                        for line_idx, line in enumerate(tf):
                            if not line.strip():
                                continue
                            current_total_lines += 1
                            if line_idx < start_line_count:
                                continue  # Skip prior turns in resumed conversations!
                            try:
                                step = json.loads(line)
                                stype = step.get("type")
                                ssource = step.get("source")
                                sstatus = step.get("status")
                                sthink = step.get("thinking")
                                scontent = step.get("content")
                                stools = step.get("tool_calls", [])

                                if sthink:
                                    thoughts_list.append(sthink)
                                if stools:
                                    for t in stools:
                                        if isinstance(t, dict):
                                            tname = t.get("name") or t.get("toolAction") or t.get("toolSummary") or "tool"
                                            args = t.get("args") or {}
                                            detail = ""
                                            if "CommandLine" in args:
                                                cmd_snippet = str(args["CommandLine"]).strip().replace("\n", " ")[:60]
                                                detail = f": {cmd_snippet}"
                                            elif "TargetFile" in args:
                                                f_name = os.path.basename(str(args["TargetFile"]))
                                                detail = f": {f_name}"
                                            elif "AbsolutePath" in args:
                                                f_name = os.path.basename(str(args["AbsolutePath"]))
                                                detail = f": {f_name}"
                                            elif "Pattern" in args:
                                                detail = f": {args['Pattern']}"
                                            elif "Query" in args:
                                                detail = f": {args['Query']}"
                                            thoughts_list.append(f"⚡ [{tname}{detail}]")
                                        else:
                                            thoughts_list.append(f"⚡ [{t}]")

                                if stype == "PLANNER_RESPONSE" and scontent:
                                    latest_content = scontent
                                    if sstatus == "DONE" and not stools:
                                        is_final_response = True
                                elif stype == "GENERIC" and scontent:
                                    clean_snippet = scontent.strip()[:180].replace('\n', ' ')
                                    thoughts_list.append(f"📋 Result: {clean_snippet}")
                            except Exception:
                                pass
                except Exception:
                    pass

                thoughts_str = "\n\n".join(thoughts_list)
                accumulated_output = latest_content

                # Fast debounced stream push (sub-150ms whenever output or thoughts change)
                now = time.time()
                content_changed = (accumulated_output != last_sent_output) or (thoughts_str != last_sent_thoughts)
                if (content_changed and (now - last_stream_time >= 0.15)) or (now - last_stream_time >= 2.0):
                    self.stream_update(job_id, accumulated_output or "Agent is executing tools & analyzing workspace...", thoughts_str, conv_id)
                    last_sent_output = accumulated_output
                    last_sent_thoughts = thoughts_str
                    last_stream_time = now

                # Completion check:
                if is_final_response and accumulated_output:
                    stable_unchanged_count += 1
                    if stable_unchanged_count >= 15:  # Confirmed stable for 1.5 seconds at 100ms
                        is_done = True
                        break
                elif accumulated_output and current_total_lines == last_line_count and current_total_lines > start_line_count:
                    stable_unchanged_count += 1
                    if stable_unchanged_count >= 25:  # Fallback stability check (2.5s)
                        is_done = True
                        break
                else:
                    stable_unchanged_count = 0
                last_line_count = current_total_lines

            # Synchronize Client Vault (context, raw_files, prototypes, conversations)
            artifacts = self.sync_client_vault(job, conv_id, project_path, accumulated_output, thoughts_str)

            if conv_id and proj_id:
                self.associate_conversation_with_project(conv_id, proj_id, client_name, project_path, title=clean_title)
                try:
                    msgs = self.get_conversation_transcript(conv_id)
                    if msgs:
                        self.upload_conversation_transcript(conv_id, msgs, proj_id)
                except Exception:
                    pass

            if is_done or accumulated_output:
                self.complete_job(
                    job_id=job_id,
                    status="completed",
                    stream_output=accumulated_output,
                    thoughts=thoughts_str,
                    conversation_id=conv_id,
                    artifacts=artifacts
                )
                self.notify("Agent Job Completed", f"Finished {agent_slug} for {client_name}")
            else:
                self.complete_job(
                    job_id=job_id,
                    status="failed",
                    stream_output=accumulated_output,
                    thoughts=thoughts_str,
                    conversation_id=conv_id,
                    error_message="Execution timed out without final output."
                )
                self.notify("Agent Job Timeout", f"{agent_slug} for {client_name} timed out")

        except Exception as err:
            print(f"[JOB ERROR] {err}")
            self.complete_job(
                job_id=job_id,
                status="failed",
                stream_output="",
                thoughts="",
                conversation_id=conv_id,
                error_message=str(err)
            )
            self.notify("Agent Job Failed", f"Failed {agent_slug} for {client_name}: {err}")
        finally:
            self.current_job_id = None
            self.set_status("ready", "Idle (Listening for jobs)")
            try:
                self.send_heartbeat()
            except Exception:
                pass

    def start(self):
        """Main worker loop."""
        print("=" * 60)
        print(" Zero7 CRM — Google Antigravity Local Bridge Worker")
        print(f" Cloud CRM: {self.server_url}")
        print("=" * 60)

        # Discovery & Auto-Launch
        while self.running:
            if self.ensure_antigravity_running():
                self.set_status("ready", f"Antigravity ready ({self.ls_address})")
                break
            self.set_status("waiting", "Waiting for Antigravity engine...")
            print("[WAIT] Google Antigravity language_server.exe not active. Retrying in 5 seconds...")
            time.sleep(5)

        # Start background heartbeat thread
        hb_thread = threading.Thread(target=self.heartbeat_worker, daemon=True)
        hb_thread.start()

        # Background pre-sync: cache recent conversation transcripts in Cloud CRM
        def presync_worker():
            time.sleep(2)
            try:
                convs_map = self.get_all_project_conversations()
                by_id = convs_map.get("by_project_id", {})
                synced_count = 0
                for pid, clist in by_id.items():
                    for c in clist[:3]:  # Top 3 conversations per project
                        cid = c.get("id")
                        if cid:
                            msgs = self.get_conversation_transcript(cid)
                            if msgs:
                                self.upload_conversation_transcript(cid, msgs, pid)
                                synced_count += 1
                if synced_count:
                    print(f"[PRE-SYNC] Pre-cached {synced_count} project conversation transcripts to Cloud CRM.")
            except Exception as e:
                print(f"[PRE-SYNC ERROR] {e}")

        threading.Thread(target=presync_worker, daemon=True).start()

        print("\n[READY] Worker listening for tasks from Cloud CRM...")
        print("Press Ctrl+C to stop.\n")

        while self.running:
            try:
                if not self.current_job_id:
                    self.set_status("ready", "Idle (Ready)")
                job = self.poll_for_job()
                if job:
                    self.execute_job(job)
                else:
                    time.sleep(POLL_INTERVAL_SECS)
            except KeyboardInterrupt:
                print("\n[STOP] Shutting down worker.")
                self.running = False
                self.set_status("offline", "Stopped")
                break
            except Exception as e:
                print(f"[ERROR] Polling loop exception: {e}")
                self.set_status("error", f"Error: {e}")
                time.sleep(POLL_INTERVAL_SECS)

if __name__ == "__main__":
    worker = AntigravityWorker()
    worker.start()
