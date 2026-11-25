#!/usr/bin/env python3
"""
Ingest recordings pulled from Android device into COS Theta CRM:
- Internal team discussions with Shailesh -> ROOT / Internal_Discussions / Shailesh (9993963968)
- Client lead recordings (Vishal Dama) -> ROOT / Clients / Vishal Dama / 01_Call_Recordings
- Transcribes via Deepgram and stores transcripts in both Google Drive and SQLite CRM
"""

import os
import re
import sys
import uuid
from datetime import datetime, timezone, timedelta

# Ensure parent directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import Repository
from backend.integrations.google_drive import (
    upload_internal_discussion_asset,
    drive_upload,
    ensure_internal_discussion_drive_hierarchy,
)
from backend.integrations.deepgram import transcribe_audio, is_available as deepgram_is_available

IST = timezone(timedelta(hours=5, minutes=30))

SYNC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "recordings", "device_sync")
RECORDINGS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "recordings")
BACKEND_RECORDINGS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend", "recordings")

os.makedirs(RECORDINGS_DIR, exist_ok=True)
os.makedirs(BACKEND_RECORDINGS_DIR, exist_ok=True)

# Known call durations from system call log (mapped by timestamp string in filename)
CALL_LOG_DURATIONS = {
    "20261006_001139": 5704,
    "20261005_210630": 2184,
    "20261005_202923": 2048,
    "20261005_193009": 1630,
    "20261005_192317": 321,
    "20261005_192241": 17,
    "20261005_190523": 1016,
    "20261005_184629": 319,
    "20261005_174257": 228,
    "20261005_115109": 45,
    "20261004_222445": 25,
    "20260928_162339": 44,
}

def parse_call_time(filename: str, file_path: str) -> str:
    m = re.search(r"(\d{8})_(\d{6})", filename)
    if m:
        try:
            dt = datetime.strptime(f"{m.group(1)}_{m.group(2)}", "%Y%m%d_%H%M%S").replace(tzinfo=IST)
            return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception:
            pass
    # Fallback to file mtime
    mtime = os.path.getmtime(file_path)
    dt = datetime.fromtimestamp(mtime, tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

def get_audio_duration_seconds(file_path: str, filename: str) -> int:
    for prefix, dur in CALL_LOG_DURATIONS.items():
        if prefix in filename:
            return dur
    try:
        import mutagen
        audio = mutagen.File(file_path)
        if audio and audio.info and audio.info.length:
            return int(audio.info.length)
    except Exception:
        pass
    # Estimate from file size (approx 64kbps = 8KB/s for compressed voice)
    size_bytes = os.path.getsize(file_path)
    est = max(10, size_bytes // 8000)
    return est

def ingest_file(filename: str):
    file_path = os.path.join(SYNC_DIR, filename)
    if not os.path.exists(file_path):
        print(f"[SKIP] File not found: {filename}")
        return

    with open(file_path, "rb") as f:
        file_bytes = f.read()

    size_bytes = len(file_bytes)
    called_at_iso = parse_call_time(filename, file_path)
    dur_secs = get_audio_duration_seconds(file_path, filename)
    dur_mins = max(1, (dur_secs + 59) // 60)

    is_ogg = filename.endswith(".ogg")
    safe_mime = "audio/ogg" if is_ogg else "audio/mp4"

    # Identify whether it's an internal discussion with Shailesh or client call
    is_shailesh = "9993963968" in filename or "shailesh" in filename.lower()
    is_vishal_dama = "vishal" in filename.lower() or "dama" in filename.lower()

    call_id = "call_" + uuid.uuid4().hex[:8]
    safe_name = filename.replace(" ", "_")
    target_filename = f"{call_id}_{safe_name}"

    # Save to local recordings folders
    with open(os.path.join(RECORDINGS_DIR, target_filename), "wb") as out_f:
        out_f.write(file_bytes)
    with open(os.path.join(BACKEND_RECORDINGS_DIR, target_filename), "wb") as out_f:
        out_f.write(file_bytes)

    if is_vishal_dama:
        print(f"\n=======================================================")
        print(f"Processing Client Call: {filename} (Vishal Dama)")
        print(f"Size: {size_bytes / (1024*1024):.2f} MB | Duration: {dur_secs}s ({dur_mins}m)")
        print(f"=======================================================")

        lead_id = "lead_8dc9abac"
        lead_name = "Vishal Dama"
        lead_biz = "Vishal Dama"

        call_data = {
            "id": call_id,
            "lead_id": lead_id,
            "user_id": "usr_e76bc446",  # Abhijeet
            "outcome": "Connected",
            "notes": f"Recorded Video Call / Discovery Discussion with Vishal Dama ({filename})",
            "duration_minutes": dur_mins,
            "recording_file_name": target_filename,
            "recording_mime_type": safe_mime,
            "recording_size_bytes": size_bytes,
            "recording_duration_secs": dur_secs,
            "recording_drive_url": f"/api/recordings/{target_filename}",
            "is_video": 1,
            "is_internal": 0,
            "call_type": "client",
            "called_at": called_at_iso,
        }
        Repository.log_call(call_data)

        # Upload to Google Drive under Clients/Vishal Dama
        drive_res = drive_upload(file_bytes, target_filename, safe_mime, lead_name, lead_biz)
        if drive_res and drive_res.get("file_id"):
            drive_fid = drive_res.get("file_id")
            drive_url = drive_res.get("web_view_link") or drive_res.get("embed_link")
            Repository.update_call_recording_drive(call_id, drive_fid, drive_url)
            print(f"  [DRIVE] Uploaded to Clients/Vishal Dama: {drive_url}")

        # Transcribe with Deepgram
        if deepgram_is_available():
            try:
                print("  [DEEPGRAM] Requesting transcription...")
                transcript_data = transcribe_audio(file_bytes, safe_mime)
                if transcript_data and (transcript_data.get("formatted_text") or transcript_data.get("text")):
                    text = transcript_data.get("formatted_text") or transcript_data.get("text")
                    conf = float(transcript_data.get("confidence") or 0.9)
                    Repository.update_call_transcription(call_id, transcription_text=text, confidence=conf, language="hi")
                    print(f"  [DEEPGRAM] Transcribed {len(text)} characters.")
            except Exception as e:
                print(f"  [DEEPGRAM ERROR] {e}")

    elif is_shailesh:
        print(f"\n=======================================================")
        print(f"Processing Internal Discussion: {filename} (Shailesh)")
        print(f"Size: {size_bytes / (1024*1024):.2f} MB | Duration: {dur_secs}s ({dur_mins}m)")
        print(f"=======================================================")

        direction = "IN" if "_in_" in filename else "OUT"
        notes = f"Internal team sync with Shailesh ({direction}) - {called_at_iso[:10]}"
        if "context" in filename.lower():
            notes = f"Strategy & Context Discussion with Shailesh ({filename})"

        call_data = {
            "id": call_id,
            "lead_id": None,
            "user_id": "usr_e76bc446",  # Abhijeet (caller / device owner)
            "teammate_user_id": "usr_550ef8c1",  # Shailesh
            "outcome": "Internal Sync",
            "notes": notes,
            "duration_minutes": dur_mins,
            "recording_file_name": target_filename,
            "recording_mime_type": safe_mime,
            "recording_size_bytes": size_bytes,
            "recording_duration_secs": dur_secs,
            "recording_drive_url": f"/api/recordings/{target_filename}",
            "is_video": 0,
            "is_internal": 1,
            "call_type": "internal",
            "called_at": called_at_iso,
        }
        Repository.log_call(call_data)

        # Upload to Google Drive under Internal_Discussions / Shailesh (9993963968) / 01_Call_Recordings
        try:
            drive_res = upload_internal_discussion_asset(
                teammate_name="Shailesh",
                phone="9993963968",
                category="calls",
                file_bytes=file_bytes,
                filename=target_filename,
                mime_type=safe_mime,
            )
            if drive_res and drive_res.get("file_id"):
                drive_fid = drive_res.get("file_id")
                drive_url = drive_res.get("web_view_link") or drive_res.get("embed_link")
                Repository._execute(
                    "UPDATE call_logs SET recording_drive_file_id = ?, recording_drive_url = ? WHERE id = ?",
                    (drive_fid, drive_url, call_id),
                    commit=True,
                )
                print(f"  [DRIVE] Uploaded to Internal_Discussions/Shailesh: {drive_url}")
        except Exception as d_err:
            print(f"  [DRIVE ERROR] {d_err}")

        # Transcribe via Deepgram
        if deepgram_is_available():
            try:
                print("  [DEEPGRAM] Requesting transcription...")
                transcript_data = transcribe_audio(file_bytes, safe_mime)
                if transcript_data and (transcript_data.get("formatted_text") or transcript_data.get("text")):
                    text = transcript_data.get("formatted_text") or transcript_data.get("text")
                    conf = float(transcript_data.get("confidence") or 0.9)
                    lang = transcript_data.get("language") or "hi"

                    # Upload transcript to Drive 02_Transcripts
                    t_filename = f"{call_id}_{os.path.splitext(safe_name)[0]}_transcript.txt"
                    t_drive_res = upload_internal_discussion_asset(
                        teammate_name="Shailesh",
                        phone="9993963968",
                        category="transcripts",
                        file_bytes=text.encode("utf-8"),
                        filename=t_filename,
                        mime_type="text/plain",
                    )
                    t_fid = t_drive_res.get("file_id") if t_drive_res else None

                    Repository.update_call_transcription(
                        call_id,
                        transcription_text=text,
                        drive_file_id=t_fid,
                        confidence=conf,
                        language=lang,
                    )
                    print(f"  [DEEPGRAM] Transcribed {len(text)} characters. Transcript Drive ID: {t_fid}")
            except Exception as tr_err:
                print(f"  [DEEPGRAM ERROR] {tr_err}")
    else:
        print(f"[SKIP] Unknown target for file: {filename}")

def main():
    print(f"Checking files in: {SYNC_DIR}")
    files = os.listdir(SYNC_DIR)
    print(f"Found {len(files)} pulled files to process.")

    # Process in chronological order (earliest to latest)
    files_sorted = sorted(files)
    for f in files_sorted:
        ingest_file(f)

    print("\n[COMPLETE] All pulled device recordings have been processed and synced!")

if __name__ == "__main__":
    main()
