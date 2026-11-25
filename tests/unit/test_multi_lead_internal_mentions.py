"""
Unit tests for multi-lead internal discussion modeling, mention junction table,
and zero-leakage client vault isolation.
"""

import uuid
from backend.database import Repository
from backend.integrations.github_vault import generate_vault_scaffold


def test_internal_call_has_null_lead_id_and_multiple_mentions():
    # 1. Create two test leads
    lead_a = Repository.create_lead({
        "name": "Vishal Dama Test",
        "business_name": "Unique Security Test",
        "phone": f"+9199{uuid.uuid4().hex[:8]}"
    })
    lead_b = Repository.create_lead({
        "name": "Pratham Kedia Test",
        "business_name": "Pawan Chemicals Test",
        "phone": f"+9199{uuid.uuid4().hex[:8]}"
    })
    lid_a = lead_a["id"]
    lid_b = lead_b["id"]

    # 2. Log an internal sync between founders
    call = Repository.log_call({
        "outcome": "Founder Evening Strategy Sync",
        "notes": "Discussed access control for Vishal and chemical dispatch slips for Pratham.",
        "duration_minutes": 35,
        "is_internal": 1,
        "teammate_user_id": "usr_550ef8c1",
        "call_type": "internal",
        "transcription_text": "Shailesh: Regarding Vishal Dama, we need RFID tags. Abhijeet: For Pratham Kedia, let's setup vehicle trips."
    })
    cid = call["id"]

    try:
        # Crucial architectural assertion: Master call MUST NOT be bound to any single lead
        raw_call = Repository._execute("SELECT lead_id, is_internal FROM call_logs WHERE id = ?", (cid,), fetchone=True)
        assert raw_call["lead_id"] is None
        assert raw_call["is_internal"] == 1

        # 3. Associate multiple leads to the internal call
        m_a = Repository.add_call_lead_mention(
            call_id=cid,
            lead_id=lid_a,
            topic="RFID Access Control Prototype",
            notes="Vishal needs offline barcode scanner fallback.",
            transcript_excerpt="Regarding Vishal Dama, we need RFID tags.",
            action_items="Build RFID prototype scanner",
            time_offset_start=60,
            time_offset_end=480
        )
        assert m_a is not None
        assert m_a["lead_id"] == lid_a

        m_b = Repository.add_call_lead_mention(
            call_id=cid,
            lead_id=lid_b,
            topic="Chemical Inventory & Dispatch Slips",
            notes="Pratham requested vehicle trip tracking.",
            transcript_excerpt="For Pratham Kedia, let's setup vehicle trips.",
            action_items="Design vehicle trip table",
            time_offset_start=480,
            time_offset_end=1200
        )
        assert m_b is not None
        assert m_b["lead_id"] == lid_b

        # 4. Verify call mentions query
        mentions = Repository.get_call_lead_mentions(cid)
        assert len(mentions) == 2
        mention_lead_ids = {m["lead_id"] for m in mentions}
        assert lid_a in mention_lead_ids
        assert lid_b in mention_lead_ids

        # 5. Verify lead A view: gets ONLY its own mention
        lead_a_calls = Repository.get_lead_calls(lid_a)
        assert len(lead_a_calls) == 1
        assert lead_a_calls[0]["outcome"] == "RFID Access Control Prototype"
        assert "Vishal Dama" in lead_a_calls[0]["transcription_text"]
        assert "Pratham Kedia" not in lead_a_calls[0]["transcription_text"]

        # 6. Verify lead B view: gets ONLY its own mention
        lead_b_calls = Repository.get_lead_calls(lid_b)
        assert len(lead_b_calls) == 1
        assert lead_b_calls[0]["outcome"] == "Chemical Inventory & Dispatch Slips"
        assert "Pratham Kedia" in lead_b_calls[0]["transcription_text"]
        assert "Vishal Dama" not in lead_b_calls[0]["transcription_text"]

        # 7. Verify zero-leakage vault scaffolding
        scaffold_a = generate_vault_scaffold(lead_a, calls=lead_a_calls)
        mention_files_a = [k for k in scaffold_a if "internal_syncs" in k]
        assert len(mention_files_a) >= 1
        content_a = scaffold_a[mention_files_a[0]]
        assert "RFID Access Control Prototype" in content_a
        assert "Pratham Kedia" not in content_a  # Zero data leakage!

        scaffold_b = generate_vault_scaffold(lead_b, calls=lead_b_calls)
        mention_files_b = [k for k in scaffold_b if "internal_syncs" in k]
        assert len(mention_files_b) >= 1
        content_b = scaffold_b[mention_files_b[0]]
        assert "Chemical Inventory & Dispatch Slips" in content_b
        assert "Vishal Dama" not in content_b  # Zero data leakage!

        # 8. Deleting mention for Lead A leaves Lead B intact
        Repository.delete_call_lead_mention(m_a["id"])
        mentions_after = Repository.get_call_lead_mentions(cid)
        assert len(mentions_after) == 1
        assert mentions_after[0]["lead_id"] == lid_b
        # Internal call still exists
        call_still_exists = Repository._execute("SELECT id FROM call_logs WHERE id = ?", (cid,), fetchone=True)
        assert call_still_exists is not None

    finally:
        Repository._execute("DELETE FROM call_lead_mentions WHERE call_id = ?", (cid,), commit=True)
        Repository._execute("DELETE FROM call_logs WHERE id = ?", (cid,), commit=True)
        Repository.delete_lead(lid_a)
        Repository.delete_lead(lid_b)
