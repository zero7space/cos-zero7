"""Integration tests for the Leads API endpoints."""

import pytest


class TestLeadsAPI:
    def test_list_leads(self, client, auth_headers):
        res = client.get("/api/leads", headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert "leads" in data or isinstance(data, list)

    def test_create_lead(self, client, auth_headers, sample_lead):
        res = client.post("/api/leads", json=sample_lead, headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert "id" in data or "lead" in data

    def test_get_lead(self, client, auth_headers):
        # First create a lead
        res = client.post("/api/leads", json={
            "name": "Get Test User",
            "business_name": "Get Test Corp",
        }, headers=auth_headers)
        assert res.status_code == 200
        lead_data = res.json()
        lead_id = lead_data.get("id") or lead_data.get("lead", {}).get("id")
        
        if lead_id:
            res = client.get(f"/api/leads/{lead_id}", headers=auth_headers)
            assert res.status_code == 200

    def test_search_leads(self, client, auth_headers):
        res = client.get("/api/leads?search=test", headers=auth_headers)
        assert res.status_code == 200
