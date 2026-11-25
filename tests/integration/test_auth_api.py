"""
Integration tests for Auth and User endpoints.
"""

import pytest


class TestAuthAPI:
    def test_login_success(self, client):
        res = client.post("/api/auth/login", json={
            "email": "abhijeet@zero7.space",
            "password": "admin123"
        })
        assert res.status_code == 200
        data = res.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] == "abhijeet@zero7.space"
        assert "password_hash" not in data["user"]

    def test_auth_me(self, client, auth_headers):
        res = client.get("/api/auth/me", headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert "email" in data
        assert "id" in data

    def test_list_users(self, client, auth_headers):
        res = client.get("/api/users", headers=auth_headers)
        assert res.status_code == 200
        users = res.json()
        assert isinstance(users, list)
        assert len(users) >= 1
        for u in users:
            assert "password_hash" not in u
