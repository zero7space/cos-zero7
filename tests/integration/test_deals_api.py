"""Integration tests for the Deals API endpoints."""

import pytest


class TestDealsAPI:
    def test_list_deals(self, client, auth_headers):
        res = client.get("/api/deals", headers=auth_headers)
        assert res.status_code == 200

    def test_create_deal(self, client, auth_headers):
        res = client.post("/api/deals", json={
            "title": "Test Website Project",
            "value": 50000.0,
            "stage": "won",
        }, headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert data.get("id") or data.get("deal", {}).get("id")
