"""Unit and API safety tests for inline lead field updates and Sheet-sync lock protection."""

import csv
import io
import json
import uuid
import pytest
from unittest.mock import patch
from backend.database import Repository


def _make_sample_lead(suffix=None, **overrides):
    tag = suffix or uuid.uuid4().hex[:6]
    data = {
        "name": f"Inline Test Lead {tag}",
        "business_name": f"Inline Co {tag}",
        "phone": f"+9198{uuid.uuid4().hex[:8]}",
        "email": f"inline_{tag}@example.com",
        "city": "Mumbai",
        "priority": "high",
        "status": "contacted",
        "call_stage": "first_call",
        "temperature": "warm",
        "next_action": "First call follow-up",
        "last_update_notes": "Initial sheet remark",
        "channel_data": {
            "leadgen_id": f"lg_{tag}",
            "ad_name": "Ad 6: Thinking of integrating AI",
            "adset_name": "MSME & Manufacturers",
            "sheet_priority": "high",
            "sheet_updates": "Initial sheet remark",
            "sheet_next_step": "First call follow-up",
        },
    }
    data.update(overrides)
    return Repository.create_lead(data)


def test_update_lead_nullable_owner_and_phone_normalization():
    users = Repository.list_users()
    assert users, "Seeded user required for FK owner assignment test"
    owner_id = users[0]["id"]
    lead = _make_sample_lead(assigned_to=owner_id)

    try:
        # 1. Explicit None unassigns owner cleanly under PRAGMA foreign_keys = ON
        updated = Repository.update_lead(lead["id"], {"assigned_to": None}, mark_crm_locks=True)
        assert updated["assigned_to"] is None

        # 2. Empty string also normalizes to None instead of violating FK constraint
        reassigned = Repository.update_lead(lead["id"], {"assigned_to": owner_id})
        assert reassigned["assigned_to"] == owner_id
        cleared_empty = Repository.update_lead(lead["id"], {"assigned_to": ""})
        assert cleared_empty["assigned_to"] is None

        # 3. Phone update keeps phone_normalized in sync
        phone_updated = Repository.update_lead(lead["id"], {"phone": "+91 91234-56789"})
        assert phone_updated["phone_normalized"] == "9123456789"
        matched = Repository.get_lead_by_phone("9123456789")
        assert matched and matched["id"] == lead["id"]

        # 4. Empty name invariant is enforced
        with pytest.raises(ValueError):
            Repository.update_lead(lead["id"], {"name": "   "})
    finally:
        Repository.delete_lead(lead["id"])


def test_crm_locked_fields_survive_sheet_sync_and_preserve_meta_attribution():
    lead = _make_sample_lead(phone="+919777711122")
    try:
        updated = Repository.update_lead(
            lead["id"],
            {
                "priority": "medium",
                "next_action": "Prototype needed",
                "last_update_notes": "Spoke with founder, wants live quarry demo",
            },
            mark_crm_locks=True,
        )
        cd = updated["channel_data"]
        assert cd["ad_name"] == "Ad 6: Thinking of integrating AI"
        assert cd["adset_name"] == "MSME & Manufacturers"
        assert set(["priority", "next_action", "last_update_notes"]).issubset(cd["crm_locked_fields"].keys())

        # Build mock Google Sheet CSV matching the exact column indices used by sync_sheet_priorities
        headers = [
            "id", "created_time", "ad_id", "ad_name", "adset_id", "adset_name",
            "campaign_id", "campaign_name", "form_id", "form_name", "is_organic", "platform",
            "what_does_your_business_do?", "are_you_currently_managing_work_in_excel,_tally_or_paper_registers?",
            "what_is_your_approximate_monthly_revenue?", "full_name", "NEXT STEP", "Priority",
            "phone_number", "company_name", "email", "city", "UPDATES", "MEETING", "Call Brief"
        ]
        row_same_sheet = [
            f"l:{cd['leadgen_id']}", "2026-11-10T10:00:00Z", "ag:1", "Ad 6: Thinking of integrating AI",
            "as:2", "MSME & Manufacturers", "c:3", "Sep Quality", "f:4", "Lead form", "false", "ig",
            "manufacturing", "yes", "11-50", lead["name"], "First call follow-up", "high",
            "p:+919777711122", lead["business_name"], lead["email"], "Mumbai", "Initial sheet remark", "N", ""
        ]
        def _to_csv(hdrs, r):
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(hdrs)
            w.writerow(r)
            return buf.getvalue()

        csv_body = _to_csv(headers, row_same_sheet)

        class _FakeResp:
            def read(self):
                return csv_body.encode("utf-8")

        with patch("urllib.request.urlopen", return_value=_FakeResp()):
            Repository.sync_sheet_priorities()

        after_same = Repository.get_lead(lead["id"])
        assert after_same["priority"] == "medium"
        assert after_same["next_action"] == "Prototype needed"
        assert after_same["last_update_notes"] == "Spoke with founder, wants live quarry demo"
        assert after_same["channel_data"]["ad_name"] == "Ad 6: Thinking of integrating AI"

        # If Google Sheet itself changes to a genuinely new priority later, sync updates cleanly
        row_newer_sheet = list(row_same_sheet)
        row_newer_sheet[17] = "won"
        csv_newer = _to_csv(headers, row_newer_sheet)

        class _FakeRespNewer:
            def read(self):
                return csv_newer.encode("utf-8")

        with patch("urllib.request.urlopen", return_value=_FakeRespNewer()):
            Repository.sync_sheet_priorities()

        after_newer = Repository.get_lead(lead["id"])
        assert after_newer["priority"] == "won"
    finally:
        Repository.delete_lead(lead["id"])


def test_put_lead_rbac_and_notes_endpoint_permissions(client, auth_headers):
    from backend.auth import hash_password, create_token

    member_email = f"member_{uuid.uuid4().hex[:6]}@zero7.space"
    member = Repository.create_user("Member User", member_email, hash_password("pass1234"), "member")
    member_headers = {"Authorization": f"Bearer {create_token(member['id'], 'member', member['email'], 'Member User')}"}

    lead = _make_sample_lead(assigned_to=member["id"])
    other_lead = _make_sample_lead(assigned_to=None)

    try:
        # Member cannot reassign owner via PUT /api/leads/{id}
        res = client.put(f"/api/leads/{lead['id']}", json={"assigned_to": None}, headers=member_headers)
        assert res.status_code == 403

        # Member cannot add note to unassigned/other lead
        res_note = client.post(f"/api/leads/{other_lead['id']}/notes", json={"content": "Unauthorized"}, headers=member_headers)
        assert res_note.status_code == 403

        # Admin can reassign to None cleanly and blank name returns 400
        res_admin = client.put(f"/api/leads/{lead['id']}", json={"assigned_to": None}, headers=auth_headers)
        assert res_admin.status_code == 200
        assert res_admin.json()["assigned_to"] is None

        res_bad = client.put(f"/api/leads/{lead['id']}", json={"name": ""}, headers=auth_headers)
        assert res_bad.status_code == 400
    finally:
        Repository.delete_lead(lead["id"])
        Repository.delete_lead(other_lead["id"])
        Repository.delete_user(member["id"])
