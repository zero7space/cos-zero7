"""Basic health/smoke tests for the application."""

import pytest


class TestAppHealth:
    def test_root_returns_html(self, client):
        """The root path should return the SPA shell HTML."""
        res = client.get("/")
        assert res.status_code == 200

    def test_auth_login_rejects_bad_credentials(self, client):
        res = client.post("/api/auth/login", json={
            "email": "nonexistent@test.com",
            "password": "wrongpassword"
        })
        assert res.status_code in (401, 403, 422)

    def test_health_check_endpoint(self, client):
        res = client.get("/api/health")
        assert res.status_code == 200
        data = res.json()
        assert "status" in data
        assert "checks" in data
        assert "database" in data["checks"]
