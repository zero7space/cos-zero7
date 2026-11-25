"""
Zero7 CRM — Autonomous Vercel Deployment & Domain Provisioner
Enables 1-click or automated deployment of client prototypes to Vercel via Vercel REST API,
and automatically associates Hostinger DNS custom subdomains (proto-*.zero7.space).
"""

import os
import json
import logging
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional

from backend.integrations.dns_provisioner import dns_provisioner

logger = logging.getLogger("zero7_vercel")

VERCEL_API_URL = "https://api.vercel.com"
VERCEL_TOKEN = os.environ.get("VERCEL_TOKEN", "")
VERCEL_TEAM_ID = os.environ.get("VERCEL_TEAM_ID", "")


class VercelDeployer:
    def __init__(self, token: Optional[str] = None, team_id: Optional[str] = None):
        self.token = token or VERCEL_TOKEN
        self.team_id = team_id or VERCEL_TEAM_ID
        self._mock_mode = not bool(self.token)

    def _headers(self) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.token}"
        }
        return headers

    def _build_url(self, path: str) -> str:
        url = f"{VERCEL_API_URL}{path}"
        if self.team_id:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}teamId={self.team_id}"
        return url

    def deploy_project_from_files(
        self,
        project_name: str,
        files: List[Dict[str, str]],
        env_vars: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Deploys an in-memory bundle of files directly to Vercel via REST API v13.
        `files` is a list of {"file": "index.html", "data": "..."} dicts.
        """
        clean_name = project_name.lower().replace("_", "-").strip("-")

        if self._mock_mode:
            logger.info(f"[VERCEL MOCK] Deploying {clean_name} ({len(files)} files) to Vercel...")
            simulated_url = f"https://{clean_name}.vercel.app"
            return {
                "success": True,
                "mock": True,
                "project_name": clean_name,
                "deployment_id": f"dpl_mock_{clean_name[:8]}",
                "deployment_url": simulated_url,
                "status": "READY",
                "files_uploaded": len(files)
            }

        # Format files for Vercel deployment API
        formatted_files = []
        for f in files:
            formatted_files.append({
                "file": f["file"],
                "data": f["data"]
            })

        payload = {
            "name": clean_name,
            "files": formatted_files,
            "projectSettings": {
                "framework": None
            }
        }

        if env_vars:
            payload["env"] = env_vars

        try:
            url = self._build_url("/v13/deployments")
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers=self._headers(),
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                dpl_url = f"https://{data.get('url')}"
                return {
                    "success": True,
                    "project_name": clean_name,
                    "deployment_id": data.get("id"),
                    "deployment_url": dpl_url,
                    "status": data.get("readyState", "READY")
                }
        except Exception as e:
            logger.error(f"[VERCEL DEPLOY ERROR] {e}")
            return {
                "success": False,
                "error": str(e),
                "fallback_url": f"https://{clean_name}.vercel.app"
            }

    def bind_custom_subdomain(self, project_name: str, subdomain: str) -> Dict[str, Any]:
        """
        1. Associates custom domain on Vercel project.
        2. Provisions Hostinger DNS CNAME/A record for instant routing.
        """
        clean_proj = project_name.lower().replace("_", "-").strip("-")
        clean_sub = subdomain.replace("https://", "").replace("http://", "").split("/")[0].strip()

        # Step 1: Add domain to Vercel
        vercel_added = False
        if not self._mock_mode:
            try:
                url = self._build_url(f"/v9/projects/{clean_proj}/domains")
                payload = json.dumps({"name": clean_sub}).encode("utf-8")
                req = urllib.request.Request(url, data=payload, headers=self._headers(), method="POST")
                with urllib.request.urlopen(req, timeout=15) as resp:
                    vercel_added = True
            except Exception as e:
                logger.warning(f"[VERCEL DOMAIN] Could not add domain directly on Vercel: {e}")
        else:
            vercel_added = True

        # Step 2: Ensure Hostinger DNS points to droplet (or Vercel CNAME)
        # In Zero7, proto-*.zero7.space wildcard or A record points to Droplet IP (68.183.92.215)
        # where Nginx reverse proxies or Hostinger hosts DNS
        dns_res = dns_provisioner.provision_subdomain("lead_vercel_auto", clean_sub, allow_collision_override=True)

        return {
            "success": True,
            "project_name": clean_proj,
            "subdomain": clean_sub,
            "vercel_domain_bound": vercel_added,
            "dns_record": dns_res,
            "live_url": f"https://{clean_sub}"
        }


vercel_deployer = VercelDeployer()
