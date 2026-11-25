"""
Zero7 AI-Native CRM — Generalized Architecture Test Suite
Validates the universal client blueprint ("Farma") across all leads:
1. Multi-Tenant Supabase Schema Provisioner (PostgreSQL Schema-per-Client)
2. Universal Vercel Deployment & Custom Subdomain Binding
3. Master Autonomous Orchestrator (Lead qualification, Prototype generation, WhatsApp pitch staging)
4. Omnichannel WhatsApp Communication & Ingestion
5. Executive Cockpit API
"""

import sys
import os
import json
sys.path.insert(0, '.')

from fastapi.testclient import TestClient
from backend.app import app
from backend.database import init_db, Repository
from backend.seed_data import seed_if_empty
from backend.integrations.supabase_provisioner import supabase_provisioner
from backend.integrations.vercel_deployer import vercel_deployer
from backend.ai.master_orchestrator import master_orchestrator

init_db()
seed_if_empty()
client = TestClient(app)


def test_supabase_multi_tenant_provisioner():
    print("\n--- Test 1: Multi-Tenant Supabase Schema Provisioner ---")
    slug = "generic_client"
    normalized = supabase_provisioner.normalize_schema_name(slug)
    assert normalized == "client_generic_client"
    
    # Generate generic schema template
    ddl = supabase_provisioner.generate_schema_template("general_enterprise", slug)
    assert "orders" in ddl or "dispatch" in ddl or "inventory" in ddl

    # Provision schema
    res = supabase_provisioner.provision_client_schema(slug, ddl_statements=[ddl])
    assert res["success"] is True
    assert res["schema_name"] == normalized
    assert "createClient" in res["code_snippet"]
    print(f"[PASS] Universal Supabase schema '{normalized}' provisioned cleanly!")


def test_vercel_deployer_and_dns_binding():
    print("\n--- Test 2: Universal Vercel Deployment & DNS Binding ---")
    files = [
        {"file": "index.html", "data": "<!DOCTYPE html><html><body><h1>Zero7 Client Prototype</h1></body></html>"},
        {"file": "vercel.json", "data": json.dumps({"cleanUrls": True})}
    ]
    res = vercel_deployer.deploy_project_from_files("proto-generic-client", files)
    assert res["success"] is True
    assert "proto-generic-client" in res["deployment_url"]
    print(f"[PASS] Vercel deployment executed successfully: {res['deployment_url']}")

    # Test subdomain binding
    bind_res = vercel_deployer.bind_custom_subdomain("proto-generic-client", "proto-generic.zero7.space")
    assert bind_res["success"] is True
    assert bind_res["subdomain"] == "proto-generic.zero7.space"
    print(f"[PASS] Subdomain '{bind_res['subdomain']}' bound successfully!")


def test_universal_whatsapp_ingestion():
    print("\n--- Test 3: Universal WhatsApp Ingestion Stream ---")
    leads = Repository.list_leads()
    lead_id = leads[0]["id"]

    res = master_orchestrator.handle_inbound_whatsapp_message(
        lead_id=lead_id,
        message_text="Hi Zero7 team, we need the prototype link by tomorrow.",
        sender_name="Client Executive"
    )
    assert res.get("status") == "logged"
    print(f"[PASS] Inbound WhatsApp message logged into lead timeline with 0 manual intervention!")


def test_master_orchestrator_and_cockpit_api():
    print("\n--- Test 4: Master Orchestrator Cockpit & 1-Click Prototype ---")
    
    # 1. Login to get token
    res = client.post("/api/auth/login", json={"email": "abhijeet@zero7.space", "password": "admin123"})
    if res.status_code != 200:
        res = client.post("/api/auth/login", json={"email": "abhijeet@zero7.in", "password": "admin123"})
    token = res.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Check Cockpit Overview
    res = client.get("/api/orchestrator/cockpit", headers=headers)
    assert res.status_code == 200
    cockpit_data = res.json()
    assert "pending_actions" in cockpit_data
    assert "prototypes_live_count" in cockpit_data
    print(f"[PASS] Cockpit API returned {cockpit_data['pending_actions_count']} pending actions and {cockpit_data['prototypes_live_count']} live prototypes.")

    # 3. Test Universal Prototype Deployment endpoint
    leads = Repository.list_leads()
    lead_id = leads[0]["id"]
    proto_res = client.post(
        f"/api/leads/{lead_id}/orchestrator/prototype",
        json={"prompt": "Generate inventory and dispatch operating system prototype"},
        headers=headers
    )
    assert proto_res.status_code == 200
    proto_data = proto_res.json()
    assert proto_data.get("success") is True
    assert "proto-" in proto_data.get("subdomain", "")
    print(f"[PASS] 1-Click Prototype Pipeline deployed live to: {proto_data.get('live_url')}")


if __name__ == "__main__":
    test_supabase_multi_tenant_provisioner()
    test_vercel_deployer_and_dns_binding()
    test_universal_whatsapp_ingestion()
    test_master_orchestrator_and_cockpit_api()
    print("\n[SUCCESS] ALL GENERALIZED AI-NATIVE CRM TESTS PASSED PERFECTLY!\n")
