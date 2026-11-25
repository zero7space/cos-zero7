#!/usr/bin/env python3
"""
Backfill Auto-Segmentation for Internal Discussions in COS Theta
Iterates over all internal calls, scans Deepgram transcripts against leads,
creates call_lead_mentions records, and updates client media manifests/vaults.
"""

import sys
from backend.database import Repository
from backend.integrations.github_vault import update_media_manifest_in_vault

def run_backfill():
    internal_calls = Repository.get_internal_calls()
    print(f"Total internal calls: {len(internal_calls)}")
    leads = Repository._execute("SELECT id, name, business_name, phone FROM leads", fetchall=True) or []
    print(f"Loaded {len(leads)} leads from CRM.")

    total_created = 0
    updated_lead_ids = set()

    for call in internal_calls:
        call_id = call["id"]
        call_obj = Repository._execute("SELECT * FROM call_logs WHERE id = ?", (call_id,), fetchone=True)
        if not call_obj:
            continue
        transcript = (call_obj.get("transcription_text") or "").strip()
        if not transcript:
            continue

        norm_transcript = transcript.lower()

        # Existing mentions
        existing = Repository.get_call_lead_mentions(call_id)
        existing_lids = {m["lead_id"] for m in existing}

        matched_for_call = []
        for l in leads:
            lid = l["id"]
            if lid in existing_lids:
                continue
            lname = (l.get("name") or "").strip()
            lbiz = (l.get("business_name") or "").strip()

            matched = False
            matched_term = ""

            name_parts = [p.lower() for p in lname.split() if len(p) >= 3 and p.lower() not in {"test", "client", "prospect", "corp", "inc", "ltd"}]
            biz_parts = [p.lower() for p in lbiz.split() if len(p) >= 3 and p.lower() not in {"test", "client", "prospect", "corp", "inc", "ltd"}]

            if len(lname) >= 4 and lname.lower() in norm_transcript:
                matched = True
                matched_term = lname
            elif len(name_parts) >= 2 and all(p in norm_transcript for p in name_parts):
                matched = True
                matched_term = " ".join(name_parts)
            elif len(lbiz) >= 4 and lbiz.lower() in norm_transcript:
                matched = True
                matched_term = lbiz
            elif len(biz_parts) >= 2 and all(p in norm_transcript for p in biz_parts):
                matched = True
                matched_term = " ".join(biz_parts)

            if matched:
                idx = norm_transcript.find(matched_term.lower())
                start_pos = max(0, idx - 180)
                end_pos = min(len(transcript), idx + 320)
                snippet = transcript[start_pos:end_pos].strip()
                if start_pos > 0:
                    snippet = "..." + snippet
                if end_pos < len(transcript):
                    snippet = snippet + "..."

                topic = f"Discussion on {lname or lbiz}"
                mention = Repository.add_call_lead_mention(
                    call_id=call_id,
                    lead_id=lid,
                    topic=topic,
                    notes=f"Auto-detected in sync via mention of '{matched_term}'",
                    transcript_excerpt=snippet
                )
                matched_for_call.append(lname or lbiz)
                total_created += 1
                updated_lead_ids.add(lid)

        if matched_for_call:
            print(f"Call {call_id} matched {len(matched_for_call)} leads: {matched_for_call}")

    print(f"\n--- Backfill Summary ---")
    print(f"Total new call_lead_mentions created: {total_created}")
    print(f"Updating media manifests for {len(updated_lead_ids)} unique leads...")
    
    for lid in updated_lead_ids:
        try:
            update_media_manifest_in_vault(lid)
        except Exception as e:
            print(f"Warning: Failed to update vault manifest for lead {lid}: {e}")

    print("Backfill completed successfully.")

if __name__ == "__main__":
    run_backfill()
