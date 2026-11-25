"""
COS Theta — Calls & Audio Intelligence Router
Handles call logging, audio/video meeting attachments, Deepgram speech transcription,
Google Drive synchronization, and recording audio streaming.
"""

import datetime
import logging
import os
import re
import threading
import uuid
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from backend.database import Repository
from backend.auth import require_auth
from backend.integrations.google_drive import (
    drive_upload,
    drive_get_stream,
    ROOT_FOLDER_ID,
    attach_drive_meeting_by_id_or_url,
    upload_internal_discussion_asset,
    ensure_internal_discussion_drive_hierarchy,
    create_client_internal_sync_shortcut,
    is_available as drive_is_available,
)
from backend.integrations.deepgram import transcribe_audio, is_available as deepgram_is_available
from backend.integrations.github_vault import (
    push_file_to_github,
    update_media_manifest_in_vault,
    GITHUB_TOKEN,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["calls"])
_drive_sync_lock = threading.Lock()


def _background_transcribe(call_id: str, file_bytes: bytes, mime_type: str, lead_name: str, lead_biz: str):
    """Background task: transcribe recording with Deepgram and upload transcript to Drive and GitHub."""
    try:
        result = transcribe_audio(file_bytes, mime_type)
        if not result or not result.get("text"):
            return

        transcript_text = result.get("formatted_text") or result["text"]
        drive_file_id = None

        # Upload transcript as .txt to Drive
        try:
            txt_content = (
                f"CALL TRANSCRIPT\nLead: {lead_name}\nConfidence: {result.get('confidence', 0):.1%}\n"
                f"Language: {result.get('language', 'en')}\n{'='*50}\n\n{transcript_text}"
            )
            txt_bytes = txt_content.encode("utf-8")
            txt_result = drive_upload(
                txt_bytes,
                f"{call_id}_transcript.txt",
                "text/plain",
                lead_name,
                lead_biz,
            )
            if txt_result:
                drive_file_id = txt_result["file_id"]
        except Exception:
            pass

        # Update DB
        Repository.update_call_transcription(
            call_id,
            transcript_text,
            drive_file_id,
            result.get("confidence"),
            result.get("language"),
        )
        logger.info(f"Transcription saved for {call_id}: {len(transcript_text)} chars")

        # Automatically push transcript to GitHub vault if lead has an active repository
        try:
            c_row = Repository._execute(
                "SELECT lead_id, created_at, is_video, recording_drive_file_id FROM call_logs WHERE id = ?",
                (call_id,),
                fetchone=True,
            )
            if c_row and c_row.get("lead_id"):
                target_lead = Repository.get_lead(c_row["lead_id"])
                if target_lead and target_lead.get("github_repo_url"):
                    gh_url = target_lead["github_repo_url"]
                    m = re.search(r"github\.com[/:]([^/]+/[^/]+?)(?:\.git)?$", gh_url)
                    if m:
                        repo_full = m.group(1)
                        c_date = (c_row.get("created_at") or datetime.date.today().strftime("%Y-%m-%d"))[:10]
                        drive_fid_eff = drive_file_id or c_row.get("recording_drive_file_id")
                        drive_url = f"https://drive.google.com/file/d/{drive_fid_eff}/view" if drive_fid_eff else ""
                        is_vid = bool(c_row.get("is_video"))
                        drive_hdr = (
                            f"[🎥 Watch Video Meeting Recording on Google Drive]({drive_url})\n\n"
                            if (is_vid and drive_url)
                            else (f"[🎙️ Listen to Audio Recording on Google Drive]({drive_url})\n\n" if drive_url else "")
                        )
                        title_prefix = "Video Meeting Transcript" if is_vid else "Call Transcript"
                        md_body = (
                            f"# {title_prefix}: {c_date} ({call_id})\n"
                            f"- **Client**: {lead_biz or lead_name}\n"
                            f"- **Date**: {c_row.get('created_at', '')}\n"
                            f"- **Medium**: {'🎥 Google Meet / Screen Video' if is_vid else '🎙️ Phone Call (Audio)'}\n\n"
                            f"---\n\n{drive_hdr}### Deepgram Speech Transcript\n{transcript_text}\n"
                        )
                        token = os.environ.get("GITHUB_TOKEN", GITHUB_TOKEN)
                        push_file_to_github(
                            repo_full,
                            f"context/transcripts/{c_date}_{call_id}.md",
                            md_body,
                            token,
                            commit_message=f"docs(transcript): auto-synced Deepgram {'video meeting' if is_vid else 'call'} {call_id}",
                        )
                        logger.info(f"[GITHUB SYNC] Pushed Deepgram transcript {call_id} directly to {repo_full}!")

                # Always synchronize context/media_manifest.json with new transcript & drive links
                try:
                    update_media_manifest_in_vault(c_row["lead_id"])
                except Exception as mf_err:
                    logger.warning(f"[MANIFEST SYNC WARNING] {mf_err}")
        except Exception as gh_err:
            logger.warning(f"[GITHUB SYNC WARNING] Could not push transcript to GitHub: {gh_err}")
    except Exception as e:
        logger.error(f"Background transcription failed for {call_id}: {e}")


def _sync_recording_to_drive(file_bytes, call_id_preview, safe_name, mime_type, lead_name, lead_biz, phone=None, duration_seconds=0):
    res = {"drive_url": None, "drive_file_id": None, "client_folder_id": None, "client_folder_url": None}
    try:
        with _drive_sync_lock:
            drive_result = drive_upload(
                file_bytes, f"{call_id_preview}_{safe_name}",
                mime_type,
                lead_name, lead_biz
            )
        if drive_result:
            res["drive_file_id"] = drive_result.get("file_id")
            res["drive_url"] = (
                drive_result.get("web_view_link") or
                drive_result.get("preview_link") or
                drive_result.get("embed_link")
            )
            res["client_folder_id"] = drive_result.get("client_folder_id")
            res["client_folder_url"] = drive_result.get("client_folder_url")
    except Exception as e:
        logger.error(f"Drive upload failed: {e}")

    return res


def _background_drive_and_transcribe(
    call_id: str,
    lead_id: str,
    file_bytes: bytes,
    call_id_preview: str,
    safe_name: str,
    mime_type: str,
    lead_name: str,
    lead_biz: str,
    phone: Optional[str] = None,
    duration_seconds: int = 0
):
    try:
        drive_res = _sync_recording_to_drive(
            file_bytes, call_id_preview, safe_name, mime_type, lead_name, lead_biz, phone=phone, duration_seconds=duration_seconds
        )
        drive_url = drive_res.get("drive_url")
        drive_file_id = drive_res.get("drive_file_id")

        if drive_file_id or drive_url:
            Repository.update_call_recording_drive(call_id, drive_file_id, drive_url)

        _background_transcribe(call_id, file_bytes, mime_type, lead_name, lead_biz)
        if lead_id:
            update_media_manifest_in_vault(lead_id)
    except Exception as e:
        logger.error(f"Background drive sync and transcription failed for call {call_id}: {e}")


def _background_internal_drive_and_transcribe(
    call_id: str,
    teammate_user_id: str,
    teammate_name: str,
    phone: str,
    file_bytes: bytes,
    safe_name: str,
    mime_type: str,
    duration_seconds: int = 0,
    caller_name: Optional[str] = None,
    lead_id: Optional[str] = None,
):
    try:
        # 1. Upload audio recording to Drive Internal_Discussions/Team_Syncs - {Name1} & {Name2}/01_Call_Recordings
        drive_res = upload_internal_discussion_asset(
            teammate_name=teammate_name,
            phone=phone,
            category="calls",
            file_bytes=file_bytes,
            filename=safe_name,
            mime_type=mime_type,
            caller_name=caller_name,
        )
        drive_fid = None
        if drive_res and drive_res.get("file_id"):
            drive_fid = drive_res.get("file_id")
            drive_url = drive_res.get("web_view_link") or drive_res.get("embed_link")
            Repository._execute(
                "UPDATE call_logs SET recording_drive_file_id = ?, recording_drive_url = ? WHERE id = ?",
                (drive_fid, drive_url, call_id),
                commit=True
            )

        # 2. Transcribe via Deepgram
        try:
            transcript_data = transcribe_audio(file_bytes, mime_type)
            if transcript_data and (transcript_data.get("formatted_text") or transcript_data.get("text")):
                transcript_text = transcript_data.get("formatted_text") or transcript_data.get("text")
                confidence = float(transcript_data.get("confidence") or 0.9)
                lang = transcript_data.get("language") or "hi"

                # Upload transcript text to Drive Internal_Discussions/Team_Syncs - .../02_Transcripts
                t_filename = f"{os.path.splitext(safe_name)[0]}_transcript.txt"
                t_bytes = transcript_text.encode("utf-8")
                t_drive_res = upload_internal_discussion_asset(
                    teammate_name=teammate_name,
                    phone=phone,
                    category="transcripts",
                    file_bytes=t_bytes,
                    filename=t_filename,
                    mime_type="text/plain",
                    caller_name=caller_name,
                )
                t_drive_fid = t_drive_res.get("file_id") if t_drive_res else None

                Repository.update_call_transcription(
                    call_id,
                    transcription_text=transcript_text,
                    drive_file_id=t_drive_fid,
                    confidence=confidence,
                    language=lang,
                )
                logger.info(f"Successfully transcribed and archived internal discussion {call_id} with {teammate_name}")

                # If this discussion is already linked to a lead, auto-mirror into client vault
                if lead_id:
                    update_media_manifest_in_vault(lead_id)
                    if drive_fid:
                        lead = Repository.get_lead(lead_id)
                        if lead:
                            from backend.integrations.github_vault import slugify
                            c_slug = slugify(lead.get("business_name") or lead.get("name") or lead_id)
                            c_name = lead.get("name") or "Client"
                            c_biz = lead.get("business_name") or ""
                            c_date = datetime.datetime.now().strftime("%Y-%m-%d")
                            shortcut_name = f"{c_date}_{call_id}_Internal_Strategy_Sync"
                            create_client_internal_sync_shortcut(c_slug, c_name, drive_fid, shortcut_name, c_biz)
        except Exception as tr_err:
            logger.error(f"Internal discussion transcription failed for {call_id}: {tr_err}")

    except Exception as e:
        logger.error(f"Internal discussion Drive & transcribe pipeline failed for {call_id}: {e}")



@router.post("/api/leads/{id}/calls")
async def log_call(
    id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_auth),
):
    content_type = request.headers.get("content-type", "")

    if "multipart/form-data" in content_type:
        form = await request.form()
        outcome = form.get("outcome", "Connected")
        notes = form.get("notes", "")
        duration_minutes = int(form.get("duration_minutes", 5))

        recording_data = {}
        _file_bytes_for_transcription = None
        _mime_for_transcription = None
        upload_file = form.get("recording")
        if upload_file and hasattr(upload_file, "filename") and upload_file.filename:
            file_bytes = await upload_file.read()
            if len(file_bytes) > 0:
                call_id_preview = "call_" + uuid.uuid4().hex[:8]
                recordings_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "recordings")
                os.makedirs(recordings_dir, exist_ok=True)

                safe_name = upload_file.filename.replace("..", "").replace("/", "_").replace("\\", "_")
                save_path = os.path.join(recordings_dir, f"{call_id_preview}_{safe_name}")
                with open(save_path, "wb") as f:
                    f.write(file_bytes)

                is_vid = 1 if (
                    (upload_file.content_type or "").startswith("video/")
                    or upload_file.filename.lower().endswith((".mp4", ".webm", ".mov", ".mkv", ".avi"))
                ) else 0
                safe_mime = upload_file.content_type or ("video/mp4" if is_vid else "audio/mpeg")

                recording_data["recording_file_name"] = f"{call_id_preview}_{safe_name}"
                recording_data["recording_mime_type"] = safe_mime
                recording_data["recording_size_bytes"] = len(file_bytes)
                recording_data["is_video"] = is_vid

                _file_bytes_for_transcription = file_bytes
                _mime_for_transcription = safe_mime

                lead = Repository.get_lead(id)
                lead_name = lead.get("name", "Unknown") if lead else "Unknown"
                lead_biz = lead.get("business_name", "") if lead else ""
                try:
                    drive_result = drive_upload(
                        file_bytes,
                        f"{call_id_preview}_{safe_name}",
                        safe_mime,
                        lead_name,
                        lead_biz,
                    )
                    if drive_result:
                        recording_data["recording_drive_file_id"] = drive_result["file_id"]
                        recording_data["recording_drive_url"] = drive_result.get("preview_link") or drive_result.get("embed_link")
                except Exception:
                    pass

        d = {
            "lead_id": id,
            "user_id": user.get("user_id"),
            "outcome": outcome,
            "notes": notes,
            "duration_minutes": duration_minutes,
            **recording_data,
        }
    else:
        body = await request.json()
        d = {
            "lead_id": id,
            "user_id": user.get("user_id"),
            "outcome": body.get("outcome", "Connected"),
            "notes": body.get("notes", ""),
            "duration_minutes": body.get("duration_minutes", 5),
            "is_video": 0,
        }
        recording_data = {}
        _file_bytes_for_transcription = None
        _mime_for_transcription = None

    result = Repository.log_call(d)

    if _file_bytes_for_transcription and deepgram_is_available():
        lead = Repository.get_lead(id)
        lead_name = lead.get("name", "Unknown") if lead else "Unknown"
        lead_biz = lead.get("business_name", "") if lead else ""
        background_tasks.add_task(
            _background_transcribe,
            result["id"],
            _file_bytes_for_transcription,
            _mime_for_transcription,
            lead_name,
            lead_biz,
        )
    elif recording_data.get("recording_drive_file_id"):
        background_tasks.add_task(update_media_manifest_in_vault, id)

    return result


@router.post("/api/crm/calls/recordings")
async def save_recording(
    file: UploadFile = File(...),
    lead_id: Optional[str] = Form(None),
    phone: Optional[str] = Form(None),
    lead_name: Optional[str] = Form(None),
    lead_business: Optional[str] = Form(None),
    outcome: Optional[str] = Form("Connected"),
    notes: Optional[str] = Form(None),
    duration_minutes: Optional[int] = Form(5),
    called_at: Optional[str] = Form(None),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty recording payload")

    call_id_preview = "call_" + uuid.uuid4().hex[:8]
    safe_name = file.filename.replace("..", "").replace("/", "_").replace("\\", "_")
    mime_type = file.content_type or "audio/mpeg"

    target_lead_id = lead_id
    resolved_name = lead_name or "Unknown"
    resolved_biz = lead_business or ""

    if not target_lead_id and phone:
        matched_teammate = Repository.get_user_by_phone(phone)
        if matched_teammate:
            teammate_user_id = matched_teammate["id"]
            teammate_name = matched_teammate.get("name") or "Teammate"

            recordings_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "recordings")
            os.makedirs(recordings_dir, exist_ok=True)
            save_path = os.path.join(recordings_dir, f"{call_id_preview}_{safe_name}")
            with open(save_path, "wb") as f:
                f.write(file_bytes)

            duration_secs = (duration_minutes or 5) * 60
            try:
                import mutagen
                audio = mutagen.File(save_path)
                if audio and audio.info:
                    duration_secs = int(audio.info.length)
            except Exception:
                pass

            call_data = {
                "id": call_id_preview,
                "lead_id": None,
                "user_id": None,
                "outcome": outcome or "Internal Sync",
                "notes": notes or f"Internal discussion recording with {teammate_name}",
                "duration_minutes": max(1, duration_secs // 60),
                "recording_file_name": f"{call_id_preview}_{safe_name}",
                "recording_mime_type": mime_type,
                "recording_size_bytes": len(file_bytes),
                "recording_duration_secs": duration_secs,
                "is_video": 0,
                "is_internal": 1,
                "teammate_user_id": teammate_user_id,
                "call_type": "internal",
            }
            if called_at:
                call_data["called_at"] = called_at

            result = Repository.log_call(call_data)

            background_tasks.add_task(
                _background_internal_drive_and_transcribe,
                call_id_preview,
                teammate_user_id,
                teammate_name,
                phone,
                file_bytes,
                f"{call_id_preview}_{safe_name}",
                mime_type,
                duration_secs,
            )

            return {
                "status": "success",
                "is_internal": True,
                "call_id": call_id_preview,
                "teammate_user_id": teammate_user_id,
                "teammate_name": teammate_name,
                "recording_file_name": f"{call_id_preview}_{safe_name}",
                "message": f"Internal discussion with {teammate_name} registered.",
            }

        matched = Repository.get_lead_by_phone(phone)
        if matched:
            target_lead_id = matched["id"]
            resolved_name = matched.get("name", resolved_name)
            resolved_biz = matched.get("business_name", resolved_biz)

    if not target_lead_id:
        new_lead = Repository.create_lead({
            "name": resolved_name,
            "business_name": resolved_biz,
            "phone": phone,
            "source": "phone_recording_auto",
            "status": "new",
            "temperature": "warm",
        })
        target_lead_id = new_lead["id"]

    recordings_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "recordings")
    os.makedirs(recordings_dir, exist_ok=True)
    save_path = os.path.join(recordings_dir, f"{call_id_preview}_{safe_name}")
    with open(save_path, "wb") as f:
        f.write(file_bytes)

    duration_secs = (duration_minutes or 5) * 60
    try:
        import mutagen
        audio = mutagen.File(save_path)
        if audio and audio.info:
            duration_secs = int(audio.info.length)
    except Exception:
        pass

    call_data = {
        "id": call_id_preview,
        "lead_id": target_lead_id,
        "outcome": outcome or "Connected",
        "notes": notes or "Uploaded from phone call recording sync agent.",
        "duration_minutes": max(1, duration_secs // 60),
        "recording_file_name": f"{call_id_preview}_{safe_name}",
        "recording_mime_type": mime_type,
        "recording_size_bytes": len(file_bytes),
        "recording_duration_secs": duration_secs,
        "is_video": 0,
    }
    if called_at:
        call_data["called_at"] = called_at

    result = Repository.log_call(call_data)

    background_tasks.add_task(
        _background_drive_and_transcribe,
        call_id=call_id_preview,
        lead_id=target_lead_id,
        file_bytes=file_bytes,
        call_id_preview=call_id_preview,
        safe_name=safe_name,
        mime_type=mime_type,
        lead_name=resolved_name,
        lead_biz=resolved_biz,
        phone=phone,
        duration_seconds=duration_secs,
    )

    return {
        "status": "success",
        "call_id": call_id_preview,
        "lead_id": target_lead_id,
        "recording_file_name": f"{call_id_preview}_{safe_name}",
        "message": "Call recording registered. Drive upload & transcription running asynchronously.",
    }


@router.get("/api/crm/calls/recordings")
def list_recordings():
    calls = Repository._execute("""
        SELECT c.*, 
               l.name as lead_name, l.business_name, l.phone as lead_phone,
               u1.name as caller_name,
               u2.name as teammate_name, u2.phone as teammate_phone
        FROM call_logs c
        LEFT JOIN leads l ON c.lead_id = l.id
        LEFT JOIN users u1 ON c.user_id = u1.id
        LEFT JOIN users u2 ON c.teammate_user_id = u2.id
        WHERE c.recording_file_name IS NOT NULL OR c.recording_drive_file_id IS NOT NULL
        ORDER BY c.called_at DESC
        LIMIT 100
    """, fetchall=True)
    return {"recordings": calls or []}


@router.get("/api/crm/calls/internal")
def list_internal_calls(teammate_user_id: Optional[str] = None, user: dict = Depends(require_auth)):
    calls = Repository.get_internal_calls(teammate_user_id=teammate_user_id)
    return {"internal_calls": calls or []}


@router.put("/api/crm/calls/internal/{call_id}/link-lead")
async def link_internal_call_to_lead(
    call_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_auth)
):
    body = await request.json()
    lead_id = body.get("lead_id")
    res = Repository.link_internal_call_to_lead(call_id, lead_id)

    if lead_id:
        # 1. Update media manifest and write transcripts into client project vault
        background_tasks.add_task(update_media_manifest_in_vault, lead_id)

        # 2. Check if recording has Drive file ID, and create shortcut in client's Drive folder
        call_obj = Repository._execute("SELECT * FROM call_logs WHERE id = ?", (call_id,), fetchone=True)
        call_dict = dict(call_obj) if call_obj else {}
        drive_fid = call_dict.get("recording_drive_file_id")
        lead = Repository.get_lead(lead_id)
        if drive_fid and lead:
            from backend.integrations.github_vault import slugify
            c_slug = slugify(lead.get("business_name") or lead.get("name") or lead_id)
            c_name = lead.get("name") or "Client"
            c_biz = lead.get("business_name") or ""
            c_date = (call_dict.get("called_at") or call_dict.get("created_at") or datetime.datetime.now().strftime("%Y-%m-%d"))[:10]
            shortcut_name = f"{c_date}_{call_id}_Internal_Strategy_Sync"
            background_tasks.add_task(
                create_client_internal_sync_shortcut,
                c_slug,
                c_name,
                drive_fid,
                shortcut_name,
                c_biz
            )

    return {"status": "success", "call": res}


@router.get("/api/crm/calls/internal/{call_id}/mentions")
def list_internal_call_mentions(call_id: str, user: dict = Depends(require_auth)):
    """Returns all client leads mentioned in a specific internal discussion."""
    mentions = Repository.get_call_lead_mentions(call_id)
    return {"call_id": call_id, "mentions": mentions or []}


@router.post("/api/crm/calls/internal/{call_id}/mentions")
async def add_internal_call_lead_mention(
    call_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_auth)
):
    """
    Associates an internal discussion with a client lead without binding the entire call to that lead.
    Enables tracking multiple leads per internal sync with dedicated excerpts and action items.
    """
    body = await request.json()
    lead_id = body.get("lead_id")
    if not lead_id:
        raise HTTPException(status_code=400, detail="lead_id is required")

    topic = body.get("topic") or "Internal Strategy Sync"
    notes = body.get("notes") or ""
    transcript_excerpt = body.get("transcript_excerpt") or ""
    action_items = body.get("action_items") or ""
    time_offset_start = int(body.get("time_offset_start") or 0)
    time_offset_end = int(body.get("time_offset_end") or 0)

    mention = Repository.add_call_lead_mention(
        call_id=call_id,
        lead_id=lead_id,
        topic=topic,
        notes=notes,
        transcript_excerpt=transcript_excerpt,
        action_items=action_items,
        time_offset_start=time_offset_start,
        time_offset_end=time_offset_end
    )

    # 1. Update client project vault in background (media manifest & mention markdown)
    background_tasks.add_task(update_media_manifest_in_vault, lead_id)

    # 2. Check if recording has Drive file ID, and create shortcut in client's Drive folder
    call_obj = Repository._execute("SELECT * FROM call_logs WHERE id = ?", (call_id,), fetchone=True)
    call_dict = dict(call_obj) if call_obj else {}
    drive_fid = call_dict.get("recording_drive_file_id")
    lead = Repository.get_lead(lead_id)
    if drive_fid and lead:
        from backend.integrations.github_vault import slugify
        c_slug = slugify(lead.get("business_name") or lead.get("name") or lead_id)
        c_name = lead.get("name") or "Client"
        c_biz = lead.get("business_name") or ""
        c_date = (call_dict.get("called_at") or call_dict.get("created_at") or datetime.datetime.now().strftime("%Y-%m-%d"))[:10]
        shortcut_name = f"{c_date}_{call_id}_Internal_Strategy_Sync"
        background_tasks.add_task(
            create_client_internal_sync_shortcut,
            c_slug,
            c_name,
            drive_fid,
            shortcut_name,
            c_biz
        )

    return {"status": "success", "mention": mention}


@router.delete("/api/crm/calls/internal/{call_id}/mentions/{mention_id}")
def delete_internal_call_lead_mention(
    call_id: str,
    mention_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_auth)
):
    """Removes a lead mention from an internal discussion and refreshes the client vault."""
    mentions = Repository.get_call_lead_mentions(call_id)
    target = next((m for m in mentions if m["id"] == mention_id), None)
    res = Repository.delete_call_lead_mention(mention_id)

    if target and target.get("lead_id"):
        background_tasks.add_task(update_media_manifest_in_vault, target["lead_id"])

    return {"status": "success", "result": res}


@router.post("/api/crm/calls/internal/{call_id}/auto-segment")
async def auto_segment_internal_call(
    call_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_auth)
):
    """
    Intelligently scans the Deepgram transcript of an internal discussion,
    identifies mentions of existing CRM leads, extracts the context excerpts,
    and automatically associates lead mentions without human intervention.
    """
    call_obj = Repository._execute("SELECT * FROM call_logs WHERE id = ?", (call_id,), fetchone=True)
    if not call_obj:
        raise HTTPException(status_code=404, detail="Call not found")
    call_dict = dict(call_obj)
    transcript = (call_dict.get("transcription_text") or "").strip()
    if not transcript:
        return {"status": "skipped", "message": "No transcript available yet for auto-segmentation", "mentions": []}

    leads = Repository._execute("SELECT id, name, business_name, phone FROM leads", fetchall=True) or []
    detected_mentions = []
    norm_transcript = transcript.lower()

    for l in leads:
        lid = l["id"]
        lname = (l.get("name") or "").strip()
        lbiz = (l.get("business_name") or "").strip()

        matched = False
        matched_term = ""

        # Match by person name (if length >= 4)
        name_parts = [p.lower() for p in lname.split() if len(p) >= 3 and p.lower() not in {"test", "client", "prospect", "corp", "inc", "ltd"}]
        biz_parts = [p.lower() for p in lbiz.split() if len(p) >= 3 and p.lower() not in {"test", "client", "prospect", "corp", "inc", "ltd"}]

        if len(lname) >= 4 and lname.lower() in norm_transcript:
            matched = True
            matched_term = lname
        elif len(name_parts) >= 2 and all(p in norm_transcript for p in name_parts):
            matched = True
            matched_term = " ".join(name_parts)
        # Match by business name (if length >= 4)
        elif len(lbiz) >= 4 and lbiz.lower() in norm_transcript:
            matched = True
            matched_term = lbiz
        elif len(biz_parts) >= 2 and all(p in norm_transcript for p in biz_parts):
            matched = True
            matched_term = " ".join(biz_parts)

        if matched:
            # Extract paragraph or surrounding sentences
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
            detected_mentions.append(mention)
            background_tasks.add_task(update_media_manifest_in_vault, lid)

    return {
        "status": "success",
        "call_id": call_id,
        "total_detected": len(detected_mentions),
        "mentions": detected_mentions
    }


@router.get("/api/users/{user_id}/drive/open")
def open_teammate_drive_folder(user_id: str, user: dict = Depends(require_auth)):
    u = Repository.get_user(user_id)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    h = ensure_internal_discussion_drive_hierarchy(u.get("name", "Teammate"), u.get("phone", ""))
    url = h.get("member_folder_url") or f"https://drive.google.com/drive/folders/{ROOT_FOLDER_ID}"
    return RedirectResponse(url=url)


@router.get("/api/crm/calls")
def list_calls(limit: int = 100, offset: int = 0, user: dict = Depends(require_auth)):
    user_id_filter = None if user.get("role") == "admin" else user.get("user_id")
    calls = Repository.get_all_calls(limit=limit, offset=offset, user_id=user_id_filter)
    return {"calls": calls, "total": len(calls)}


@router.get("/api/crm/leads/check-phone")
def check_lead_phone(phone: str, user: dict = Depends(require_auth)):
    matched_teammate = Repository.get_user_by_phone(phone)
    if matched_teammate:
        return {
            "is_lead": False,
            "is_teammate": True,
            "teammate_id": matched_teammate["id"],
            "teammate_name": matched_teammate.get("name"),
            "phone": phone,
        }
    lead = Repository.get_lead_by_phone(phone)
    if lead:
        return {
            "is_lead": True,
            "is_teammate": False,
            "lead_id": lead["id"],
            "lead_name": lead.get("name"),
            "business_name": lead.get("business_name"),
            "phone": phone,
        }
    return {
        "is_lead": False,
        "is_teammate": False,
        "lead_id": None,
        "lead_name": None,
        "business_name": None,
        "phone": phone,
    }


@router.post("/api/leads/{id}/meetings/attach-drive")
async def attach_drive_meeting(
    id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_auth),
):
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    body = await request.json()
    drive_input = (body.get("drive_file_id_or_url") or "").strip()
    if not drive_input:
        raise HTTPException(status_code=400, detail="Google Drive URL or File ID is required")

    title = body.get("title") or "Video Meeting / Discovery Call"
    notes = body.get("notes") or "Recorded meeting linked via Google Drive."
    outcome = body.get("outcome") or "Connected"
    duration_minutes = int(body.get("duration_minutes") or 30)
    should_transcribe = bool(body.get("transcribe", True))

    lead_name = lead.get("name", "Unknown")
    lead_biz = lead.get("business_name", "")
    client_slug = re.sub(r"[^a-zA-Z0-9_\-]", "", (lead_biz or lead_name).lower().replace(" ", "-")).strip("-") or "client"

    meta = attach_drive_meeting_by_id_or_url(
        client_slug=client_slug,
        client_name=lead_name,
        drive_file_id_or_url=drive_input,
        title=title,
        business_name=lead_biz,
    )

    if not meta or not meta.get("file_id"):
        raise HTTPException(status_code=400, detail="Could not resolve Google Drive file from input.")

    call_data = {
        "lead_id": id,
        "user_id": user.get("user_id"),
        "outcome": outcome,
        "notes": f"[{title}] {notes}",
        "duration_minutes": duration_minutes,
        "recording_file_name": meta.get("filename"),
        "recording_mime_type": meta.get("mime_type") or "video/mp4",
        "recording_size_bytes": meta.get("size_bytes") or 0,
        "recording_duration_secs": duration_minutes * 60,
        "recording_drive_file_id": meta.get("file_id"),
        "recording_drive_url": meta.get("preview_link") or meta.get("web_view_link"),
        "is_video": 1,
    }

    result = Repository.log_call(call_data)

    if should_transcribe and deepgram_is_available() and meta.get("file_id"):
        def _fetch_and_transcribe_drive():
            try:
                stream_res = drive_get_stream(meta["file_id"])
                if stream_res:
                    f_bytes, f_mime = stream_res
                    _background_transcribe(
                        result["id"], f_bytes, f_mime, lead_name, lead_biz
                    )
            except Exception as e:
                logger.error(f"Error fetching Drive stream for transcription: {e}")
        background_tasks.add_task(_fetch_and_transcribe_drive)
    else:
        background_tasks.add_task(update_media_manifest_in_vault, id)

    return {
        "status": "success",
        "meeting": result,
        "drive_metadata": meta,
    }


@router.get("/api/recordings/{filename}")
def stream_recording(filename: str):
    recordings_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "recordings")
    file_path = os.path.join(recordings_dir, filename)
    if os.path.exists(file_path):
        ext = os.path.splitext(filename)[1].lower()
        media_types = {
            ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
            ".ogg": "audio/ogg", ".webm": "audio/webm",
            ".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
        }
        media_type = media_types.get(ext, "application/octet-stream")
        return FileResponse(file_path, media_type=media_type, filename=filename)
    raise HTTPException(status_code=404, detail="Recording not found")


@router.get("/api/recordings/drive/{file_id}")
def stream_drive_recording(file_id: str):
    result = drive_get_stream(file_id)
    if not result:
        raise HTTPException(status_code=404, detail="Drive recording not found")
    file_bytes, mime_type = result
    from io import BytesIO
    return StreamingResponse(BytesIO(file_bytes), media_type=mime_type)


@router.post("/api/crm/calls/mobile-sync")
async def mobile_sync_call(
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_auth),
):
    """
    Direct ingestion endpoint for the Cold Calling mobile application.
    """
    from datetime import datetime as _dt, timezone as _tz, timedelta as _td
    import re as _re

    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" not in content_type:
        raise HTTPException(status_code=400, detail="Expected multipart/form-data")

    form = await request.form()
    caller_user_id = (user.get("user_id") if user else None) or form.get("user_id")
    phone = (form.get("phone") or "").strip()
    duration_seconds = int(form.get("duration_seconds") or form.get("duration") or 0)
    duration_minutes = max(1, (duration_seconds + 59) // 60) if duration_seconds > 0 else int(form.get("duration_minutes", 1))
    direction = (form.get("direction") or "out").lower()
    outcome = form.get("outcome") or ("Connected" if duration_seconds > 0 else "No Answer")
    notes = form.get("notes") or f"Mobile Call ({direction.upper()})"
    called_at_raw = (form.get("called_at") or "").strip()

    called_at_iso = None
    if called_at_raw:
        try:
            if called_at_raw.isdigit():
                val = int(called_at_raw)
                if val > 0:
                    ts_sec = val / 1000.0 if val > 100_000_000_000 else float(val)
                    called_at_iso = _dt.fromtimestamp(ts_sec, tz=_tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            else:
                called_at_iso = called_at_raw
        except Exception as ts_err:
            logger.warning(f"Failed to parse called_at '{called_at_raw}': {ts_err}")

    # 1. Check if the phone number belongs to an internal team member!
    matched_teammate = Repository.get_user_by_phone(phone)
    if matched_teammate:
        logger.info(f"Routing mobile call sync as internal team discussion with {matched_teammate['name']} ({phone})")
        teammate_user_id = matched_teammate["id"]
        teammate_name = matched_teammate.get("name") or "Teammate"

        recording_data = {}
        _file_bytes_for_bg = None
        _mime_for_bg = None
        _call_id_preview = None
        _safe_name = None
        upload_file = form.get("recording") or form.get("file") or form.get("audio_file")

        if upload_file and hasattr(upload_file, "filename") and upload_file.filename:
            safe_name = upload_file.filename.replace("..", "").replace("/", "_").replace("\\", "_")
            _safe_name = safe_name

            if not called_at_iso:
                m = _re.match(r"^(\d{8}_\d{6})", safe_name)
                if m:
                    try:
                        ist_tz = _tz(_td(hours=5, minutes=30))
                        dt_local = _dt.strptime(m.group(1), "%Y%m%d_%H%M%S").replace(tzinfo=ist_tz)
                        called_at_iso = dt_local.astimezone(_tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                    except Exception:
                        pass

            existing_call = Repository._execute(
                "SELECT * FROM call_logs WHERE is_internal = 1 AND teammate_user_id = ? AND recording_file_name LIKE ? ORDER BY called_at DESC LIMIT 1",
                (teammate_user_id, f"%_{safe_name}"),
                fetchone=True,
            )
            if existing_call:
                if called_at_iso and existing_call.get("called_at") != called_at_iso:
                    Repository._execute(
                        "UPDATE call_logs SET called_at = ? WHERE id = ?",
                        (called_at_iso, existing_call["id"]),
                        commit=True,
                    )
                return {
                    "status": "success",
                    "is_internal": True,
                    "deduplicated": True,
                    "call_id": existing_call["id"],
                    "teammate_user_id": teammate_user_id,
                    "teammate_name": teammate_name,
                    "drive_url": existing_call.get("recording_drive_url"),
                    "drive_file_id": existing_call.get("recording_drive_file_id"),
                }

            file_bytes = await upload_file.read()
            if len(file_bytes) > 0:
                call_id_preview = "call_" + uuid.uuid4().hex[:8]
                _call_id_preview = call_id_preview
                recordings_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "recordings")
                os.makedirs(recordings_dir, exist_ok=True)

                save_path = os.path.join(recordings_dir, f"{call_id_preview}_{safe_name}")
                with open(save_path, "wb") as f:
                    f.write(file_bytes)

                mime_type = upload_file.content_type or "audio/ogg"
                if safe_name.endswith(".m4a"):
                    mime_type = "audio/mp4"
                elif safe_name.endswith((".ogg", ".opus", ".oga")):
                    mime_type = "audio/ogg"

                recording_data["recording_file_name"] = f"{call_id_preview}_{safe_name}"
                recording_data["recording_mime_type"] = mime_type
                recording_data["recording_size_bytes"] = len(file_bytes)
                recording_data["recording_duration_secs"] = duration_seconds
                recording_data["is_video"] = 0
                recording_data["recording_drive_url"] = f"/api/recordings/{call_id_preview}_{safe_name}"

                _file_bytes_for_bg = file_bytes
                _mime_for_bg = mime_type

        d = {
            "lead_id": None,
            "user_id": caller_user_id,
            "outcome": "Internal Sync",
            "notes": form.get("notes") or f"Internal discussion with {teammate_name} ({direction.upper()})",
            "duration_minutes": duration_minutes,
            "called_at": called_at_iso,
            "is_internal": 1,
            "teammate_user_id": teammate_user_id,
            "call_type": "internal",
            **recording_data,
        }
        caller_name = (user.get("name") if user else None) or form.get("caller_name")
        if not caller_name and caller_user_id:
            u_obj = Repository.get_user(caller_user_id)
            if u_obj:
                caller_name = u_obj.get("name")
        caller_name = caller_name or "Founder"

        if _file_bytes_for_bg:
            background_tasks.add_task(
                _background_internal_drive_and_transcribe,
                result["id"],
                teammate_user_id,
                teammate_name,
                phone,
                _file_bytes_for_bg,
                f"{_call_id_preview}_{_safe_name}",
                _mime_for_bg,
                duration_seconds,
                caller_name=caller_name,
                lead_id=None,
            )

        return {
            "status": "success",
            "is_internal": True,
            "call_id": result["id"],
            "teammate_user_id": teammate_user_id,
            "teammate_name": teammate_name,
            "drive_url": recording_data.get("recording_drive_url"),
            "drive_file_id": recording_data.get("recording_drive_file_id"),
            "message": f"Internal discussion recording with {teammate_name} archived.",
        }

    lead = Repository.get_lead_by_phone(phone)
    if not lead:
        logger.info(f"Skipping call sync for {phone}: Phone number is not an existing CRM lead.")
        return {
            "status": "skipped",
            "is_lead": False,
            "message": f"Number '{phone}' is not a registered CRM lead. Audio recording excluded from Google Drive and CRM storage.",
            "phone": phone,
        }

    lead_id = lead["id"]
    lead_name = lead.get("name") or f"Prospect {phone}"
    lead_biz = lead.get("business_name") or ""

    recording_data = {}
    _file_bytes_for_bg = None
    _mime_for_bg = None
    _call_id_preview = None
    _safe_name = None
    upload_file = form.get("recording") or form.get("file") or form.get("audio_file")

    if upload_file and hasattr(upload_file, "filename") and upload_file.filename:
        safe_name = upload_file.filename.replace("..", "").replace("/", "_").replace("\\", "_")
        _safe_name = safe_name

        if not called_at_iso:
            m = _re.match(r"^(\d{8}_\d{6})", safe_name)
            if m:
                try:
                    ist_tz = _tz(_td(hours=5, minutes=30))
                    dt_local = _dt.strptime(m.group(1), "%Y%m%d_%H%M%S").replace(tzinfo=ist_tz)
                    called_at_iso = dt_local.astimezone(_tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                except Exception:
                    pass

        existing_call = Repository._execute(
            "SELECT * FROM call_logs WHERE lead_id = ? AND recording_file_name LIKE ? ORDER BY called_at DESC LIMIT 1",
            (lead_id, f"%_{safe_name}"),
            fetchone=True,
        )
        if existing_call:
            if called_at_iso and existing_call.get("called_at") != called_at_iso:
                Repository._execute(
                    "UPDATE call_logs SET called_at = ? WHERE id = ?",
                    (called_at_iso, existing_call["id"]),
                    commit=True,
                )
            return {
                "status": "success",
                "is_lead": True,
                "deduplicated": True,
                "call_id": existing_call["id"],
                "lead_id": lead_id,
                "lead_name": lead_name,
                "business_name": lead_biz,
                "drive_url": existing_call.get("recording_drive_url"),
                "drive_file_id": existing_call.get("recording_drive_file_id"),
            }

        file_bytes = await upload_file.read()
        if len(file_bytes) > 0:
            call_id_preview = "call_" + uuid.uuid4().hex[:8]
            _call_id_preview = call_id_preview
            recordings_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "recordings")
            os.makedirs(recordings_dir, exist_ok=True)

            save_path = os.path.join(recordings_dir, f"{call_id_preview}_{safe_name}")
            with open(save_path, "wb") as f:
                f.write(file_bytes)

            mime_type = upload_file.content_type or "audio/ogg"
            if safe_name.endswith(".m4a"):
                mime_type = "audio/mp4"
            elif safe_name.endswith(".ogg") or safe_name.endswith(".opus") or safe_name.endswith(".oga"):
                mime_type = "audio/ogg"

            recording_data["recording_file_name"] = f"{call_id_preview}_{safe_name}"
            recording_data["recording_mime_type"] = mime_type
            recording_data["recording_size_bytes"] = len(file_bytes)
            recording_data["recording_duration_secs"] = duration_seconds
            recording_data["is_video"] = 0
            recording_data["recording_drive_url"] = f"/api/recordings/{call_id_preview}_{safe_name}"

            _file_bytes_for_bg = file_bytes
            _mime_for_bg = mime_type

    d = {
        "lead_id": lead_id,
        "user_id": caller_user_id,
        "outcome": outcome,
        "notes": notes,
        "duration_minutes": duration_minutes,
        "called_at": called_at_iso,
        **recording_data,
    }
    result = Repository.log_call(d)

    if _file_bytes_for_bg:
        background_tasks.add_task(
            _background_drive_and_transcribe,
            result["id"],
            lead_id,
            _file_bytes_for_bg,
            _call_id_preview,
            _safe_name,
            _mime_for_bg,
            lead_name,
            lead_biz,
            phone,
            duration_seconds,
        )

    return {
        "status": "success",
        "is_lead": True,
        "call_id": result["id"],
        "lead_id": lead_id,
        "lead_name": lead_name,
        "business_name": lead_biz,
        "drive_url": recording_data.get("recording_drive_url"),
        "drive_file_id": recording_data.get("recording_drive_file_id"),
    }


@router.get("/api/leads/{id}/drive/open")
def open_lead_drive_folder(id: str, user: dict = Depends(require_auth)):
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    drive_url = lead.get("drive_folder_url")
    if not drive_url:
        folder_id = lead.get("drive_folder_id")
        if folder_id:
            drive_url = f"https://drive.google.com/drive/folders/{folder_id}"

    if not drive_url:
        drive_url = f"https://drive.google.com/drive/folders/{ROOT_FOLDER_ID}"

    return RedirectResponse(url=drive_url)
