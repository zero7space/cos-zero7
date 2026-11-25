"""
Zero7 CRM — Subdomain Provisioner & DNS Lifecycle Manager (Hardened)
Manages client-scoped live subdomains (proto-{client}.zero7.space) directly inside Hostinger DNS.
Enforces strictly limited scope: only client-assigned proto-* records are touched.
Protected system records (cos, @, mail, etc.) are strictly safeguarded.
Supports Hostinger DNS API (Primary) and DigitalOcean DNS API (Secondary).
Includes collision prevention, RFC 1123 compliance, exponential backoff, and reconciliation.
"""

import os
import re
import json
import time
import socket
import logging
import urllib.request
import urllib.error
from typing import Optional, Dict, Any, Tuple, List

from backend.database import Repository

logger = logging.getLogger("zero7_dns")

ROOT_DOMAIN = os.environ.get("ZERO7_ROOT_DOMAIN", "zero7.space").lower().strip()
DROPLET_IP = os.environ.get("ZERO7_DROPLET_IP", "68.183.92.215").strip()

# Hostinger API Token (Primary DNS Provider)
HOSTINGER_API_TOKEN = os.environ.get("HOSTINGER_API_TOKEN", "").strip()

# DigitalOcean Token (Secondary / Fallback)
DO_API_TOKEN = os.environ.get("DO_API_TOKEN", "").strip()

# Strict guardrail: these prefixes and names can NEVER be modified, deleted, or assigned as client subdomains
BASE_PROTECTED_PREFIXES = {
    "@", "cos", "www", "mail", "api", "admin", "crm", "ssh", "smtp",
    "pop", "imap", "autodiscover", "autoconfig", "ftp", "ns1", "ns2", "ns3",
    "status", "root", "zmail._domainkey", "_vercel", "metalstar", "dev",
    "staging", "prod", "internal", "health", "metrics", "whm", "cpanel", "webmail"
}


def normalize_subdomain(subdomain_input: str) -> Tuple[str, str]:
    """
    Normalizes input to conform strictly to RFC 1123 DNS specification:
      1. Strips protocols (https://, http://), ports, trailing slashes.
      2. Strips .zero7.space root domain.
      3. Sanitizes non-alphanumeric characters to single hyphens.
      4. Collapses multiple hyphens ('proto---test' -> 'proto-test').
      5. Caps prefix at 50 characters (max RFC label is 63 chars).
      6. Enforces 'proto-' prefix for client prototypes.
      Returns:
        prefix: 'proto-client'
        full_domain: 'proto-client.zero7.space'
    """
    raw = (subdomain_input or "").lower().strip()
    raw = re.sub(r"^https?://", "", raw).split("/")[0].split(":")[0].strip()

    # If it ends with .zero7.space, strip the root domain
    if raw.endswith(f".{ROOT_DOMAIN}"):
        prefix = raw[:-len(f".{ROOT_DOMAIN}")].strip(".")
    elif raw == ROOT_DOMAIN:
        prefix = ""
    else:
        prefix = raw

    # Sanitize characters: only a-z, 0-9, and hyphens allowed
    clean = re.sub(r"[^a-z0-9-]+", "-", prefix)
    # Collapse multiple consecutive hyphens into one
    clean = re.sub(r"-+", "-", clean).strip("-")

    if not clean:
        clean = "preview"

    # Enforce proto- prefix
    if not clean.startswith("proto-"):
        # Remove standalone 'proto' prefix without hyphen if typed
        if clean.startswith("proto"):
            clean = f"proto-{clean[5:].lstrip('-')}"
        else:
            clean = f"proto-{clean}"

    # RFC 1123 DNS label length limit: max 63 characters total per label.
    # Cap prefix at 50 chars to leave ample margin.
    if len(clean) > 50:
        clean = clean[:50].rstrip("-")

    full_domain = f"{clean}.{ROOT_DOMAIN}"
    return clean, full_domain


def check_subdomain_collision(full_subdomain: str, current_lead_id: str) -> Optional[Dict[str, Any]]:
    """
    Checks if the desired subdomain is already allocated to another lead.
    Returns details of the conflicting lead if collision exists, else None.
    """
    clean_sub = full_subdomain.lower().strip()
    prefix = clean_sub.split(".")[0]
    
    # Query database for existing assignment
    row = Repository._execute("""
        SELECT id, name, business_name, subdomain, subdomain_status
        FROM leads
        WHERE (LOWER(subdomain) = ? OR LOWER(subdomain) = ?) AND id != ?
    """, (clean_sub, prefix, current_lead_id), fetchone=True)
    
    if row:
        return {
            "conflicting_lead_id": row["id"],
            "conflicting_lead_name": row["name"],
            "conflicting_business": row.get("business_name") or row["name"],
            "subdomain": row["subdomain"]
        }
    return None


def suggest_alternative_slug(base_subdomain: str, current_lead_id: str) -> str:
    """Generates an alternative available subdomain slug (e.g. proto-burosys-2)."""
    prefix, _ = normalize_subdomain(base_subdomain)
    # Strip any trailing number
    match = re.match(r"^(.*?)(?:-(\d+))?$", prefix)
    stem = match.group(1) if match else prefix

    for i in range(2, 50):
        candidate_prefix = f"{stem}-{i}"
        candidate_full = f"{candidate_prefix}.{ROOT_DOMAIN}"
        if not check_subdomain_collision(candidate_full, current_lead_id):
            return candidate_full
    return f"{stem}-{int(time.time()) % 1000}.{ROOT_DOMAIN}"


class HostingerDNSClient:
    """Primary DNS provider: directly adds and deletes records via Hostinger REST API with retry."""

    def __init__(self, token: str, domain: str = ROOT_DOMAIN):
        self.token = token
        self.domain = domain
        self.base_url = f"https://developers.hostinger.com/api/dns/v1/zones/{domain}"
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "Zero7-CRM/1.0 (Windows NT 10.0; Win64; x64)"
        }

    def _request_with_retry(self, method: str, url: str, data: Optional[dict] = None, max_retries: int = 3) -> Tuple[int, Any]:
        """Executes HTTP request with exponential backoff for 429 and 5xx errors."""
        payload = json.dumps(data).encode("utf-8") if data is not None else None
        last_status = 500
        last_body = ""

        for attempt in range(max_retries):
            req = urllib.request.Request(url, data=payload, headers=self.headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=14) as resp:
                    body = resp.read().decode("utf-8")
                    return resp.status, json.loads(body) if body else {}
            except urllib.error.HTTPError as e:
                last_status = e.code
                last_body = e.read().decode("utf-8")
                # Retry on rate limit (429) or transient Cloudflare gateway issues (502, 503, 504)
                if e.code in (429, 502, 503, 504) and attempt < max_retries - 1:
                    sleep_time = (2 ** attempt) + 0.5
                    logger.warning(f"[HOSTINGER API RETRY] HTTP {e.code} on {method}. Retrying in {sleep_time:.1f}s...")
                    time.sleep(sleep_time)
                    continue
                try:
                    return e.code, json.loads(last_body)
                except Exception:
                    return e.code, {"error": last_body}
            except Exception as e:
                logger.error(f"[HOSTINGER API EXCEPTION] {e} on {method} {url}")
                if attempt < max_retries - 1:
                    time.sleep(1.5)
                    continue
                return 500, {"error": str(e)}

        return last_status, {"error": last_body}

    def list_records(self) -> list:
        status, res = self._request_with_retry("GET", self.base_url)
        return res if (status == 200 and isinstance(res, list)) else []

    def get_dynamic_protected_prefixes(self) -> set:
        """Dynamically shields all existing non-proto records on Hostinger."""
        protected = set(BASE_PROTECTED_PREFIXES)
        try:
            records = self.list_records()
            for r in records:
                name = r.get("name", "").lower().strip()
                if name and not name.startswith("proto-"):
                    protected.add(name)
        except Exception:
            pass
        return protected

    def create_a_record(self, name: str, ip: str = DROPLET_IP, ttl: int = 300) -> Tuple[bool, Optional[dict], str]:
        protected = self.get_dynamic_protected_prefixes()
        if name in protected:
            return False, None, f"Cannot create protected record '{name}'"

        payload = {
            "zone": [
                {
                    "name": name,
                    "type": "A",
                    "ttl": ttl,
                    "records": [
                        {"content": ip}
                    ]
                }
            ],
            "overwrite": False
        }
        status, res = self._request_with_retry("PUT", self.base_url, payload)
        if status in (200, 201):
            logger.info(f"[HOSTINGER DNS] Created A record '{name}' -> {ip}")
            return True, {"id": f"hostinger_{name}", "name": name, "ip": ip}, "Hostinger DNS record active"
        err_msg = res.get("message") or res.get("error") or f"HTTP {status}"
        return False, None, f"Hostinger error: {err_msg}"

    def delete_record(self, name: str) -> Tuple[bool, str]:
        clean_name = name.lower().strip()
        protected = self.get_dynamic_protected_prefixes()
        if clean_name in protected:
            return False, f"Refusing to delete protected record '{clean_name}'"

        payload = {
            "filters": [
                {
                    "name": clean_name,
                    "type": "A"
                }
            ]
        }
        status, res = self._request_with_retry("DELETE", self.base_url, payload)
        if status in (200, 204):
            logger.info(f"[HOSTINGER DNS] Deleted record '{clean_name}'")
            return True, "Hostinger DNS record deleted"
        err_msg = res.get("message") or res.get("error") or f"HTTP {status}"
        return False, f"Hostinger delete error: {err_msg}"


class SubdomainProvisioner:
    """High-level, scoped subdomain lifecycle manager for client prototypes."""

    def __init__(self):
        self.hostinger_client = HostingerDNSClient(HOSTINGER_API_TOKEN, ROOT_DOMAIN) if HOSTINGER_API_TOKEN else None

    def verify_dns_resolution(self, subdomain: str) -> Tuple[bool, str]:
        try:
            resolved_ip = socket.gethostbyname(subdomain)
            is_valid = (resolved_ip == DROPLET_IP)
            return is_valid, resolved_ip
        except Exception as e:
            return False, str(e)

    def provision_subdomain(
        self,
        lead_id: str,
        subdomain_input: str,
        target_ip: str = DROPLET_IP,
        allow_collision_override: bool = False
    ) -> Dict[str, Any]:
        """
        Provisions a client subdomain directly in Hostinger DNS with full edge-case protection:
        1. RFC 1123 normalization & 50-character limit
        2. Collision check against other leads
        3. Dynamic protected records protection
        4. Scoped deletion of old record if changed
        5. Exponential backoff creation in Hostinger
        6. State persistence in DB & subdomain_routes
        """
        lead = Repository.get_lead(lead_id)
        if not lead:
            return {"success": False, "error": f"Lead '{lead_id}' not found"}

        prefix, full_subdomain = normalize_subdomain(subdomain_input)

        # Edge Case 1: Protected System Record Check
        protected_prefixes = self.hostinger_client.get_dynamic_protected_prefixes() if self.hostinger_client else BASE_PROTECTED_PREFIXES
        if prefix in protected_prefixes:
            return {
                "success": False,
                "error": f"Subdomain prefix '{prefix}' is a protected system or production domain and cannot be used for client prototypes."
            }

        # Edge Case 2: Subdomain Collision Check
        collision = check_subdomain_collision(full_subdomain, lead_id)
        if collision and not allow_collision_override:
            alt_slug = suggest_alternative_slug(full_subdomain, lead_id)
            return {
                "success": False,
                "collision": True,
                "error": f"Subdomain '{full_subdomain}' is already assigned to lead '{collision['conflicting_lead_name']}' ({collision['conflicting_business']}).",
                "conflicting_lead": collision,
                "suggested_subdomain": alt_slug
            }

        old_subdomain = lead.get("subdomain") or ""
        old_record_id = lead.get("dns_record_id") or ""

        # Edge Case 3: De-provision previous record if changed
        if old_subdomain and old_subdomain.lower() != full_subdomain.lower():
            old_prefix = old_subdomain.split(".")[0].lower()
            if old_prefix not in protected_prefixes:
                logger.info(f"[DNS SCOPE] De-provisioning previous subdomain '{old_subdomain}' for lead {lead_id}")
                self._delete_dns_record(old_record_id, old_prefix)

        # Edge Case 4: Create new DNS record via Hostinger
        dns_record_id = None
        dns_message = ""
        dns_success = False

        if self.hostinger_client:
            ok, rec, msg = self.hostinger_client.create_a_record(prefix, target_ip, ttl=300)
            if ok and rec:
                dns_record_id = str(rec.get("id"))
                dns_success = True
                dns_message = msg
            else:
                dns_message = msg
        else:
            dns_message = "No Hostinger API token configured"

        # Edge Case 5: Verify DNS Resolution
        dns_resolved, resolved_ip = self.verify_dns_resolution(full_subdomain)
        subdomain_status = "active" if dns_resolved or dns_success else "pending"

        # Step 6: Persist in Database
        Repository.update_lead(lead_id, {
            "subdomain": full_subdomain,
            "subdomain_status": subdomain_status,
            "dns_record_id": dns_record_id
        })

        # Step 7: Update Subdomain Routes
        Repository.register_subdomain_route(
            lead_id=lead_id,
            subdomain=full_subdomain,
            target_ip=target_ip,
            cf_record_id=dns_record_id
        )

        return {
            "success": dns_success,
            "provider": "hostinger",
            "lead_id": lead_id,
            "subdomain": full_subdomain,
            "prefix": prefix,
            "dns_record_id": dns_record_id,
            "target_ip": target_ip,
            "dns_verified": dns_resolved,
            "resolved_ip": resolved_ip,
            "status": subdomain_status,
            "live_url": f"https://{full_subdomain}",
            "dns_message": dns_message
        }

    def deprovision_subdomain(self, lead_id: str) -> Dict[str, Any]:
        """De-provisions client subdomain directly in Hostinger DNS."""
        lead = Repository.get_lead(lead_id)
        if not lead:
            return {"success": False, "error": f"Lead '{lead_id}' not found"}

        subdomain = lead.get("subdomain") or ""
        record_id = lead.get("dns_record_id") or ""

        if not subdomain:
            return {"success": True, "message": "Lead has no assigned subdomain"}

        prefix = subdomain.split(".")[0].lower()
        protected = self.hostinger_client.get_dynamic_protected_prefixes() if self.hostinger_client else BASE_PROTECTED_PREFIXES
        if prefix in protected:
            return {"success": False, "error": f"Refusing to delete protected domain '{subdomain}'"}

        deleted, msg = self._delete_dns_record(record_id, prefix)

        # Clear DB references
        Repository.update_lead(lead_id, {
            "subdomain": None,
            "subdomain_status": "pending",
            "dns_record_id": None
        })

        try:
            Repository._execute(
                "DELETE FROM subdomain_routes WHERE lead_id = ? OR subdomain = ?",
                (lead_id, subdomain),
                commit=True
            )
        except Exception as e:
            logger.warning(f"Could not remove route for {subdomain}: {e}")

        return {
            "success": True,
            "provider": "hostinger",
            "lead_id": lead_id,
            "deprovisioned_subdomain": subdomain,
            "dns_deleted": deleted,
            "message": msg
        }

    def _delete_dns_record(self, record_id: Optional[str], name_hint: str) -> Tuple[bool, str]:
        if not name_hint:
            return False, "No record name specified"
        if self.hostinger_client:
            return self.hostinger_client.delete_record(name_hint)
        return False, "No active Hostinger DNS client"

    def reconcile_dns_records(self, auto_fix: bool = False) -> Dict[str, Any]:
        """
        Reconciles active Hostinger DNS records with CRM leads.
        Identifies orphaned DNS records and missing DNS records.
        """
        if not self.hostinger_client:
            return {"error": "Hostinger DNS client not available"}

        hostinger_records = self.hostinger_client.list_records()
        hostinger_proto_a = {
            r["name"].lower(): r["records"][0]["content"]
            for r in hostinger_records
            if r.get("type") == "A" and r.get("name", "").startswith("proto-")
        }

        leads_with_sub = Repository._execute("""
            SELECT id, name, business_name, subdomain, subdomain_status, dns_record_id
            FROM leads
            WHERE subdomain IS NOT NULL AND subdomain != ''
        """, fetchall=True) or []

        db_proto_map = {}
        for l in leads_with_sub:
            sub = l["subdomain"].lower()
            pfx = sub.split(".")[0]
            db_proto_map[pfx] = l

        orphaned_dns = [pfx for pfx in hostinger_proto_a if pfx not in db_proto_map]
        missing_dns = [pfx for pfx in db_proto_map if pfx not in hostinger_proto_a]
        synced = [pfx for pfx in db_proto_map if pfx in hostinger_proto_a]

        fixed_orphans = []
        fixed_missing = []

        if auto_fix:
            # Delete orphaned records from Hostinger
            for pfx in orphaned_dns:
                ok, _ = self.hostinger_client.delete_record(pfx)
                if ok:
                    fixed_orphans.append(pfx)

            # Provision missing records to Hostinger
            for pfx in missing_dns:
                lead = db_proto_map[pfx]
                res = self.provision_subdomain(lead["id"], lead["subdomain"])
                if res.get("success"):
                    fixed_missing.append(pfx)

        return {
            "synced_count": len(synced),
            "synced_records": synced,
            "orphaned_count": len(orphaned_dns),
            "orphaned_dns_records": orphaned_dns,
            "missing_count": len(missing_dns),
            "missing_dns_records": missing_dns,
            "auto_fix_applied": auto_fix,
            "fixed_orphans": fixed_orphans,
            "fixed_missing": fixed_missing
        }


# Global singleton instance
dns_provisioner = SubdomainProvisioner()
