"""
Integration tests for internal call multi-lead mentions and auto-segmentation REST API.
"""

import uuid
from backend.database import Repository


def test_internal_call_mentions_api_endpoints(client, auth_headers):
    # 1. Create two leads
    lead_a = Repository.create_lead({
        "name": "Manish Gupta Test",
        "business_name": "Gupta Iron Test",
        "phone": f"+9199{uuid.uuid4().hex[:8]}"
    })
    lead_b = Repository.create_lead({
        "name": "Sunil Sharma Test",
        "business_name": "Sharma Textiles Test",
        "phone": f"+9199{uuid.uuid4().hex[:8]}"
    })
    lid_a = lead_a["id"]
    lid_b = lead_b["id"]

    # 2. Create an internal discussion
    call = Repository.log_call({
        "outcome": "Multi-Lead Strategy Review",
        "notes": "Syncing on Gupta Iron and Sharma Textiles.",
        "duration_minutes": 20,
        "is_internal": 1,
        "teammate_user_id": "usr_550ef8c1",
        "call_type": "internal",
        "transcription_text": "Abhijeet: Manish Gupta agreed on the quota. Shailesh: Sunil Sharma needs the demo video by Friday."
    })
    cid = call["id"]

    try:
        # 3. Add mention via API
        resp = client.post(f"/api/crm/calls/internal/{cid}/mentions", json={
            "lead_id": lid_a,
            "topic": "Iron Quota Discussion",
            "notes": "Agreed on monthly quota.",
            "transcript_excerpt": "Manish Gupta agreed on the quota.",
            "action_items": "Draft formal quotation"
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        mention_a_id = data["mention"]["id"]

        # 4. List mentions via API
        list_resp = client.get(f"/api/crm/calls/internal/{cid}/mentions", headers=auth_headers)
        assert list_resp.status_code == 200
        mentions = list_resp.json()["mentions"]
        assert len(mentions) == 1
        assert mentions[0]["lead_id"] == lid_a
        assert mentions[0]["topic"] == "Iron Quota Discussion"

        # 5. Test auto-segmentation endpoint
        seg_resp = client.post(f"/api/crm/calls/internal/{cid}/auto-segment", headers=auth_headers)
        assert seg_resp.status_code == 200
        seg_data = seg_resp.json()
        assert seg_data["status"] == "success"

        # List mentions again - should now also include Sunil Sharma
        list_resp_2 = client.get(f"/api/crm/calls/internal/{cid}/mentions", headers=auth_headers)
        mentions_2 = list_resp_2.json()["mentions"]
        lead_ids_2 = {m["lead_id"] for m in mentions_2}
        assert lid_b in lead_ids_2

        # 6. Delete a mention via API
        del_resp = client.delete(f"/api/crm/calls/internal/{cid}/mentions/{mention_a_id}", headers=auth_headers)
        assert del_resp.status_code == 200

        list_resp_3 = client.get(f"/api/crm/calls/internal/{cid}/mentions", headers=auth_headers)
        mentions_3 = list_resp_3.json()["mentions"]
        assert all(m["id"] != mention_a_id for m in mentions_3)

    finally:
        Repository._execute("DELETE FROM call_lead_mentions WHERE call_id = ?", (cid,), commit=True)
        Repository._execute("DELETE FROM call_logs WHERE id = ?", (cid,), commit=True)
        Repository.delete_lead(lid_a)
        Repository.delete_lead(lid_b)
