#!/usr/bin/env python3
import os
import sys
import uuid
import sqlite3
import httpx
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.database import Repository
from backend.integrations.deepgram import DEEPGRAM_API_KEY, DEEPGRAM_URL

IST = timezone(timedelta(hours=5, minutes=30))
SYNC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "recordings", "device_sync")
RECORDINGS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "recordings")
os.makedirs("scratch/transcripts", exist_ok=True)

TARGET_FILES = [
    ("20261005_210630_in_+919993963968.ogg", 2184, "2026-10-05T15:36:30Z", "audio/ogg"),
    ("20261006_001139_in_+919993963968.ogg", 5704, "2026-10-05T18:41:39Z", "audio/ogg"),
    ("Monday, 12h43m pm.m4a", 480, "2026-10-05T07:13:00Z", "audio/mp4"),
]

def transcribe_file(filename, dur_secs, called_at_iso, mime_type):
    file_path = os.path.join(SYNC_DIR, filename)
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        return

    print(f"\n--- Transcribing {filename} ({os.path.getsize(file_path)/(1024*1024):.2f} MB, {dur_secs}s) ---")
    with open(file_path, "rb") as f:
        file_bytes = f.read()

    dur_mins = max(1, (dur_secs + 59) // 60)
    call_id = "call_" + uuid.uuid4().hex[:8]
    safe_name = filename.replace(" ", "_")
    target_filename = f"{call_id}_{safe_name}"

    # Save to local recordings folder
    with open(os.path.join(RECORDINGS_DIR, target_filename), "wb") as out_f:
        out_f.write(file_bytes)

    # Call Deepgram with extended timeout
    params = {
        "model": "nova-2",
        "language": "en",
        "detect_language": "true",
        "smart_format": "true",
        "paragraphs": "true",
        "diarize": "true",
    }
    headers = {
        "Authorization": f"Token {DEEPGRAM_API_KEY}",
        "Content-Type": mime_type,
    }

    try:
        with httpx.Client(timeout=300.0) as client:
            resp = client.post(DEEPGRAM_URL, params=params, headers=headers, content=file_bytes)
            if resp.status_code != 200:
                print(f"Deepgram HTTP {resp.status_code}: {resp.text[:300]}")
                return

            result = resp.json()
            channels = result.get("results", {}).get("channels", [])
            if not channels:
                print("No channels in Deepgram result")
                return

            alts = channels[0].get("alternatives", [])
            if not alts:
                print("No alternatives in Deepgram result")
                return

            transcript_text = alts[0].get("transcript", "")
            confidence = alts[0].get("confidence", 0.9)
            detected_lang = channels[0].get("detected_language", "hi")

            paragraphs = alts[0].get("paragraphs", {}).get("paragraphs", [])
            formatted_lines = []
            for para in paragraphs:
                sentences = para.get("sentences", [])
                for s in sentences:
                    formatted_lines.append(s.get("text", ""))
            formatted_text = "\n\n".join(formatted_lines) if formatted_lines else transcript_text

            print(f"Transcribed {len(formatted_text)} chars (lang={detected_lang}, conf={confidence:.2f})")

            # Save in database
            call_data = {
                "id": call_id,
                "lead_id": None,
                "user_id": "usr_e76bc446",
                "teammate_user_id": "usr_550ef8c1",
                "outcome": "Internal Sync",
                "notes": f"Internal discussion with Shailesh ({filename})",
                "duration_minutes": dur_mins,
                "recording_file_name": target_filename,
                "recording_mime_type": mime_type,
                "recording_size_bytes": len(file_bytes),
                "recording_duration_secs": dur_secs,
                "recording_drive_url": f"/api/recordings/{target_filename}",
                "is_video": 0,
                "is_internal": 1,
                "call_type": "internal",
                "called_at": called_at_iso,
                "transcription_text": formatted_text,
                "transcription_confidence": float(confidence),
                "transcription_language": detected_lang,
            }
            Repository.log_call(call_data)

            # Save to scratch
            scratch_path = f"scratch/transcripts/{call_id}_{filename[:15]}_{dur_mins}m.txt"
            with open(scratch_path, "w", encoding="utf-8") as out_t:
                out_t.write(f"Call ID: {call_id}\nFile: {filename}\nDuration: {dur_mins}m\nCalled At: {called_at_iso}\n\n=== TRANSCRIPT ===\n\n{formatted_text}")
            print(f"Saved transcript to {scratch_path}")

    except Exception as e:
        print(f"Transcription error: {e}")

if __name__ == "__main__":
    for item in TARGET_FILES:
        transcribe_file(*item)
    print("\nAll remaining files processed!")
