"""
Unit tests for Universal GitHub Vault scaffolding and internal discussion structure alignment.
"""

import json
from backend.integrations.github_vault import generate_vault_scaffold


def test_generate_vault_scaffold_distinguishes_internal_and_client_calls():
    lead = {
        "id": "lead_vault_test",
        "name": "Vishal Dama",
        "business_name": "Unique Security Access Systems",
        "city": "Raipur",
        "assigned_to": "Shailesh",
        "drive_folder_id": "drive_folder_123",
        "drive_folder_url": "https://drive.google.com/drive/folders/drive_folder_123"
    }

    calls = [
        {
            "id": "call_client_01",
            "created_at": "2026-10-01T10:00:00Z",
            "notes": "Client requested access control prototype.",
            "transcription_text": "Transcript of client call with Vishal Dama.",
            "is_internal": False,
            "outcome": "Connected"
        },
        {
            "id": "call_sync_01",
            "created_at": "2026-10-02T11:00:00Z",
            "notes": "Discussed architecture and pricing with Abhijeet.",
            "transcription_text": "Transcript of internal strategy sync.",
            "is_internal": True,
            "caller_name": "Shailesh",
            "teammate_name": "Abhijeet",
            "outcome": "Internal Sync"
        }
    ]

    scaffold = generate_vault_scaffold(lead, calls=calls)

    # 1. Verify client call transcript placement
    client_call_path = "context/transcripts/client_calls/2026-10-01_call_client_01_client_call.md"
    assert client_call_path in scaffold
    assert "Client Discovery Call" in scaffold[client_call_path]
    assert "Transcript of client call with Vishal Dama." in scaffold[client_call_path]

    # 2. Verify internal sync transcript placement
    internal_sync_path = "context/transcripts/internal_syncs/2026-10-02_call_sync_01_internal_sync.md"
    assert internal_sync_path in scaffold
    assert "Internal Strategy Sync: Shailesh & Abhijeet" in scaffold[internal_sync_path]
    assert "Transcript of internal strategy sync." in scaffold[internal_sync_path]

    # 3. Verify backward-compatible aliases
    assert "context/transcripts/2026-10-01_call_client_01.md" in scaffold
    assert "context/transcripts/2026-10-02_call_sync_01.md" in scaffold
    assert "context/call_transcripts/2026-10-01_call_client_01.md" in scaffold
    assert "context/call_transcripts/2026-10-02_call_sync_01.md" in scaffold

    # 4. Verify media manifest
    assert "context/media_manifest.json" in scaffold
    manifest = json.loads(scaffold["context/media_manifest.json"])
    assert "assets" in manifest
    items = manifest["assets"]
    assert len(items) == 2

    client_item = next((i for i in items if i["id"] == "call_client_01"), None)
    assert client_item is not None
    assert client_item["call_type"] == "client_call"
    assert client_item["is_internal"] is False
    assert client_item["transcript_path"] == client_call_path

    internal_item = next((i for i in items if i["id"] == "call_sync_01"), None)
    assert internal_item is not None
    assert internal_item["call_type"] == "internal_sync"
    assert internal_item["is_internal"] is True
    assert internal_item["transcript_path"] == internal_sync_path
