"""
Integration tests for Evidence-Based Fact Ledger.
Tests proposing, auto-applying, reviewing, and rejecting customer facts.
"""

import pytest
from backend.services.fact_service import FactService
from backend.repositories.facts import FactsRepository
from backend.database import Repository


class TestFactLedger:
    def test_propose_and_auto_apply_blank_field(self, client, auth_headers):
        # 1. Create a lead with blank email and uncontacted status
        lead_data = {
            "name": "Fact Test Client",
            "business_name": "Fact Test Corp",
            "phone": "+919999988888",
        }
        res = client.post("/api/leads", json=lead_data, headers=auth_headers)
        assert res.status_code == 200
        lead_id = res.json().get("id") or res.json().get("lead", {}).get("id")
        assert lead_id is not None

        # 2. AI observes an email in conversation
        fact = FactService.propose_lead_fact(
            lead_id=lead_id,
            field_name="email",
            proposed_value="client@facttest.com",
            source="whatsapp_agent",
            quote_evidence="Client said: 'Please send invoice to client@facttest.com'",
            confidence=0.95,
            auto_apply_if_empty=True,
        )

        # 3. Since email was blank, it should be auto-applied
        assert fact["status"] == "applied"
        assert fact["proposed_value"] == "client@facttest.com"

        # 4. Verify live lead record has been updated
        lead = Repository.get_lead(lead_id)
        assert lead["email"] == "client@facttest.com"

    def test_hold_for_review_when_field_already_has_data(self, client, auth_headers):
        # 1. Create a lead with an existing phone number
        lead_data = {
            "name": "Guard Test Client",
            "business_name": "Guard Test Corp",
            "phone": "+911111122222",
            "city": "Mumbai",
        }
        res = client.post("/api/leads", json=lead_data, headers=auth_headers)
        assert res.status_code == 200
        lead_id = res.json().get("id") or res.json().get("lead", {}).get("id")

        # 2. AI observes a different city ("Bengaluru")
        fact = FactService.propose_lead_fact(
            lead_id=lead_id,
            field_name="city",
            proposed_value="Bengaluru",
            source="call_transcript",
            quote_evidence="Caller said: 'We just moved our HQ to Bengaluru'",
            confidence=0.85,
            auto_apply_if_empty=True,
        )

        # 3. Because city was already "Mumbai", it MUST NOT overwrite automatically! It must be held in pending
        assert fact["status"] == "pending"
        lead = Repository.get_lead(lead_id)
        assert lead["city"] == "Mumbai"  # Preserved!

        # 4. Human approves the fact
        reviewed = FactService.review_fact(fact["id"], action="apply", user_id="admin_user")
        assert reviewed["status"] == "applied"

        # 5. Now the lead record is updated
        updated_lead = Repository.get_lead(lead_id)
        assert updated_lead["city"] == "Bengaluru"
