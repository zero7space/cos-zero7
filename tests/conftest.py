"""
Shared test fixtures for COS Theta test suite.
Provides isolated test database, authenticated test client, and sample data.
"""

import os
import sys
import pytest

# Ensure project root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient


@pytest.fixture(scope="session", autouse=True)
def setup_test_db(tmp_path_factory):
    """Create an isolated SQLite database for the entire test session."""
    db_dir = tmp_path_factory.mktemp("test_db")
    db_path = str(db_dir / "test_crm.db")
    os.environ["ZERO7_DB_PATH"] = db_path
    
    from backend.database import init_db
    from backend.seed_data import seed_if_empty
    init_db()
    seed_if_empty()
    
    yield db_path


@pytest.fixture(scope="session")
def app():
    """Create the FastAPI application instance."""
    from backend.app import app as fastapi_app
    return fastapi_app


@pytest.fixture(scope="session")
def client(app):
    """Create a TestClient for the FastAPI app."""
    return TestClient(app)


@pytest.fixture(scope="session")
def auth_headers(client):
    """Get authenticated headers by logging in as admin."""
    # Try default admin credentials
    res = client.post("/api/auth/login", json={
        "email": "abhijeet@zero7.space",
        "password": "admin123"
    })
    if res.status_code != 200:
        res = client.post("/api/auth/login", json={
            "email": "abhijeet@zero7.in",
            "password": "admin123"
        })
    
    if res.status_code == 200:
        token = res.json().get("token")
        return {"Authorization": f"Bearer {token}"}
    
    # If login fails, return empty headers (some tests may not need auth)
    return {}


@pytest.fixture
def sample_lead():
    """Return sample lead data for testing."""
    return {
        "name": "Test User",
        "business_name": "Test Corp",
        "phone": "+919876543210",
        "email": "test@testcorp.com",
        "city": "Indore",
        "temperature": "warm",
        "call_stage": "uncontacted",
        "source": "manual",
        "priority": "medium",
    }
