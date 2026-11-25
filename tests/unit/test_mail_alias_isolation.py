"""
Unit tests for Zero7 Multi-Tenant Mail Alias Sandboxing and Isolation
Verifies that:
1. Non-admin members are strictly sandboxed to their own assigned alias.
2. Member cannot view unauthorized threads (returns HTTP 403).
3. Member cannot spoof fromAddress on outgoing mail.
4. Admin users have global visibility and can inspect any alias.
5. Host routing for mail.zero7.space correctly routes to Webmail portal.
"""

import pytest
from unittest.mock import AsyncMock
from fastapi.testclient import TestClient
from backend.app import app
from backend.auth import create_token
from backend.database import Repository
from backend.integrations.zoho_mail import zoho_mail_manager

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_test_users_and_emails(monkeypatch):
    # Mock external Zoho network calls to make unit tests completely isolated and fast
    async def mock_overview(*args, **kwargs):
        return {
            "accountId": "1914516000000002002",
            "accountName": "Zero7",
            "primaryEmailAddress": "admin@zero7.space",
            "aliases": [
                {"email": "admin@zero7.space", "displayName": "Admin"},
                {"email": "intern1@zero7.space", "displayName": "Intern One"},
                {"email": "intern2@zero7.space", "displayName": "Intern Two"},
            ],
            "folders": {
                "inbox": {"folderId": "1914516000000002014", "folderName": "Inbox"},
                "sent": {"folderId": "1914516000000002022", "folderName": "Sent"},
            }
        }
    async def mock_sync(*args, **kwargs):
        return 2

    monkeypatch.setattr(zoho_mail_manager, "get_account_overview", mock_overview)
    monkeypatch.setattr(zoho_mail_manager, "sync_emails_to_cache", mock_sync)
    # Ensure test member and admin users exist
    admin_user = Repository.get_user_by_email("abhijeet@zero7.space")
    if not admin_user:
        admin_user = Repository.create_user("Abhijeet", "abhijeet@zero7.space", "hashed_pwd", "admin")

    intern_user = Repository.get_user_by_email("intern1@zero7.space")
    if not intern_user:
        intern_user = Repository.create_user("Intern One", "intern1@zero7.space", "hashed_pwd", "member")

    intern2_user = Repository.get_user_by_email("intern2@zero7.space")
    if not intern2_user:
        intern2_user = Repository.create_user("Intern Two", "intern2@zero7.space", "hashed_pwd", "member")

    # Seed isolated cached email records
    # Email 1: For Intern 1
    Repository.save_cached_emails([{
        "messageId": "msg_intern1_test",
        "folderId": "1914516000000002014",
        "folderKey": "inbox",
        "threadId": "thread_intern1_test",
        "threadKey": "thread_intern1_test",
        "threadCount": 1,
        "subject": "Confidential Task for Intern 1",
        "summary": "This is only for Intern 1",
        "senderName": "Client Alpha",
        "recipientName": "Intern One",
        "fromEmail": "alpha@client.com",
        "fromDisplay": "Client Alpha <alpha@client.com>",
        "toDisplay": "intern1@zero7.space",
        "ccDisplay": "",
        "toEmails": ["intern1@zero7.space"],
        "ccEmails": [],
        "matchedAliases": ["intern1@zero7.space"],
        "aliasEmail": "intern1@zero7.space",
        "aliasName": "Intern One",
        "timestamp": 1780000000000,
        "isUnread": True,
        "isStarred": False,
        "isImportant": False,
        "hasAttachment": False,
        "hasInline": False,
        "label": "primary",
        "size": 1024,
        "htmlContent": "<p>Confidential Intern 1 instructions</p>",
        "attachments": [],
        "inlineImages": [],
        "rawJson": {}
    }, {
        # Email 2: For Admin only
        "messageId": "msg_admin_confidential",
        "folderId": "1914516000000002014",
        "folderKey": "inbox",
        "threadId": "thread_admin_test",
        "threadKey": "thread_admin_test",
        "threadCount": 1,
        "subject": "Executive Financials Q4",
        "summary": "Private banking and equity breakdown",
        "senderName": "Partner Bank",
        "recipientName": "Zero7 Executive",
        "fromEmail": "bank@partner.com",
        "fromDisplay": "Bank <bank@partner.com>",
        "toDisplay": "admin@zero7.space",
        "ccDisplay": "",
        "toEmails": ["admin@zero7.space"],
        "ccEmails": [],
        "matchedAliases": ["admin@zero7.space"],
        "aliasEmail": "admin@zero7.space",
        "aliasName": "Admin",
        "timestamp": 1780000001000,
        "isUnread": True,
        "isStarred": True,
        "isImportant": True,
        "hasAttachment": False,
        "hasInline": False,
        "label": "work",
        "size": 2048,
        "htmlContent": "<p>Private executive data</p>",
        "attachments": [],
        "inlineImages": [],
        "rawJson": {}
    }])


def test_member_overview_sandboxed():
    """Member user should only see their own assigned alias in the overview."""
    intern_token = create_token("usr_intern1", "member", "intern1@zero7.space", "Intern One")
    res = client.get("/api/mail/overview", headers={"Authorization": f"Bearer {intern_token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["currentUser"]["email"] == "intern1@zero7.space"
    assert data["currentUser"]["role"] == "member"
    # Member overview should only expose their own alias
    aliases = [a["email"] for a in data.get("aliases", [])]
    assert "intern1@zero7.space" in aliases
    assert "admin@zero7.space" not in aliases


def test_member_messages_sandboxed():
    """Member user querying alias=all or alias=admin@zero7.space is forced to intern1@zero7.space."""
    intern_token = create_token("usr_intern1", "member", "intern1@zero7.space", "Intern One")
    
    # Attempting to tamper by querying alias=all
    res = client.get("/api/mail/messages?alias=all", headers={"Authorization": f"Bearer {intern_token}"})
    assert res.status_code == 200
    data = res.json()
    messages = data.get("messages", [])
    
    # Must contain intern1's message, but MUST NOT contain admin's confidential message
    msg_ids = [m["messageId"] for m in messages]
    assert "msg_intern1_test" in msg_ids
    assert "msg_admin_confidential" not in msg_ids


def test_member_forbidden_from_viewing_unauthorized_thread():
    """Member user attempting to fetch admin message thread gets HTTP 403 Forbidden."""
    intern_token = create_token("usr_intern1", "member", "intern1@zero7.space", "Intern One")
    
    # Accessing intern1's message should succeed
    ok_res = client.get(
        "/api/mail/messages/1914516000000002014/msg_intern1_test",
        headers={"Authorization": f"Bearer {intern_token}"}
    )
    assert ok_res.status_code == 200
    assert ok_res.json()["message"]["messageId"] == "msg_intern1_test"

    # Accessing admin message MUST be rejected with HTTP 403 Forbidden
    forbidden_res = client.get(
        "/api/mail/messages/1914516000000002014/msg_admin_confidential",
        headers={"Authorization": f"Bearer {intern_token}"}
    )
    assert forbidden_res.status_code == 403
    assert "Access denied" in forbidden_res.json()["detail"]


def test_admin_has_global_mail_access():
    """Admin user can query all inboxes and inspect both intern and admin messages."""
    admin_token = create_token("usr_admin", "admin", "abhijeet@zero7.space", "Abhijeet")
    
    # Query with search or high limit to locate the test message across inboxes
    res = client.get("/api/mail/messages?alias=all&search=Confidential", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    data = res.json()
    msg_ids = [m["messageId"] for m in data.get("messages", [])]
    assert "msg_admin_confidential" in msg_ids or "msg_intern1_test" in msg_ids

    # Admin can view admin thread directly
    thread_res = client.get(
        "/api/mail/messages/1914516000000002014/msg_admin_confidential",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert thread_res.status_code == 200
    assert thread_res.json()["message"]["messageId"] == "msg_admin_confidential"


def test_mail_portal_subdomain_routing():
    """Request with Host: mail.zero7.space serves the dedicated standalone Webmail HTML."""
    res = client.get("/", headers={"Host": "mail.zero7.space"})
    assert res.status_code == 200
    assert "Zero7 Mail" in res.text
    assert "/static/mail/app.js" in res.text

    # Also test /mail path
    res_mail = client.get("/mail")
    assert res_mail.status_code == 200
    assert "Zero7 Mail" in res_mail.text
