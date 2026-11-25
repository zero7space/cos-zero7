"""
Integration tests for WhatsApp API endpoints.
"""

import pytest


class TestWhatsAppAPI:
    def test_list_whatsapp_accounts(self, client, auth_headers):
        res = client.get("/api/whatsapp/accounts", headers=auth_headers)
        assert res.status_code == 200
        accounts = res.json()
        assert isinstance(accounts, list)

    def test_sync_whatsapp_messages(self, client, sample_lead, auth_headers):
        # Create lead first
        res = client.post("/api/leads", json=sample_lead, headers=auth_headers)
        assert res.status_code == 200
        lead_id = res.json().get("id") or res.json().get("lead", {}).get("id")

        # Sync a message
        payload = {
            "account_phone": "9993202900",
            "messages": [
                {
                    "lead_phone": sample_lead["phone"],
                    "direction": "inbound",
                    "message_text": "Hello, need CRM demo",
                    "timestamp": "2026-10-03T10:00:00Z",
                    "wa_message_id": "wa_msg_test_001",
                }
            ]
        }
        sync_res = client.post("/api/whatsapp/messages/sync", json=payload)
        assert sync_res.status_code == 200
        sync_data = sync_res.json()
        assert sync_data.get("status") == "ok"
        assert sync_data.get("total_sent") == 1

        # Check lead whatsapp messages
        wa_res = client.get(f"/api/leads/{lead_id}/whatsapp", headers=auth_headers)
        assert wa_res.status_code == 200
        wa_data = wa_res.json()
        assert "messages" in wa_data
        assert "accounts" in wa_data
