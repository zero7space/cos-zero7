"""
Unit tests for Zero7 Pipeline Sentinel Agent and WhatsApp ZDRO7 routing.
"""

import pytest
import uuid
from datetime import datetime, timezone, timedelta
from backend.database import Repository
from backend.ai.sentinel_agent import SentinelAgent, AberrationType


def test_sentinel_agent_registered_in_catalog():
    """Verify that pipeline_sentinel is seeded and available in the CRM agent definitions."""
    Repository.seed_default_agents_and_skills()
    agent = Repository.get_agent("pipeline_sentinel")
    assert agent is not None
    assert agent["slug"] == "pipeline_sentinel"
    assert "ZDRO7" in agent["system_prompt"] or "team" in agent["system_prompt"].lower()
    assert agent["role"] == "sentinel"


def test_sentinel_audit_detects_uncontacted_lead():
    """Verify that a lead with no calls or WhatsApp messages is flagged as UNCONTACTED_LEAD."""
    # Create test lead older than 2 hours
    past_time = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
    test_phone = f"+9199{uuid.uuid4().hex[:8]}"
    lead_data = {
        "name": "Test Uncontacted Prospect",
        "business_name": "Test Acme Corp",
        "phone": test_phone,
        "call_stage": "uncontacted",
        "status": "new",
        "temperature": "hot",
        "priority": "high",
        "deal_value": 50000.0,
        "created_at": past_time
    }
    lead = Repository.create_lead(lead_data)
    lid = lead["id"]

    try:
        agent = SentinelAgent()
        aberrations = agent.audit_all_leads()
        
        # Should contain an aberration for our lead
        match = next((a for a in aberrations if a["lead_id"] == lid), None)
        assert match is not None
        assert match["aberration_type"] in (AberrationType.UNCONTACTED_LEAD, AberrationType.HOT_LEAD_NEGLECTED)
        assert match["lead_name"] == "Test Uncontacted Prospect"
        assert match["severity"] == "critical"

        # Generate nag copy
        copy = agent.generate_nag_copy(match)
        assert "@team" in copy
        assert "Test Uncontacted" in copy or "Test Acme Corp" in copy
    finally:
        Repository.delete_lead(lid)


def test_sentinel_audit_detects_dormant_proposal():
    """Verify that a lead in proposal stage with no recent touchpoints is flagged as PROPOSAL_WITHOUT_UPDATE."""
    past_time = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    lead_data = {
        "name": "Test Proposal Prospect",
        "business_name": "Acme Ventures",
        "phone": "+919876500001",
        "call_stage": "connected",
        "status": "proposal",
        "deal_value": 75000.0,
        "created_at": past_time,
        "updated_at": past_time
    }
    lead = Repository.create_lead(lead_data)
    lid = lead["id"]

    try:
        agent = SentinelAgent()
        aberrations = agent.audit_all_leads()

        match = next((a for a in aberrations if a["lead_id"] == lid and a["aberration_type"] == AberrationType.PROPOSAL_WITHOUT_UPDATE), None)
        assert match is not None
        assert match["deal_value"] == 75000.0

        copy = agent.generate_nag_copy(match)
        assert "@team" in copy
        assert "proposal" in copy.lower()
        assert "Acme Ventures" in copy or "Test Proposal Prospect" in copy
    finally:
        Repository.delete_lead(lid)


def test_sentinel_cooldown_deduplication():
    """Verify that cooldown prevents re-alerting the exact same aberration repeatedly."""
    past_time = (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()
    lead_data = {
        "name": "Cooldown Test Lead",
        "business_name": "Cooldown Inc",
        "phone": "+919876599999",
        "call_stage": "uncontacted",
        "status": "new",
        "created_at": past_time
    }
    lead = Repository.create_lead(lead_data)
    lid = lead["id"]

    try:
        agent = SentinelAgent()
        aberrations = agent.audit_all_leads()
        match = next((a for a in aberrations if a["lead_id"] == lid), None)
        assert match is not None

        # Before any alert, should not be filtered out
        unalerted = agent.filter_cooldown_aberrations([match], cooldown_hours=6.0)
        assert len(unalerted) == 1

        # Simulate alert dispatch
        Repository.log_sentinel_alert(
            lead_id=lid,
            aberration_type=match["aberration_type"],
            severity="high",
            nag_message="Test alert message",
            group_target="ZDRO7"
        )

        # Now, within 6h cooldown window, it must be filtered out
        unalerted_after = agent.filter_cooldown_aberrations([match], cooldown_hours=6.0)
        assert len(unalerted_after) == 0

        # But if cooldown is 0 hours, it should be allowed
        unalerted_zero = agent.filter_cooldown_aberrations([match], cooldown_hours=0.0)
        assert len(unalerted_zero) == 1
    finally:
        Repository.delete_lead(lid)


def test_whatsapp_sentinel_endpoint_strictly_restricts_destination(client, auth_headers):
    """Verify that the Sentinel broadcast WhatsApp endpoint forbids arbitrary external recipients."""
    # Attempting to send to an outside phone number must be rejected (HTTP 403)
    res = client.post(
        "/api/whatsapp/agent/sentinel/broadcast",
        json={
            "message_text": "Hey external client!",
            "recipient_phone": "+1234567890"  # Forbidden destination!
        },
        headers=auth_headers
    )
    assert res.status_code == 403
    assert "strictly restricted to the Zero7 WhatsApp group" in res.json()["detail"] or "strictly restricted to the ZDRO7" in res.json()["detail"]

    # Valid message without overriding recipient targets Zero7
    res_valid = client.post(
        "/api/whatsapp/agent/sentinel/broadcast",
        json={
            "message_text": "🚨 @team: Pipeline Sentinel test nag!"
        },
        headers=auth_headers
    )
    # Regardless of whether physical Baileys socket is online, endpoint accepts and records
    assert res_valid.status_code == 200
    data = res_valid.json()
    assert data["group_target"] in ("Zero7", "ZDRO7")
    assert data["alert"] is not None


def test_sentinel_status_and_aberrations_endpoints(client, auth_headers):
    """Verify GET /api/agent/sentinel/status and /api/agent/sentinel/aberrations."""
    res_status = client.get("/api/agent/sentinel/status", headers=auth_headers)
    assert res_status.status_code == 200
    status_data = res_status.json()
    assert status_data["agent_slug"] == "pipeline_sentinel"
    assert status_data["restricted_group"] in ("Zero7", "ZDRO7")
    assert status_data["status"] == "active_running"

    res_abs = client.get("/api/agent/sentinel/aberrations", headers=auth_headers)
    assert res_abs.status_code == 200
    abs_data = res_abs.json()
    assert "aberrations" in abs_data
    assert isinstance(abs_data["aberrations"], list)


def test_record_group_mention_and_commitment_extraction():
    """Verify that record_group_mention parses commitments and updates sentinel memory."""
    lead = Repository.create_lead({
        "name": "Rohan Verma",
        "business_name": "Verma Logistics",
        "phone": "+919811122233",
        "call_stage": "connected",
        "status": "contacted"
    })
    lid = lead["id"]

    try:
        agent = SentinelAgent()
        ts = "2026-10-04T12:00:00Z"
        res = agent.record_group_mention(
            lead_id=lid,
            text="@team rohan ko proposal bhej do kal tak",
            sender_name="Shailesh",
            timestamp=ts
        )

        assert res is not None
        assert "Verma Logistics" in res["business_name"]
        assert len(res["commitments_made"]) == 1
        comm = res["commitments_made"][0]
        assert comm["action_type"] == "send_proposal"
        assert comm["sender"] == "Shailesh"
        assert "proposal bhej do" in comm["text"]
        assert "Shailesh" in res["group_mentions_summary"]

        # Verify database persistence
        db_ctx = Repository.get_sentinel_lead_context(lid)
        assert db_ctx is not None
        assert len(db_ctx["commitments_made"]) == 1
    finally:
        Repository.delete_lead(lid)


def test_synthesize_lead_context_aggregates_calls_and_group_messages():
    """Verify that synthesize_lead_context compiles call transcripts, group chatter, and commitments."""
    lead = Repository.create_lead({
        "name": "Pooja Malhotra",
        "business_name": "Malhotra Textiles",
        "phone": "+919877700011",
        "call_stage": "connected",
        "status": "contacted"
    })
    lid = lead["id"]

    try:
        # 1. Log a call with transcript
        Repository._execute("""
            INSERT INTO call_logs (
                id, lead_id, outcome, duration_minutes, called_at, transcription_text, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            "call_test_pm", lid, "Connected", 8, "2026-10-02T15:00:00Z",
            "Client wants a tailored ERP for textile inventory and automated supplier alerts.",
            "Discovery call went great, client requested demo."
        ), commit=True)

        # 2. Ingest a Zero7 group message
        Repository.save_zero7_group_message(
            wa_message_id="wa_mid_pm_1",
            sender_phone="919812345678",
            sender_name="Abhijeet",
            message_text="@team Pooja Malhotra ko portfolio share kar de urgently",
            linked_lead_id=lid,
            timestamp="2026-10-02T16:00:00Z"
        )

        agent = SentinelAgent()
        dossier = agent.synthesize_lead_context(lid)

        assert dossier is not None
        assert dossier["lead_name"] == "Pooja Malhotra"
        assert "tailored ERP" in dossier["call_insights_summary"]
        assert "Abhijeet" in dossier["group_mentions_summary"]
        assert len(dossier["commitments_made"]) >= 1

        comm = next((c for c in dossier["commitments_made"] if "portfolio share" in c["text"]), None)
        assert comm is not None
        assert comm["status"] == "broken"  # Overdue for > 12h without proposal
        assert len(dossier["unresolved_questions"]) >= 1
        assert "Pooja Malhotra" in dossier["synthesized_context"]
    finally:
        Repository._execute("DELETE FROM call_logs WHERE id = 'call_test_pm'", commit=True)
        Repository._execute("DELETE FROM zero7_group_messages WHERE wa_message_id = 'wa_mid_pm_1'", commit=True)
        Repository.delete_lead(lid)


def test_sentinel_audit_detects_broken_group_commitment():
    """Verify that audit_all_leads catches broken commitments made in the Zero7 group."""
    past_time = (datetime.now(timezone.utc) - timedelta(hours=36)).isoformat()
    lead = Repository.create_lead({
        "name": "Vikas Agarwal",
        "business_name": "Agarwal Sweets",
        "phone": "+919822233344",
        "call_stage": "connected",
        "status": "contacted",
        "temperature": "hot",
        "deal_value": 45000.0,
        "created_at": past_time,
        "updated_at": past_time
    })
    lid = lead["id"]

    try:
        agent = SentinelAgent()
        # Record commitment from 36 hours ago
        agent.record_group_mention(
            lead_id=lid,
            text="@team vikas agarwal ko quote send kar de",
            sender_name="Rai",
            timestamp=past_time
        )

        aberrations = agent.audit_all_leads()
        match = next((a for a in aberrations if a["lead_id"] == lid and a["aberration_type"] == AberrationType.BROKEN_GROUP_COMMITMENT), None)

        assert match is not None
        assert match["severity"] == "critical"
        assert match["commitment_sender"] == "Rai"
        assert "vikas agarwal ko quote send kar de" in match["commitment_text"]

        # Generate nag copy
        nag_copy = agent.generate_nag_copy(match)
        assert "@team" in nag_copy
        assert "commitment" in nag_copy.lower()
        assert "Rai" in nag_copy
        assert "Vikas Agarwal" in nag_copy
    finally:
        Repository.delete_lead(lid)


def test_ingest_zero7_group_message_router_endpoint_updates_memory(client, auth_headers):
    """Verify that POST /api/whatsapp/zero7/group-messages updates Sentinel's memory."""
    lead = Repository.create_lead({
        "name": "Manish Gupta",
        "business_name": "Gupta Steels",
        "phone": "+919833344455",
        "call_stage": "uncontacted",
        "status": "new"
    })
    lid = lead["id"]

    try:
        res = client.post(
            "/api/whatsapp/zero7/group-messages",
            json={
                "wa_message_id": f"test_mid_{lid}",
                "sender_phone": "919999988888",
                "sender_name": "Shailesh",
                "message_text": f"Manish Gupta ko call kar lo urgent inquiry hai",
                "linked_lead_id": lid
            }
        )
        assert res.status_code == 200

        # Verify that sentinel autonomous memory was updated
        ctx = Repository.get_sentinel_lead_context(lid)
        assert ctx is not None
        assert "Shailesh" in ctx["group_mentions_summary"]
        assert len(ctx["commitments_made"]) >= 1
        comm = ctx["commitments_made"][0]
        assert comm["action_type"] == "make_call"
    finally:
        Repository._execute("DELETE FROM zero7_group_messages WHERE wa_message_id = ?", (f"test_mid_{lid}",), commit=True)
        Repository.delete_lead(lid)

