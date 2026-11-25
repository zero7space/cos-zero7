"""Unit tests for Pydantic models — no database, no HTTP."""

import pytest
from backend.models import LeadCreate, LeadUpdate, DealCreate, DealUpdate


class TestLeadModels:
    def test_lead_create_minimal(self):
        lead = LeadCreate(name="John Doe")
        assert lead.name == "John Doe"
        assert lead.temperature == "warm"
        assert lead.call_stage == "uncontacted"
        assert lead.source == "manual"
        assert lead.priority == "unexplored"

    def test_lead_create_full(self):
        lead = LeadCreate(
            name="Jane Smith",
            business_name="Smith Corp",
            phone="+919876543210",
            email="jane@smith.com",
            city="Mumbai",
            temperature="hot",
            deal_value=50000.0,
        )
        assert lead.business_name == "Smith Corp"
        assert lead.deal_value == 50000.0

    def test_lead_update_all_optional(self):
        update = LeadUpdate()
        assert update.name is None
        assert update.temperature is None

    def test_lead_update_partial(self):
        update = LeadUpdate(temperature="hot", priority="high")
        assert update.temperature == "hot"
        assert update.priority == "high"
        assert update.name is None


class TestDealModels:
    def test_deal_create_minimal(self):
        deal = DealCreate(title="Website Project")
        assert deal.title == "Website Project"
        assert deal.stage == "won"
        assert deal.delivery_stage == "in_development"
        assert deal.amount_received == 0.0

    def test_deal_update_partial(self):
        update = DealUpdate(stage="closed", value=100000.0)
        assert update.stage == "closed"
        assert update.value == 100000.0
        assert update.title is None
