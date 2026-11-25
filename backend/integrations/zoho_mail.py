"""
Zero7 CRM - Zoho Mail Integration Module
Supports Multi-Account Sync (Admin + Ramesh + Vijay), OAuth2 auto-refresh,
multi-alias bifurcation (incoming & outgoing), SQLite server-side persistence,
background syncing, inline image resolution (/mail/ImageDisplay),
attachment in-dialog previewing, and Compose with attachment uploads.
"""

import os
import re
import time
import html
import json
import logging
import mimetypes
from typing import Optional, Dict, Any, List, Tuple
import httpx
from backend.database import Repository

logger = logging.getLogger(__name__)

# Default Zoho OAuth Credentials (Admin: admin@zero7.space)
DEFAULT_ZOHO_CLIENT_ID = "1000.Y4AKM95AVXWHC8ZLRMSFIW88TL89WU"
DEFAULT_ZOHO_CLIENT_SECRET = "e9890321fe4b7d7e29f54545343feffdae0dc9b33f"
DEFAULT_ZOHO_REFRESH_TOKEN = "1000.d3cf99739d22de82245bfee983713420.6c84b4e337f5dd870b0e2ad574af2c33"
DEFAULT_ZOHO_ACCOUNT_ID = "1914516000000002002"
DEFAULT_ZOHO_REGION = "in"

# Default Zoho OAuth Credentials (Ramesh: ramesh@zero7.space - hosts intern aliases)
DEFAULT_ZOHO_RAMESH_CLIENT_ID = "1000.QY6YFJKQCDPJ8R5QX1QN4W2E7DA53C"
DEFAULT_ZOHO_RAMESH_CLIENT_SECRET = "f53f84ccedb8adcc25ddbb24436392618fd0c8cca1"
DEFAULT_ZOHO_RAMESH_REFRESH_TOKEN = "1000.b5da4cb16541c1f857f2920032233e04.49923b7369b8dc5360ff9c1a4de8a4be"
DEFAULT_ZOHO_RAMESH_ACCOUNT_ID = "6428066000000002002"

# Default Zoho OAuth Credentials (Vijay: vijay@zero7.space - hosts Vijay & Vansh aliases)
DEFAULT_ZOHO_VIJAY_CLIENT_ID = "1000.X54E9Z8GNXME9LY7OYWRI5L460GW6Y"
DEFAULT_ZOHO_VIJAY_CLIENT_SECRET = "936b3ca90771aa3237dec08ae80f9a022c18e8892b"
DEFAULT_ZOHO_VIJAY_REFRESH_TOKEN = "1000.b14ed289b2512d6168252f5bfc77f7ef.aee27c571415dd96b379f93e9db2fd34"
DEFAULT_ZOHO_VIJAY_ACCOUNT_ID = "7627792000000002002"

DEFAULT_LABELS = [
    {"id": "primary", "name": "Primary", "color": "#00b69b", "bg": "rgba(0, 182, 155, 0.14)"},
    {"id": "social", "name": "Social", "color": "#5a8cff", "bg": "rgba(90, 140, 255, 0.14)"},
    {"id": "work", "name": "Work", "color": "#fd9a56", "bg": "rgba(253, 154, 86, 0.16)"},
    {"id": "friends", "name": "Friends", "color": "#d456fd", "bg": "rgba(212, 86, 253, 0.14)"},
]


def _extract_emails(raw_str: str) -> List[str]:
    if not raw_str or raw_str == "Not Provided":
        return []
    decoded = html.unescape(str(raw_str))
    found = re.findall(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", decoded)
    return [e.lower() for e in found]


def _clean_display_address(raw_str: str) -> str:
    if not raw_str or raw_str == "Not Provided":
        return ""
    decoded = html.unescape(str(raw_str)).strip()
    return decoded


def _extract_primary_name(sender_str: str, address_str: str) -> str:
    s = html.unescape(str(sender_str or "")).strip().strip('"').strip("'")
    if s and "@" not in s:
        return s
    decoded_addr = html.unescape(str(address_str or "")).strip()
    m = re.match(r'^"?([^"<]+)"?\s*<', decoded_addr)
    if m:
        name_part = m.group(1).strip().strip('"')
        if name_part:
            return name_part
    if s:
        return s.split("@")[0]
    emails = _extract_emails(decoded_addr)
    if emails:
        return emails[0].split("@")[0]
    return "Unknown"


def _normalize_subject(subject: str) -> str:
    if not subject:
        return "(no subject)"
    s = html.unescape(str(subject)).strip()
    s = re.sub(r"^(\s*(re|fwd|fw)\s*:\s*)+", "", s, flags=re.IGNORECASE).strip()
    return s.lower() or "(no subject)"


def detect_mime_type(content: bytes, filename: str = "") -> str:
    """Detects accurate MIME type from content magic bytes or filename."""
    if not content:
        guessed, _ = mimetypes.guess_type(filename)
        return guessed or "application/octet-stream"

    # Magic byte checks
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith(b"GIF87a") or content.startswith(b"GIF89a"):
        return "image/gif"
    if content.startswith(b"%PDF"):
        return "application/pdf"
    if content.startswith(b"RIFF") and b"WEBP" in content[8:16]:
        return "image/webp"
    if content.startswith(b"BM"):
        return "image/bmp"
    if b"<svg" in content[:256] or b"<?xml" in content[:64] and b"<svg" in content[:512]:
        return "image/svg+xml"
    if content.startswith(b"\x1a\x45\xdf\xa3"):
        return "video/webm"
    if content.startswith(b"\x00\x00\x00") and (b"ftypmp42" in content[:32] or b"ftypisom" in content[:32]):
        return "video/mp4"

    guessed, _ = mimetypes.guess_type(filename)
    if guessed and guessed != "application/octet-stream":
        return guessed

    fn_lower = filename.lower()
    if fn_lower.endswith(".pdf"):
        return "application/pdf"
    if fn_lower.endswith(".png"):
        return "image/png"
    if fn_lower.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if fn_lower.endswith(".gif"):
        return "image/gif"
    if fn_lower.endswith(".webp"):
        return "image/webp"
    if fn_lower.endswith(".svg"):
        return "image/svg+xml"
    if fn_lower.endswith(".txt"):
        return "text/plain"
    if fn_lower.endswith(".csv"):
        return "text/csv"
    if fn_lower.endswith(".json"):
        return "application/json"
    if fn_lower.endswith(".zip"):
        return "application/zip"

    return "application/octet-stream"


class ZohoMailAccount:
    """Represents a single Zoho Mailbox account (e.g. Admin or Ramesh)."""
    def __init__(
        self,
        name: str,
        client_id: str,
        client_secret: str,
        refresh_token: str,
        account_id: str,
        region: str = "in",
    ):
        self.name = name
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token
        self.account_id = account_id
        self.region = region

        self._access_token: Optional[str] = None
        self._token_expiry: float = 0.0
        self._overview_cache: Optional[Dict[str, Any]] = None
        self._overview_cache_ts: float = 0.0
        self.cache_file = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            f".zoho_token_{name}.json"
        )

    @property
    def accounts_base_url(self) -> str:
        return f"https://accounts.zoho.{self.region}"

    @property
    def mail_base_url(self) -> str:
        return f"https://mail.zoho.{self.region}/api"

    async def get_access_token(self, force_refresh: bool = False) -> str:
        now = time.time()
        if not force_refresh:
            if self._access_token and now < self._token_expiry:
                return self._access_token
            if os.path.exists(self.cache_file):
                try:
                    with open(self.cache_file, "r") as f:
                        cached = json.load(f)
                        if cached.get("token") and now < cached.get("expiry", 0):
                            self._access_token = cached["token"]
                            self._token_expiry = cached["expiry"]
                            return self._access_token
                except Exception:
                    pass

        url = f"{self.accounts_base_url}/oauth/v2/token"
        data = {
            "grant_type": "refresh_token",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "refresh_token": self.refresh_token,
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(url, data=data)
            if res.status_code != 200:
                logger.error(f"[ZOHO MAIL - {self.name}] Token refresh failed ({res.status_code}): {res.text}")
                raise RuntimeError(f"Zoho OAuth token refresh failed for {self.name}: {res.text}")
            payload = res.json()
            token = payload.get("access_token")
            if not token:
                logger.error(f"[ZOHO MAIL - {self.name}] No access_token in response: {payload}")
                raise RuntimeError(f"Zoho OAuth error for {self.name}: {payload.get('error', 'No access_token')}")
            self._access_token = token
            expires_in = int(payload.get("expires_in", 3600))
            self._token_expiry = now + max(expires_in - 300, 600)
            try:
                with open(self.cache_file, "w") as f:
                    json.dump({"token": self._access_token, "expiry": self._token_expiry}, f)
            except Exception:
                pass
            return self._access_token

    async def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        files: Optional[Dict[str, Any]] = None,
        timeout: float = 25.0,
    ) -> Dict[str, Any]:
        token = await self.get_access_token()
        url = f"{self.mail_base_url}{path}"
        headers = {"Authorization": f"Zoho-oauthtoken {token}"}

        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.request(method, url, headers=headers, params=params, json=json_body, files=files)
            if res.status_code in (401, 403):
                token = await self.get_access_token(force_refresh=True)
                headers = {"Authorization": f"Zoho-oauthtoken {token}"}
                res = await client.request(method, url, headers=headers, params=params, json=json_body, files=files)

            if res.status_code >= 400:
                logger.warning(f"[ZOHO MAIL - {self.name}] {method} {path} returned {res.status_code}: {res.text[:300]}")
                try:
                    err_json = res.json()
                except Exception:
                    err_json = {"error": res.text}
                raise RuntimeError(f"Zoho Mail API error for {self.name} ({res.status_code}): {json.dumps(err_json)}")

            try:
                return res.json()
            except Exception:
                return {"data": {}}

    async def get_overview(self, force_refresh: bool = False) -> Dict[str, Any]:
        now = time.time()
        if not force_refresh and self._overview_cache and (now - self._overview_cache_ts) < 300:
            return self._overview_cache

        acc_res = await self._request("GET", "/accounts")
        accounts = acc_res.get("data") or []
        acc = accounts[0] if accounts else {}
        if acc.get("accountId"):
            self.account_id = str(acc["accountId"])

        aliases = []
        seen_addrs = set()
        for smd in (acc.get("sendMailDetails") or []):
            addr = (smd.get("fromAddress") or "").strip().lower()
            if addr and addr not in seen_addrs:
                seen_addrs.add(addr)
                aliases.append({
                    "email": addr,
                    "displayName": smd.get("displayName") or addr.split("@")[0].title(),
                    "sendMailId": str(smd.get("sendMailId") or ""),
                    "isPrimary": smd.get("mode") == "mailbox" or addr.startswith("admin@"),
                    "mode": smd.get("mode") or "alias",
                })

        for ea in (acc.get("emailAddress") or []):
            addr = (ea.get("mailId") or "").strip().lower()
            if addr and addr.endswith("@zero7.space") and addr not in seen_addrs:
                seen_addrs.add(addr)
                aliases.append({
                    "email": addr,
                    "displayName": addr.split("@")[0].title(),
                    "sendMailId": "",
                    "isPrimary": bool(ea.get("isPrimary")),
                    "mode": "alias" if ea.get("isAlias") else "mailbox",
                })

        folders_res = await self._request("GET", f"/accounts/{self.account_id}/folders")
        raw_folders = folders_res.get("data") or []
        folders_map = {}
        for f in raw_folders:
            fname = (f.get("folderName") or "").strip()
            folders_map[fname.lower()] = {
                "folderId": str(f.get("folderId")),
                "folderName": fname,
                "folderType": f.get("folderType") or fname,
            }

        self._overview_cache = {
            "accountId": self.account_id,
            "primaryEmail": acc.get("primaryEmailAddress") or f"{self.name}@zero7.space",
            "displayName": (acc.get("sendMailDetails") or [{}])[0].get("displayName", "Zero7") if acc.get("sendMailDetails") else "Zero7",
            "aliases": aliases,
            "folders": folders_map,
            "rawFolders": raw_folders,
        }
        self._overview_cache_ts = now
        return self._overview_cache


class ZohoMailManager:
    def __init__(self):
        self.region = os.getenv("ZOHO_REGION", DEFAULT_ZOHO_REGION)

        # Admin account client
        self.admin_account = ZohoMailAccount(
            name="admin",
            client_id=os.getenv("ZOHO_CLIENT_ID", DEFAULT_ZOHO_CLIENT_ID),
            client_secret=os.getenv("ZOHO_CLIENT_SECRET", DEFAULT_ZOHO_CLIENT_SECRET),
            refresh_token=os.getenv("ZOHO_REFRESH_TOKEN", DEFAULT_ZOHO_REFRESH_TOKEN),
            account_id=os.getenv("ZOHO_ACCOUNT_ID", DEFAULT_ZOHO_ACCOUNT_ID),
            region=self.region,
        )

        # Ramesh account client (hosts intern aliases)
        self.ramesh_account = ZohoMailAccount(
            name="ramesh",
            client_id=os.getenv("ZOHO_RAMESH_CLIENT_ID", DEFAULT_ZOHO_RAMESH_CLIENT_ID),
            client_secret=os.getenv("ZOHO_RAMESH_CLIENT_SECRET", DEFAULT_ZOHO_RAMESH_CLIENT_SECRET),
            refresh_token=os.getenv("ZOHO_RAMESH_REFRESH_TOKEN", DEFAULT_ZOHO_RAMESH_REFRESH_TOKEN),
            account_id=os.getenv("ZOHO_RAMESH_ACCOUNT_ID", DEFAULT_ZOHO_RAMESH_ACCOUNT_ID),
            region=self.region,
        )

        # Vijay account client (hosts Vijay & Vansh aliases)
        self.vijay_account = ZohoMailAccount(
            name="vijay",
            client_id=os.getenv("ZOHO_VIJAY_CLIENT_ID", DEFAULT_ZOHO_VIJAY_CLIENT_ID),
            client_secret=os.getenv("ZOHO_VIJAY_CLIENT_SECRET", DEFAULT_ZOHO_VIJAY_CLIENT_SECRET),
            refresh_token=os.getenv("ZOHO_VIJAY_REFRESH_TOKEN", DEFAULT_ZOHO_VIJAY_REFRESH_TOKEN),
            account_id=os.getenv("ZOHO_VIJAY_ACCOUNT_ID", DEFAULT_ZOHO_VIJAY_ACCOUNT_ID),
            region=self.region,
        )

        self._alias_to_account: Dict[str, ZohoMailAccount] = {}
        self._folder_to_account: Dict[str, ZohoMailAccount] = {}
        self._overview_cache: Optional[Dict[str, Any]] = None
        self._overview_cache_ts: float = 0.0
        self._last_sync_ts: float = 0.0
        self._is_syncing: bool = False

    @property
    def account_id(self) -> str:
        return self.admin_account.account_id

    @account_id.setter
    def account_id(self, val: str):
        self.admin_account.account_id = val

    @property
    def accounts_base_url(self) -> str:
        return self.admin_account.accounts_base_url

    @property
    def mail_base_url(self) -> str:
        return self.admin_account.mail_base_url

    async def get_access_token(self, force_refresh: bool = False) -> str:
        return await self.admin_account.get_access_token(force_refresh=force_refresh)

    async def _request(self, method: str, path: str, **kwargs) -> Dict[str, Any]:
        return await self.admin_account._request(method, path, **kwargs)

    def get_account_for_from_address(self, from_addr: str) -> ZohoMailAccount:
        clean = (from_addr or "").strip().lower()
        if clean in self._alias_to_account:
            return self._alias_to_account[clean]
        ramesh_aliases = {
            "ramesh@zero7.space",
            "milan@zero7.space",
            "ravindra@zero7.space",
            "arbab@zero7.space",
            "lakshya@zero7.space",
            "nikhil@zero7.space",
            "hitesh.mourya@zero7.space",
        }
        vijay_aliases = {
            "vijay@zero7.space",
            "vansh@zero7.space",
        }
        if clean in ramesh_aliases:
            return self.ramesh_account
        if clean in vijay_aliases:
            return self.vijay_account
        return self.admin_account

    def get_account_for_folder(self, folder_id: str) -> ZohoMailAccount:
        fid = str(folder_id or "")
        if fid in self._folder_to_account:
            return self._folder_to_account[fid]
        if fid.startswith("6428"):
            return self.ramesh_account
        if fid.startswith("7627"):
            return self.vijay_account
        return self.admin_account

    async def get_account_overview(self, force_refresh: bool = False) -> Dict[str, Any]:
        now = time.time()
        if not force_refresh and self._overview_cache and (now - self._overview_cache_ts) < 300:
            return self._overview_cache

        import asyncio
        admin_ov, ramesh_ov, vijay_ov = await asyncio.gather(
            self.admin_account.get_overview(force_refresh=force_refresh),
            self.ramesh_account.get_overview(force_refresh=force_refresh),
            self.vijay_account.get_overview(force_refresh=force_refresh),
        )

        # Merge aliases & folder-to-account routes across all three accounts
        aliases_map = {}
        alias_to_account: Dict[str, ZohoMailAccount] = {}
        folder_to_account: Dict[str, ZohoMailAccount] = {}
        for acc, ov in (
            (self.admin_account, admin_ov),
            (self.ramesh_account, ramesh_ov),
            (self.vijay_account, vijay_ov),
        ):
            for a in (ov.get("aliases") or []):
                email_addr = a["email"]
                aliases_map[email_addr] = a
                alias_to_account[email_addr.lower()] = acc
            for f_info in (ov.get("folders") or {}).values():
                fid = str(f_info.get("folderId") or "")
                if fid:
                    folder_to_account[fid] = acc

        self._alias_to_account = alias_to_account
        self._folder_to_account = folder_to_account

        merged_aliases = list(aliases_map.values())
        merged_aliases.sort(key=lambda x: (0 if x.get("isPrimary") else 1, x.get("displayName", "")))

        self._overview_cache = {
            "accountId": self.admin_account.account_id,
            "primaryEmail": admin_ov.get("primaryEmail", "admin@zero7.space"),
            "displayName": admin_ov.get("displayName", "Zero7"),
            "aliases": merged_aliases,
            "folders": admin_ov.get("folders", {}),
            "rameshFolders": ramesh_ov.get("folders", {}),
            "vijayFolders": vijay_ov.get("folders", {}),
            "rawFolders": (
                (admin_ov.get("rawFolders") or [])
                + (ramesh_ov.get("rawFolders") or [])
                + (vijay_ov.get("rawFolders") or [])
            ),
        }
        self._overview_cache_ts = now
        return self._overview_cache

    def _classify_default_label(self, msg: Dict[str, Any], folder_key: str, custom_labels_map: Dict[str, str]) -> str:
        msg_id = str(msg.get("messageId") or "")
        if msg_id in custom_labels_map:
            return custom_labels_map[msg_id]

        subj = (msg.get("subject") or "").lower()
        from_addr = (msg.get("fromAddress") or "").lower()
        combined = f"{subj} {from_addr}"

        if folder_key == "newsletter" or any(w in combined for w in ("newsletter", "digest", "updates", "substack", "medium.com")):
            return "social"
        if folder_key == "notification" or any(w in combined for w in ("alert", "security", "github", "slack", "stripe", "razorpay", "login", "verify", "code", "invoice")):
            return "work"
        if any(w in combined for w in ("hi ", "hey ", "meeting", "call", "lunch", "coffee", "catchup")):
            return "friends"
        return "primary"

    def _match_aliases(self, msg: Dict[str, Any], known_aliases: List[str], is_outgoing: bool) -> List[str]:
        from_emails = _extract_emails(msg.get("fromAddress") or "")
        to_emails = _extract_emails(msg.get("toAddress") or "") + _extract_emails(msg.get("toAddr") or "")
        cc_emails = _extract_emails(msg.get("ccAddress") or "")

        matched = []
        if is_outgoing:
            for e in from_emails + cc_emails:
                if e in known_aliases and e not in matched:
                    matched.append(e)
        else:
            for e in to_emails + cc_emails + from_emails:
                if e in known_aliases and e not in matched:
                    matched.append(e)

        if not matched and known_aliases:
            if msg.get("_accountId") == self.ramesh_account.account_id:
                matched.append("ramesh@zero7.space")
            elif msg.get("_accountId") == self.vijay_account.account_id:
                matched.append("vijay@zero7.space")
            else:
                matched.append("admin@zero7.space")
        return matched

    def _clean_html_for_inline_images(
        self,
        html_content: str,
        folder_id: str,
        message_id: str,
        inline_images: List[Dict[str, Any]],
    ) -> str:
        if not html_content:
            return ""

        cid_map = {}
        for item in inline_images:
            c = str(item.get("cid") or "").strip().strip("<>").strip("&")
            att_id = str(item.get("attachmentId") or "")
            name = item.get("attachmentName") or ""
            if c:
                cid_map[c] = (att_id, name)
            if name:
                cid_map[name] = (att_id, name)

        def _replace_image_display(m):
            full_tag = m.group(0)
            url = m.group(1)
            cid_match = re.search(r"cid=([^&\"'\s>]+)", url)
            file_match = re.search(r"f=([^&\"'\s>]+)", url)
            cid_val = cid_match.group(1) if cid_match else ""
            f_val = file_match.group(1) if file_match else ""
            clean_cid = cid_val.strip().strip("&")
            clean_f = f_val.strip().strip("&")

            att_id = ""
            if clean_cid in cid_map:
                att_id = cid_map[clean_cid][0]
            elif clean_f in cid_map:
                att_id = cid_map[clean_f][0]

            new_src = f"/api/mail/inline-image/{folder_id}/{message_id}?cid={clean_cid}&f={clean_f}&att_id={att_id}"
            return full_tag.replace(url, new_src)

        cleaned = re.sub(r'src=["\']([^"\']*(?:/mail/ImageDisplay)[^"\']*)["\']', _replace_image_display, html_content)

        def _replace_cid(m):
            full_tag = m.group(0)
            cid_val = m.group(1).strip().strip("<>").strip("&")
            att_id = cid_map.get(cid_val, ("", ""))[0]
            new_src = f"/api/mail/inline-image/{folder_id}/{message_id}?cid={cid_val}&att_id={att_id}"
            return full_tag.replace(f"cid:{m.group(1)}", new_src)

        cleaned = re.sub(r'src=["\']cid:([^"\']+)["\']', _replace_cid, cleaned)
        return cleaned

    async def sync_emails_to_cache(self, force_refresh: bool = False) -> int:
        """
        Synchronizes all incoming and folder messages from Admin, Ramesh, and Vijay mailboxes
        into the server's SQLite DB concurrently.
        """
        if self._is_syncing:
            return Repository.get_cached_emails_count()

        self._is_syncing = True
        try:
            overview = await self.get_account_overview(force_refresh=force_refresh)
            admin_folders = overview.get("folders") or {}
            ramesh_folders = overview.get("rameshFolders") or {}
            vijay_folders = overview.get("vijayFolders") or {}

            # Map folder IDs across all synced accounts
            fid_to_key: Dict[str, str] = {}
            for f_dict in (admin_folders, ramesh_folders, vijay_folders):
                for name, f_info in f_dict.items():
                    fid_to_key[str(f_info.get("folderId"))] = name
                if "trash" in f_dict:
                    fid_to_key[str(f_dict["trash"]["folderId"])] = "bin"

            import asyncio

            async def _fetch_account_messages(acc: ZohoMailAccount, f_dict: Dict[str, Any]) -> List[Dict[str, Any]]:
                sent_fid = f_dict.get("sent", {}).get("folderId")
                drafts_fid = f_dict.get("drafts", {}).get("folderId")
                spam_fid = f_dict.get("spam", {}).get("folderId")
                trash_fid = f_dict.get("trash", {}).get("folderId")

                async def _safe(params: Dict[str, Any]):
                    try:
                        res = await acc._request("GET", f"/accounts/{acc.account_id}/messages/view", params=params)
                        data = res.get("data")
                        return data if isinstance(data, list) else []
                    except Exception as e:
                        logger.warning(f"[ZOHO MAIL - {acc.name}] Fetch view warning ({params}): {e}")
                        return []

                calls = [_safe({"limit": 150, "includeto": "true"})]
                if sent_fid:
                    calls.append(_safe({"folderId": sent_fid, "limit": 100, "includeto": "true"}))
                if drafts_fid:
                    calls.append(_safe({"folderId": drafts_fid, "limit": 50, "includeto": "true"}))
                if spam_fid:
                    calls.append(_safe({"folderId": spam_fid, "limit": 50, "includeto": "true"}))
                if trash_fid:
                    calls.append(_safe({"folderId": trash_fid, "limit": 50, "includeto": "true"}))

                batch_res = await asyncio.gather(*calls)
                combined = []
                for b in batch_res:
                    for item in b:
                        item["_accountId"] = acc.account_id
                        combined.append(item)
                return combined

            all_results = await asyncio.gather(
                _fetch_account_messages(self.admin_account, admin_folders),
                _fetch_account_messages(self.ramesh_account, ramesh_folders),
                _fetch_account_messages(self.vijay_account, vijay_folders),
            )

            by_id: Dict[str, Dict[str, Any]] = {}
            for batch in all_results:
                for item in batch:
                    mid = str(item.get("messageId") or "")
                    if mid and mid not in by_id:
                        by_id[mid] = item

            raw_list = list(by_id.values())
            for m in raw_list:
                fid = str(m.get("folderId") or "")
                m["_folderKey"] = fid_to_key.get(fid, "inbox")

            custom_labels_map, local_flags_map = Repository.get_mail_metadata_maps()
            aliases_list = [a["email"] for a in (overview.get("aliases") or [])]
            alias_display_map = {a["email"]: a["displayName"] for a in (overview.get("aliases") or [])}

            # Dynamically include registered team members/interns from database
            try:
                for u in (Repository.list_users() or []):
                    u_email = (u.get("email") or "").strip().lower()
                    if u_email and u_email not in aliases_list:
                        aliases_list.append(u_email)
                        alias_display_map[u_email] = u.get("name") or u_email.split("@")[0].title()
            except Exception:
                pass

            # Group thread counts: Use Zoho threadId if present; otherwise each email is its own thread
            thread_groups: Dict[str, List[str]] = {}
            for m in raw_list:
                mid = str(m.get("messageId") or "")
                tid = str(m.get("threadId") or "").strip()
                t_key = tid if (tid and tid.lower() != "none") else mid
                thread_groups.setdefault(t_key, []).append(mid)

            decorated_pool = []
            for m in raw_list:
                mid = str(m.get("messageId") or "")
                local_meta = local_flags_map.get(mid, {})

                folder_key = local_meta.get("folder_override") or m.get("_folderKey") or "inbox"
                is_outgoing = folder_key in ("sent", "drafts")

                from_emails = _extract_emails(m.get("fromAddress") or "")
                from_email = from_emails[0] if from_emails else ""
                to_raw = m.get("toAddress") or m.get("toAddr") or ""
                cc_raw = m.get("ccAddress") or ""
                to_emails = _extract_emails(to_raw)
                cc_emails = _extract_emails(cc_raw)

                matched_aliases = self._match_aliases(m, aliases_list, is_outgoing)
                if m.get("_accountId") == self.ramesh_account.account_id:
                    default_alias = "ramesh@zero7.space"
                elif m.get("_accountId") == self.vijay_account.account_id:
                    default_alias = "vijay@zero7.space"
                else:
                    default_alias = "admin@zero7.space"
                primary_alias = matched_aliases[0] if matched_aliases else default_alias
                primary_alias_name = alias_display_map.get(primary_alias, primary_alias.split("@")[0].title())

                flag_id = local_meta.get("flagid") or m.get("flagid") or "flag_not_set"
                is_starred = bool(local_meta.get("starred")) if "starred" in local_meta else (flag_id != "flag_not_set")
                is_important = (flag_id in ("important", "followup")) or folder_key == "notification" or str(m.get("priority")) == "1"

                is_unread = (
                    bool(local_meta.get("unread"))
                    if "unread" in local_meta
                    else (str(m.get("status")) == "0" and not is_outgoing)
                )

                label_id = self._classify_default_label(m, folder_key, custom_labels_map)
                sent_ts = int(m.get("receivedTime") or m.get("sentDateInGMT") or 0)

                tid = str(m.get("threadId") or "").strip()
                t_key = tid if (tid and tid.lower() != "none") else mid
                t_members = thread_groups.get(t_key, [mid])

                sender_name = _extract_primary_name(m.get("sender") or "", m.get("fromAddress") or "")
                recipient_name = _extract_primary_name("", to_raw) if to_raw else "Recipient"

                has_att = str(m.get("hasAttachment") or "0") == "1"
                has_inline = bool(m.get("hasInline")) or ("inline" in str(m.get("raw", "")).lower())

                decorated_pool.append({
                    "messageId": mid,
                    "folderId": str(m.get("folderId") or ""),
                    "folderKey": folder_key,
                    "threadId": tid,
                    "threadKey": t_key,
                    "threadCount": len(t_members),
                    "subject": html.unescape(str(m.get("subject") or "(No Subject)")),
                    "summary": html.unescape(str(m.get("summary") or "")).strip(),
                    "senderName": sender_name,
                    "recipientName": recipient_name,
                    "fromEmail": from_email,
                    "fromDisplay": _clean_display_address(m.get("fromAddress") or m.get("sender") or ""),
                    "toDisplay": _clean_display_address(to_raw),
                    "ccDisplay": _clean_display_address(cc_raw) if cc_raw != "Not Provided" else "",
                    "toEmails": to_emails,
                    "ccEmails": cc_emails,
                    "matchedAliases": matched_aliases,
                    "aliasEmail": primary_alias,
                    "aliasName": primary_alias_name,
                    "timestamp": sent_ts,
                    "isUnread": is_unread,
                    "isStarred": is_starred,
                    "isImportant": is_important,
                    "hasAttachment": has_att,
                    "hasInline": has_inline,
                    "label": label_id,
                    "size": int(m.get("size") or 0),
                    "rawJson": m,
                })

            Repository.save_cached_emails(decorated_pool)
            self._last_sync_ts = time.time()
            return len(decorated_pool)
        except Exception as e:
            logger.error(f"[ZOHO MAIL] Sync to cache failed: {e}")
            raise
        finally:
            self._is_syncing = False

    async def list_messages_and_counts(
        self,
        folder: str = "inbox",
        alias: str = "all",
        label: str = "",
        search: str = "",
        page: int = 1,
        limit: int = 12,
        custom_labels_map: Optional[Dict[str, str]] = None,
        local_flags_map: Optional[Dict[str, Dict[str, Any]]] = None,
        all_labels: Optional[List[Dict[str, Any]]] = None,
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        """
        Serves emails directly from SQLite server database.
        If cache is empty or force_refresh is True, syncs from Zoho once.
        """
        cached_count = Repository.get_cached_emails_count()
        now = time.time()

        if cached_count == 0 or force_refresh or (now - self._last_sync_ts > 600):
            try:
                await self.sync_emails_to_cache(force_refresh=force_refresh)
            except Exception as e:
                logger.warning(f"[ZOHO MAIL] Sync warning during list: {e}")

        overview = await self.get_account_overview()
        db_res = Repository.get_cached_emails_unified(
            folder=folder,
            alias=alias,
            label=label,
            search=search,
            page=page,
            limit=limit,
        )

        return {
            "accountId": overview.get("accountId"),
            "aliases": overview.get("aliases") or [],
            "aliasCounts": db_res["aliasCounts"],
            "folderCounts": db_res["counts"],
            "labels": all_labels or DEFAULT_LABELS,
            "messages": db_res["messages"],
            "pagination": {
                "page": db_res["page"],
                "limit": db_res["limit"],
                "total": db_res["total"],
                "start": db_res["start"],
                "end": db_res["end"],
                "totalPages": db_res["totalPages"],
            },
        }

    async def get_message_and_thread(
        self,
        folder_id: str,
        message_id: str,
        custom_labels_map: Optional[Dict[str, str]] = None,
        local_flags_map: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Fetches full thread from SQLite. If HTML body or attachment info is missing in SQLite,
        fetches from Zoho Mail API and stores in SQLite so subsequent views are 100% instant.
        """
        target = Repository.get_cached_email_by_id(message_id)
        if target:
            thread_key = target.get("thread_key") or target.get("threadKey") or str(message_id)
            thread_msgs = Repository.get_cached_thread_messages(thread_key)
            if not thread_msgs:
                thread_msgs = [target]
        else:
            # Sync once to find message if missing
            await self.sync_emails_to_cache(force_refresh=True)
            target = Repository.get_cached_email_by_id(message_id)
            if target:
                thread_key = target.get("thread_key") or str(message_id)
                thread_msgs = Repository.get_cached_thread_messages(thread_key) or [target]
            else:
                thread_msgs = [{
                    "messageId": str(message_id),
                    "folderId": str(folder_id),
                    "subject": "(Message not found)",
                    "summary": "This message is no longer in cache.",
                    "htmlContent": "<p>Message not found.</p>",
                    "attachments": [],
                    "inlineImages": [],
                    "timestamp": int(time.time() * 1000),
                }]

        import asyncio

        async def _ensure_full_body_and_attachments(msg_item: Dict[str, Any]) -> Dict[str, Any]:
            mid = str(msg_item.get("message_id") or msg_item.get("messageId"))
            fid = str(msg_item.get("folder_id") or msg_item.get("folderId") or folder_id)

            existing_html = msg_item.get("html_content") or msg_item.get("htmlContent")
            existing_atts = msg_item.get("attachments") or []
            existing_inline = msg_item.get("inlineImages") or []

            needs_content = not existing_html
            needs_att_info = (msg_item.get("has_attachment") or msg_item.get("hasAttachment")) and (not existing_atts and not existing_inline)

            fetched_html = existing_html
            fetched_atts = existing_atts
            fetched_inline = existing_inline

            if needs_content or needs_att_info:
                acc = self.get_account_for_folder(fid)
                if needs_content:
                    try:
                        c_res = await acc._request("GET", f"/accounts/{acc.account_id}/folders/{fid}/messages/{mid}/content")
                        fetched_html = (c_res.get("data") or {}).get("content") or msg_item.get("summary") or ""
                    except Exception as e:
                        logger.warning(f"[ZOHO MAIL] Body fetch fallback for {mid}: {e}")
                        fetched_html = f"<p>{html.escape(msg_item.get('summary') or '')}</p>"

                if needs_att_info:
                    try:
                        a_res = await acc._request("GET", f"/accounts/{acc.account_id}/folders/{fid}/messages/{mid}/attachmentinfo", params={"includeInline": "true"})
                        data = a_res.get("data") or {}
                        fetched_atts = data.get("attachments") or []
                        fetched_inline = data.get("inline") or []
                    except Exception as e:
                        logger.warning(f"[ZOHO MAIL] Attachment info fetch warning for {mid}: {e}")

                if fetched_html:
                    fetched_html = self._clean_html_for_inline_images(fetched_html, fid, mid, fetched_inline)

                Repository.update_cached_email_content(mid, fetched_html, fetched_atts, fetched_inline)

            clean_html = self._clean_html_for_inline_images(fetched_html or "", fid, mid, fetched_inline)

            res_item = dict(msg_item)
            res_item["messageId"] = mid
            res_item["folderId"] = fid
            res_item["htmlContent"] = clean_html
            res_item["attachments"] = fetched_atts
            res_item["inlineImages"] = fetched_inline
            res_item["isUnread"] = False
            return res_item

        populated_thread = await asyncio.gather(*[_ensure_full_body_and_attachments(m) for m in thread_msgs])

        # Mark as read locally and in Zoho
        Repository.update_mail_metadata([str(message_id)], "read")
        try:
            await self.perform_message_action([str(message_id)], "read")
        except Exception:
            pass

        primary_msg = next((m for m in populated_thread if m["messageId"] == str(message_id)), populated_thread[-1])
        return {
            "message": primary_msg,
            "thread": populated_thread,
        }

    async def get_inline_image(
        self,
        folder_id: str,
        message_id: str,
        cid: str = "",
        f_name: str = "",
        att_id: str = "",
    ) -> Tuple[bytes, str, str]:
        """Fetches inline image by attachment ID or matches cid/filename against cached attachment info."""
        if not att_id and (cid or f_name):
            thread_data = await self.get_message_and_thread(folder_id, message_id)
            msg = thread_data.get("message") or {}
            inline_list = msg.get("inlineImages") or []
            target_norm = (cid or f_name).strip().strip("<>").strip("&").lower()
            for item in inline_list:
                item_cid = str(item.get("cid") or "").strip().strip("<>").strip("&").lower()
                item_name = str(item.get("attachmentName") or "").strip().lower()
                if target_norm in (item_cid, item_name):
                    att_id = str(item.get("attachmentId") or "")
                    break

        if not att_id:
            cached_inline = Repository.get_cached_inline_image(folder_id, message_id, cid=cid, f_name=f_name)
            if cached_inline and cached_inline.get("blob_data"):
                blob = bytes(cached_inline["blob_data"])
                ctype = cached_inline.get("content_type") or detect_mime_type(blob)
                fname = cached_inline.get("filename") or f_name or f"inline_{cid}"
                return blob, ctype, fname

        content, true_ctype, true_fname = await self.download_attachment(folder_id, message_id, att_id or cid or f_name)
        return content, true_ctype, true_fname

    async def download_attachment(self, folder_id: str, message_id: str, attachment_id: str) -> Tuple[bytes, str, str]:
        """Downloads attachment, serving from SQLite cache or fetching from Zoho and caching."""
        if not folder_id:
            msg_meta = Repository.get_cached_email_by_id(message_id) or {}
            folder_id = msg_meta.get("folder_id") or msg_meta.get("folderId")
            if not folder_id:
                overview = await self.get_account_overview()
                folders = overview.get("folders") or {}
                folder_id = folders.get("inbox", {}).get("folderId", "1914516000000002014")

        cached = Repository.get_cached_attachment(folder_id, message_id, attachment_id=attachment_id)
        if cached and cached.get("blob_data"):
            blob = bytes(cached["blob_data"])
            fname = cached.get("filename") or f"attachment_{attachment_id}"
            ctype = cached.get("content_type") or detect_mime_type(blob, fname)
            return blob, ctype, fname

        acc = self.get_account_for_folder(folder_id)
        token = await acc.get_access_token()
        url = f"{acc.mail_base_url}/accounts/{acc.account_id}/folders/{folder_id}/messages/{message_id}/attachments/{attachment_id}"
        headers = {"Authorization": f"Zoho-oauthtoken {token}"}
        async with httpx.AsyncClient(timeout=35.0) as client:
            res = await client.get(url, headers=headers)
            if res.status_code != 200:
                raise RuntimeError(f"Failed to download attachment from Zoho: {res.status_code}")

            cd = res.headers.get("content-disposition", "")
            filename = f"attachment_{attachment_id}"
            m = re.search(r'filename="?([^";]+)"?', cd)
            if m:
                filename = m.group(1).strip()

            content = res.content
            content_type = detect_mime_type(content, filename)

            Repository.save_cached_attachment(
                folder_id=folder_id,
                message_id=message_id,
                attachment_id=attachment_id,
                filename=filename,
                content_type=content_type,
                blob_data=content,
                is_inline=False,
            )
            return content, content_type, filename

    async def upload_attachment(
        self,
        file_bytes: bytes,
        filename: str,
        content_type: str = "application/octet-stream",
        from_address: str = "",
    ) -> Dict[str, Any]:
        """Uploads an attachment to Zoho Mail staging for compose attachment."""
        acc = self.get_account_for_from_address(from_address)
        token = await acc.get_access_token()
        url = f"{acc.mail_base_url}/accounts/{acc.account_id}/messages/attachments?uploadType=multipart"
        headers = {"Authorization": f"Zoho-oauthtoken {token}"}
        files = {"attach": (filename, file_bytes, content_type)}

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(url, headers=headers, files=files)
            if res.status_code != 200:
                raise RuntimeError(f"Failed to upload attachment to Zoho: {res.status_code} - {res.text}")
            data = res.json().get("data") or {}
            return {
                "attachmentId": data.get("attachmentId") or data.get("storeName"),
                "attachmentName": filename,
                "attachmentSize": len(file_bytes),
                "contentType": content_type,
                "storeName": data.get("storeName"),
            }

    async def send_mail(
        self,
        from_address: str,
        to_address: str,
        subject: str,
        content: str,
        cc_address: str = "",
        bcc_address: str = "",
        in_reply_to: str = "",
        action: str = "",
        attachments: Optional[List[Dict[str, Any]]] = None,
        raw_files: Optional[List[Tuple[str, bytes, str]]] = None,
    ) -> Dict[str, Any]:
        """
        Sends an email via Zoho Mail API and immediately stores the sent message in SQLite.
        Routes through Ramesh account if from_address is an intern/Ramesh alias.
        """
        overview = await self.get_account_overview()
        valid_aliases = {a["email"]: a for a in (overview.get("aliases") or [])}
        clean_from = (from_address or "admin@zero7.space").strip().lower()
        if clean_from not in valid_aliases:
            clean_from = "admin@zero7.space"

        acc = self.get_account_for_from_address(clean_from)

        to_emails = _extract_emails(to_address)
        clean_to = ", ".join(to_emails) if to_emails else to_address.strip()

        cc_emails = _extract_emails(cc_address)
        clean_cc = ", ".join(cc_emails) if cc_emails else cc_address.strip()

        bcc_emails = _extract_emails(bcc_address)
        clean_bcc = ", ".join(bcc_emails) if bcc_emails else bcc_address.strip()

        html_content = content
        if "<" not in content and ">" not in content:
            html_content = (
                "<div style='font-family:Inter,system-ui,sans-serif;font-size:14px;color:#1e293b;line-height:1.6;'>"
                + "<br>".join(html.escape(line) for line in content.splitlines())
                + "</div>"
            )

        final_attachments = list(attachments or [])
        if raw_files:
            for fname, fbytes, ftype in raw_files:
                try:
                    uploaded = await self.upload_attachment(fbytes, fname, ftype, from_address=clean_from)
                    final_attachments.append(uploaded)
                except Exception as e:
                    logger.error(f"[ZOHO MAIL] Failed to upload {fname}: {e}")
                    raise RuntimeError(f"Failed to attach {fname}: {str(e)}")

        payload: Dict[str, Any] = {
            "fromAddress": clean_from,
            "toAddress": clean_to,
            "subject": subject.strip() or "(No Subject)",
            "content": html_content,
            "mailFormat": "html",
        }
        if clean_cc:
            payload["ccAddress"] = clean_cc
        if clean_bcc:
            payload["bccAddress"] = clean_bcc
        if final_attachments:
            payload["attachments"] = final_attachments

        sent_msg_id = None
        if in_reply_to and action in ("reply", "replyall", "forward"):
            payload["action"] = action
            payload["inReplyTo"] = str(in_reply_to)
            try:
                res = await acc._request(
                    "POST",
                    f"/accounts/{acc.account_id}/messages/{in_reply_to}",
                    json_body=payload,
                )
                sent_msg_id = (res.get("data") or {}).get("messageId")
            except Exception as e:
                logger.warning(f"[ZOHO MAIL] Reply endpoint fallback to standard send: {e}")
                payload.pop("action", None)
                res = await acc._request("POST", f"/accounts/{acc.account_id}/messages", json_body=payload)
                sent_msg_id = (res.get("data") or {}).get("messageId")
        else:
            res = await acc._request("POST", f"/accounts/{acc.account_id}/messages", json_body=payload)
            sent_msg_id = (res.get("data") or {}).get("messageId")

        # Immediately persist the newly sent email to SQLite cache in 'sent' folder
        try:
            new_mid = str(sent_msg_id or int(time.time() * 1000))
            if acc == self.admin_account:
                folders = overview.get("folders")
                default_sent_fid = "1914516000000002022"
            elif acc == self.ramesh_account:
                folders = overview.get("rameshFolders", {})
                default_sent_fid = "6428066000000002012"
            else:
                folders = overview.get("vijayFolders", {})
                default_sent_fid = "7627792000000002012"
            sent_fid = (folders or {}).get("sent", {}).get("folderId", default_sent_fid)
            t_key = new_mid
            t_id = ""

            if in_reply_to:
                parent_meta = Repository.get_cached_email_by_id(str(in_reply_to))
                if parent_meta:
                    t_key = parent_meta.get("thread_key") or str(in_reply_to)
                    t_id = parent_meta.get("thread_id") or ""

            sent_record = {
                "messageId": new_mid,
                "folderId": sent_fid,
                "folderKey": "sent",
                "threadId": t_id,
                "threadKey": t_key,
                "threadCount": 1,
                "subject": subject.strip() or "(No Subject)",
                "summary": re.sub(r"<[^>]+>", " ", html_content).strip()[:180],
                "senderName": (valid_aliases.get(clean_from) or {}).get("displayName") or clean_from.split("@")[0].title(),
                "recipientName": _extract_primary_name("", clean_to),
                "fromEmail": clean_from,
                "fromDisplay": clean_from,
                "toDisplay": clean_to,
                "ccDisplay": clean_cc,
                "toEmails": to_emails,
                "ccEmails": cc_emails,
                "matchedAliases": [clean_from],
                "aliasEmail": clean_from,
                "aliasName": (valid_aliases.get(clean_from) or {}).get("displayName") or clean_from.split("@")[0].title(),
                "timestamp": int(time.time() * 1000),
                "isUnread": False,
                "isStarred": False,
                "isImportant": False,
                "hasAttachment": bool(final_attachments),
                "hasInline": False,
                "label": "primary",
                "size": len(html_content.encode("utf-8")),
                "htmlContent": html_content,
                "attachments": final_attachments,
                "inlineImages": [],
                "rawJson": {
                    "messageId": new_mid,
                    "folderId": sent_fid,
                    "fromAddress": clean_from,
                    "toAddress": clean_to,
                    "subject": subject,
                    "receivedTime": int(time.time() * 1000),
                    "_accountId": acc.account_id,
                },
            }
            Repository.save_cached_emails([sent_record])
        except Exception as e:
            logger.warning(f"[ZOHO MAIL] Post-send cache persistence warning: {e}")

        return res

    async def perform_message_action(self, message_ids: List[str], action: str) -> Dict[str, Any]:
        """Performs batch action (read, unread, flag, unflag, delete, archive) in local SQLite and Zoho."""
        if not message_ids:
            return {"status": "ok", "updated": 0}

        clean_action = action.lower()
        count = Repository.update_mail_metadata(message_ids, clean_action)

        for mid in message_ids:
            try:
                msg_meta = Repository.get_cached_email_by_id(mid) or {}
                fid = msg_meta.get("folder_id") or msg_meta.get("folderId")
                acc = self.get_account_for_folder(fid)

                zoho_action_map = {
                    "read": "markAsRead",
                    "unread": "markAsUnread",
                    "flag": "flag",
                    "unflag": "unflag",
                    "delete": "delete",
                }
                mode = zoho_action_map.get(clean_action)
                if mode:
                    payload = {"messageId": [str(mid)], "mode": mode}
                    await acc._request("PUT", f"/accounts/{acc.account_id}/updatemessage", json_body=payload)
            except Exception as e:
                logger.warning(f"[ZOHO MAIL] Action {clean_action} warning on {mid}: {e}")

        return {"status": "ok", "updated": count}


zoho_mail_manager = ZohoMailManager()
