"""
Zero7 CRM - Google Tasks Integration Module
Handles OAuth2 user authorization, token refresh, and bi-directional sync
with Google Tasks API for real-time mobile widget display.
"""

import os
import json
import logging
import requests
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

TASKS_SCOPE = "https://www.googleapis.com/auth/tasks"
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
TASKS_API_BASE = "https://tasks.googleapis.com/tasks/v1"

TASK_LIST_TITLE = "Zero7 CRM Leads"


def get_auth_url(client_id: str, redirect_uri: str, state: str = "zero7_gtasks") -> str:
    """Generate the Google OAuth2 consent URL for user authorization."""
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": TASKS_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    query = "&".join(f"{k}={requests.utils.quote(str(v))}" for k, v in params.items())
    return f"{GOOGLE_AUTH_URL}?{query}"


def exchange_code_for_tokens(
    client_id: str,
    client_secret: str,
    code: str,
    redirect_uri: str
) -> Optional[Dict[str, Any]]:
    """Exchange authorization code for access and refresh tokens."""
    try:
        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        }
        res = requests.post(GOOGLE_TOKEN_URL, data=data, timeout=15)
        if res.status_code == 200:
            return res.json()
        logger.error(f"Failed to exchange Google OAuth code: {res.status_code} - {res.text}")
        return None
    except Exception as e:
        logger.error(f"OAuth token exchange error: {e}")
        return None


def refresh_access_token(
    client_id: str,
    client_secret: str,
    refresh_token: str
) -> Optional[Dict[str, Any]]:
    """Obtain a new access token using the stored refresh token."""
    try:
        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
        res = requests.post(GOOGLE_TOKEN_URL, data=data, timeout=15)
        if res.status_code == 200:
            return res.json()
        logger.error(f"Failed to refresh Google access token: {res.status_code} - {res.text}")
        return None
    except Exception as e:
        logger.error(f"OAuth token refresh error: {e}")
        return None


class GoogleTasksClient:
    """Client for managing Google Tasks API calls with automatic token refresh."""

    def __init__(self, config: Dict[str, Any], save_token_callback=None):
        self.client_id = config.get("client_id")
        self.client_secret = config.get("client_secret")
        self.access_token = config.get("access_token")
        self.refresh_token = config.get("refresh_token")
        self.task_list_id = config.get("task_list_id")
        self.save_token_callback = save_token_callback

    def _get_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }

    def _ensure_valid_token(self) -> bool:
        """Verify token works; if expired (401), refresh and update."""
        if not self.access_token and self.refresh_token:
            return self._do_refresh()
        return True

    def _do_refresh(self) -> bool:
        if not self.refresh_token or not self.client_id or not self.client_secret:
            return False
        tokens = refresh_access_token(self.client_id, self.client_secret, self.refresh_token)
        if tokens and "access_token" in tokens:
            self.access_token = tokens["access_token"]
            if self.save_token_callback:
                self.save_token_callback(self.access_token, tokens.get("expires_in"))
            return True
        return False

    def _request(self, method: str, endpoint: str, **kwargs) -> Optional[requests.Response]:
        url = f"{TASKS_API_BASE}{endpoint}"
        headers = self._get_headers()
        res = requests.request(method, url, headers=headers, **kwargs)
        if res.status_code == 401:
            # Token might have expired, try refreshing once
            if self._do_refresh():
                headers = self._get_headers()
                res = requests.request(method, url, headers=headers, **kwargs)
        return res

    def ensure_tasklist(self) -> Optional[str]:
        """Find or create the 'Zero7 CRM Leads' task list."""
        self._ensure_valid_token()
        # 1. List existing lists
        res = self._request("GET", "/users/@me/lists")
        if res and res.status_code == 200:
            items = res.json().get("items", [])
            for item in items:
                if item.get("title") == TASK_LIST_TITLE:
                    self.task_list_id = item.get("id")
                    return self.task_list_id

        # 2. Not found, create it
        res = self._request("POST", "/users/@me/lists", json={"title": TASK_LIST_TITLE})
        if res and res.status_code in (200, 201):
            data = res.json()
            self.task_list_id = data.get("id")
            return self.task_list_id

        # Fallback to default list
        return "@default"

    def create_or_update_lead_task(self, lead: Dict[str, Any]) -> Optional[str]:
        """
        Create or update a Google Task for a lead's next action.
        Returns the google_task_id or None on failure.
        """
        if not self._ensure_valid_token():
            return None

        list_id = self.task_list_id or self.ensure_tasklist() or "@default"
        lead_id = lead.get("id", "")
        lead_name = lead.get("name", "Unnamed Lead")
        biz_name = lead.get("business_name", "")
        phone = lead.get("phone", "")
        next_action = lead.get("next_action")
        deadline = lead.get("next_action_date", "Pending")
        priority = (lead.get("next_action_priority") or lead.get("priority") or "medium").upper()
        existing_task_id = lead.get("google_task_id")

        if not next_action:
            return None

        # Build clean title and rich notes for mobile widget
        priority_emoji = "🔴" if priority == "HIGH" else ("🟡" if priority == "MEDIUM" else "⚪")
        title = f"{priority_emoji} [{priority}] {next_action} - {lead_name}"

        notes_lines = [
            f"👤 Lead: {lead_name} ({biz_name})" if biz_name else f"👤 Lead: {lead_name}",
            f"📞 Phone: {phone}" if phone else "📞 Phone: N/A",
            f"⏰ Deadline: {deadline}",
            f"🔗 CRM: https://cos.zero7.space/#/leads/{lead_id}",
        ]
        if lead.get("last_update_notes"):
            notes_lines.append(f"📝 Notes: {lead['last_update_notes']}")

        task_body = {
            "title": title,
            "notes": "\n".join(notes_lines),
            "status": "needsAction",
        }

        # Try to parse deadline into RFC 3339 timestamp if possible
        # e.g., if it contains a recognizable date
        try:
            # Format: YYYY-MM-DDTHH:MM:SS.000Z
            # If deadline has an ISO format or simple date
            if "202" in deadline:
                dt = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
                task_body["due"] = dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
        except Exception:
            pass  # Fallback: leave notes with human deadline string

        try:
            if existing_task_id:
                # Update existing task
                res = self._request("PATCH", f"/lists/{list_id}/tasks/{existing_task_id}", json=task_body)
                if res and res.status_code == 200:
                    logger.info(f"Updated Google Task {existing_task_id} for lead {lead_id}")
                    return existing_task_id
                # If not found (404), fall through to create

            # Insert new task
            res = self._request("POST", f"/lists/{list_id}/tasks", json=task_body)
            if res and res.status_code in (200, 201):
                new_id = res.json().get("id")
                logger.info(f"Created Google Task {new_id} for lead {lead_id}")
                return new_id
            else:
                logger.error(f"Failed to create Google Task: {res.status_code if res else 'No res'} - {res.text if res else ''}")
        except Exception as e:
            logger.error(f"Error syncing task to Google Tasks: {e}")

        return None

    def sync_all_lead_tasks(self, leads: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Sync tasks for all leads that have a next_action."""
        synced = 0
        failed = 0
        task_ids = {}
        for lead in leads:
            if lead.get("next_action"):
                tid = self.create_or_update_lead_task(lead)
                if tid:
                    synced += 1
                    task_ids[lead["id"]] = tid
                else:
                    failed += 1
        return {"total_leads": len(leads), "synced": synced, "failed": failed, "task_ids": task_ids}

    def check_completed_tasks(self) -> List[str]:
        """Check the Google Tasks list for tasks marked 'completed' on phone."""
        if not self._ensure_valid_token():
            return []

        list_id = self.task_list_id or self.ensure_tasklist() or "@default"
        res = self._request("GET", f"/lists/{list_id}/tasks?showCompleted=true&showHidden=true")
        completed_ids = []
        if res and res.status_code == 200:
            items = res.json().get("items", [])
            for item in items:
                if item.get("status") == "completed":
                    completed_ids.append(item.get("id"))
        return completed_ids
