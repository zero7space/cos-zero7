"""
COS Theta — WhatsApp Integration Router
Handles multi-account WhatsApp sync, central inbox, media uploads, and daemon controls.
"""

import logging
import os
from typing import Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
import httpx
from backend.database import Repository
from backend.auth import require_auth, require_admin

logger = logging.getLogger(__name__)
router = APIRouter(tags=["whatsapp"])

DAEMON_BASE_URL = os.getenv("WA_DAEMON_URL", "http://172.17.0.1:8085")


@router.post("/api/whatsapp/accounts")
def register_whatsapp_account(request_data: dict, user: dict = Depends(require_auth)):
    phone = request_data.get("phone_number", "").strip()
    label = request_data.get("label", "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="phone_number is required")
    account = Repository.register_whatsapp_account(phone, label)
    return account


@router.get("/api/whatsapp/accounts")
def list_whatsapp_accounts(user: dict = Depends(require_auth)):
    return Repository.get_whatsapp_accounts()


@router.post("/api/whatsapp/messages/sync")
async def sync_whatsapp_messages(request: Request):
    """Batch sync messages from the desktop agent. Accepts API key or auth token."""
    body = await request.json()
    account_phone = body.get("account_phone", "")
    messages = body.get("messages", [])
    if not account_phone or not messages:
        raise HTTPException(status_code=400, detail="account_phone and messages required")
    inserted = Repository.sync_whatsapp_messages(account_phone, messages)
    return {"status": "ok", "inserted": inserted, "total_sent": len(messages)}


@router.post("/api/whatsapp/media/upload")
async def upload_whatsapp_lead_media(
    file: UploadFile = File(...),
    lead_phone: str = Form(...),
    wa_message_id: str = Form(""),
    media_type: str = Form("image"),
    caption: Optional[str] = Form(None),
    account_phone: Optional[str] = Form(None),
):
    """
    Uploads media for a verified CRM Lead to Google Drive and updates the CRM message link.
    """
    norm_phone = Repository.normalize_phone(lead_phone)
    lead = Repository.get_lead_by_phone(norm_phone)
    if not lead:
        logger.warning(f"[WA MEDIA] Phone {lead_phone} (norm: {norm_phone}) is not a registered CRM lead. Skipping upload.")
        return {"status": "skipped", "message": "Sender/recipient is not a registered CRM lead"}

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file payload")

    from backend.integrations import google_drive
    client_slug = lead.get("slug") or lead.get("name", "client").lower().replace(" ", "-")[:40]
    client_name = lead.get("name") or "Valued Client"
    business_name = lead.get("business_name") or ""

    cat_map = {
        "image": "whatsapp_images",
        "photo": "whatsapp_images",
        "document": "whatsapp_documents",
        "audio": "whatsapp_voice_notes",
        "voice_note": "whatsapp_voice_notes",
        "video": "whatsapp",
    }
    category = cat_map.get(media_type.lower(), "whatsapp_images")
    import time
    filename = file.filename or f"wa_{norm_phone}_{int(time.time())}.bin"
    mime_type = file.content_type or "application/octet-stream"

    logger.info(f"[WA MEDIA] Uploading {filename} ({len(file_bytes)} bytes) for lead '{client_name}' ({norm_phone}) to {category}...")
    drive_res = google_drive.upload_client_asset(
        client_slug=client_slug,
        client_name=client_name,
        category=category,
        file_bytes=file_bytes,
        filename=filename,
        mime_type=mime_type,
        business_name=business_name,
    )

    drive_url = ""
    embed_url = ""
    if drive_res:
        drive_url = drive_res.get("web_view_link", "")
        embed_url = drive_res.get("embed_link", "")

    preview_url = embed_url or drive_url
    if wa_message_id and preview_url:
        Repository._execute(
            "UPDATE whatsapp_messages SET media_url = ? WHERE wa_message_id = ?",
            (preview_url, wa_message_id),
            commit=True,
        )
        logger.info(f"[WA MEDIA] Updated whatsapp_messages for wa_message_id={wa_message_id} with media_url={preview_url}")

    return {
        "status": "success",
        "lead_id": lead.get("id"),
        "lead_name": client_name,
        "category": category,
        "drive_url": drive_url,
        "embed_url": embed_url,
        "media_url": preview_url,
    }


@router.get("/api/leads/{id}/whatsapp")
async def get_lead_whatsapp(id: str, account_phone: Optional[str] = None, user: dict = Depends(require_auth)):
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead_phone_10 = Repository.normalize_phone(lead.get("phone", ""))

    daemon_status = {}
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            resp = await client.get(f"{DAEMON_BASE_URL}/status")
            if resp.status_code == 200:
                d_data = resp.json()
                for acc_key, acc_val in d_data.get("accounts", {}).items():
                    p10 = Repository.normalize_phone(acc_val.get("phone", ""))
                    if p10:
                        daemon_status[p10] = acc_val.get("status", "disconnected")
    except Exception:
        pass

    lead_clauses = ["wm.lead_id = ?"]
    lead_params = [id]
    if lead_phone_10:
        lead_clauses.append("wm.lead_phone = ?")
        lead_params.append(lead_phone_10)
        lead_clauses.append("wm.lead_phone = ?")
        lead_params.append("91" + lead_phone_10)
        lead_clauses.append("wm.lead_phone = ?")
        lead_params.append("+91" + lead_phone_10)
    lead_sql = " OR ".join(lead_clauses)

    counts_query = Repository._execute(f"""
        SELECT wm.account_phone, COUNT(*) as cnt
        FROM whatsapp_messages wm
        WHERE ({lead_sql})
        GROUP BY wm.account_phone
    """, tuple(lead_params), fetchall=True)

    lead_counts = {}
    for cq in counts_query:
        p10 = Repository.normalize_phone(cq["account_phone"])
        if p10:
            lead_counts[p10] = lead_counts.get(p10, 0) + cq["cnt"]

    core_accounts = [
        {"id": "personal", "phone_number": "9993202900", "label": "Abhijeet Personal"},
        {"id": "central", "phone_number": "9479007951", "label": "Zero7 Central"},
    ]

    all_accounts = Repository.get_whatsapp_accounts()
    clean_all = []
    seen = set()

    for c in core_accounts:
        p10 = c["phone_number"]
        seen.add(p10)
        c_copy = dict(c)
        st = daemon_status.get(p10, "disconnected")
        c_copy["status"] = st
        c_copy["is_connected"] = (st == "connected")
        c_copy["message_count"] = lead_counts.get(p10, 0)
        clean_all.append(c_copy)

    for a in all_accounts:
        p10 = Repository.normalize_phone(a["phone_number"])
        if p10 and p10 not in seen:
            seen.add(p10)
            a_copy = dict(a)
            a_copy["phone_number"] = p10
            st = daemon_status.get(p10, "disconnected")
            a_copy["status"] = st
            a_copy["is_connected"] = (st == "connected")
            a_copy["message_count"] = lead_counts.get(p10, 0)
            clean_all.append(a_copy)

    target_account = account_phone if account_phone and account_phone != "all" else None
    messages = Repository.get_whatsapp_conversation(id, target_account)

    return {
        "accounts": clean_all,
        "selected_account": account_phone or "all",
        "messages": [dict(m) for m in messages],
        "lead_phone": lead.get("phone", ""),
    }


@router.get("/api/admin/whatsapp/status")
async def get_admin_whatsapp_status(user: dict = Depends(require_admin)):
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(f"{DAEMON_BASE_URL}/status")
            if resp.status_code == 200:
                data = resp.json()
                data["daemon_online"] = True
                return data
    except Exception:
        pass

    msg_counts = Repository._execute("SELECT account_phone, COUNT(*) as cnt FROM whatsapp_messages GROUP BY account_phone", fetchall=True)
    counts_map = {row["account_phone"]: row["cnt"] for row in msg_counts}

    return {
        "daemon_online": False,
        "accounts": {
            "personal": {
                "id": "personal",
                "label": "Abhijeet Personal",
                "phone": "9993202900",
                "status": "disconnected",
                "hasQr": False,
                "messagesSynced": counts_map.get("9993202900", 0),
            },
            "central": {
                "id": "central",
                "label": "Zero7 Central",
                "phone": "9479007951",
                "status": "disconnected",
                "hasQr": False,
                "messagesSynced": counts_map.get("9479007951", 0),
            },
        },
    }


@router.get("/api/admin/whatsapp/qr/{account_id}")
async def get_admin_whatsapp_qr(account_id: str, user: dict = Depends(require_admin)):
    if account_id not in ["personal", "central"]:
        raise HTTPException(status_code=400, detail="Invalid account id. Use 'personal' or 'central'.")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(f"{DAEMON_BASE_URL}/qr/{account_id}")
            if resp.status_code == 200:
                data = resp.json()
                if not data.get("hasQr") and data.get("status") in ["disconnected", "logged_out", "error"]:
                    try:
                        await client.post(f"{DAEMON_BASE_URL}/reconnect/{account_id}")
                        import asyncio
                        await asyncio.sleep(1.5)
                        retry_resp = await client.get(f"{DAEMON_BASE_URL}/qr/{account_id}")
                        if retry_resp.status_code == 200:
                            return retry_resp.json()
                    except Exception:
                        pass
                return data
            else:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"WhatsApp daemon unreachable: {str(e)}")


@router.post("/api/admin/whatsapp/reconnect/{account_id}")
async def reconnect_admin_whatsapp(account_id: str, user: dict = Depends(require_admin)):
    if account_id not in ["personal", "central"]:
        raise HTTPException(status_code=400, detail="Invalid account id")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(f"{DAEMON_BASE_URL}/reconnect/{account_id}")
            return resp.json()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to reconnect: {str(e)}")


@router.post("/api/admin/whatsapp/disconnect/{account_id}")
async def disconnect_admin_whatsapp(account_id: str, user: dict = Depends(require_admin)):
    if account_id not in ["personal", "central"]:
        raise HTTPException(status_code=400, detail="Invalid account id")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(f"{DAEMON_BASE_URL}/disconnect/{account_id}")
            return resp.json()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to disconnect: {str(e)}")


@router.post("/api/admin/whatsapp/sync-chat/{account_id}")
async def sync_admin_whatsapp_chat(account_id: str, request: Request, user: dict = Depends(require_admin)):
    if account_id not in ["personal", "central"]:
        raise HTTPException(status_code=400, detail="Invalid account id")
    try:
        body = await request.json()
    except Exception:
        body = {}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(f"{DAEMON_BASE_URL}/sync-chat/{account_id}", json=body)
            return resp.json()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to request chat sync: {str(e)}")


@router.get("/api/whatsapp/central/conversations")
async def get_central_whatsapp_conversations(user: dict = Depends(require_auth)):
    daemon_status = {"online": False, "status": "disconnected", "phone": "9479007951", "userName": "Zero7 Central"}
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{DAEMON_BASE_URL}/status")
            if resp.status_code == 200:
                d_data = resp.json()
                cent = d_data.get("accounts", {}).get("central", {})
                daemon_status["online"] = True
                daemon_status["status"] = cent.get("status", "disconnected")
                daemon_status["userName"] = cent.get("userName", "Zero7 Central")
                daemon_status["phone"] = cent.get("phone", "9479007951")
                daemon_status["connectedAt"] = cent.get("connectedAt")
    except Exception:
        pass

    conversations = Repository.get_central_whatsapp_conversations()
    return {
        "status": "success",
        "account": daemon_status,
        "conversations": conversations,
    }


@router.get("/api/whatsapp/central/conversations/{phone}")
async def get_central_whatsapp_conversation(phone: str, user: dict = Depends(require_auth)):
    data = Repository.get_central_conversation_messages(phone)
    return {
        "status": "success",
        **data,
    }


@router.post("/api/whatsapp/central/send")
async def send_central_whatsapp_message(request: Request, user: dict = Depends(require_auth)):
    body = await request.json()
    recipient_phone = body.get("recipient_phone") or body.get("phone")
    message_text = body.get("message_text") or body.get("message")
    lead_id = body.get("lead_id")

    if not recipient_phone or not message_text or not str(message_text).strip():
        raise HTTPException(status_code=400, detail="recipient_phone and message_text are required")

    daemon_resp = None
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{DAEMON_BASE_URL}/send-message/central",
                json={
                    "recipient_phone": recipient_phone,
                    "message_text": message_text,
                },
            )
            if resp.status_code == 200:
                daemon_resp = resp.json()
            else:
                err_detail = "Failed to dispatch message via WhatsApp socket."
                try:
                    err_detail = resp.json().get("error", err_detail)
                except Exception:
                    pass
                raise HTTPException(status_code=resp.status_code, detail=err_detail)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"WhatsApp daemon unreachable: {str(e)}")

    wa_mid = daemon_resp.get("wa_message_id") if daemon_resp else None
    saved_msg = Repository.save_outgoing_whatsapp_message(
        account_phone="9479007951",
        lead_phone=recipient_phone,
        message_text=message_text,
        wa_message_id=wa_mid,
        lead_id=lead_id,
    )
    return {
        "status": "success",
        "message": dict(saved_msg) if saved_msg else None,
        "wa_message_id": wa_mid,
    }


@router.post("/api/whatsapp/central/link")
async def link_central_whatsapp_to_lead(request: Request, user: dict = Depends(require_auth)):
    body = await request.json()
    phone = body.get("phone")
    lead_id = body.get("lead_id")
    if not phone or not lead_id:
        raise HTTPException(status_code=400, detail="phone and lead_id are required")
    lead = Repository.get_lead(lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    Repository.link_phone_to_lead(phone, lead_id)
    return {"status": "success", "lead": dict(lead)}


@router.post("/api/whatsapp/central/create-lead")
async def create_lead_from_central_whatsapp(request: Request, user: dict = Depends(require_auth)):
    body = await request.json()
    phone = body.get("phone")
    name = body.get("name")
    business_name = body.get("business_name")
    if not phone or not name:
        raise HTTPException(status_code=400, detail="phone and name are required")
    new_lead = Repository.create_lead_from_whatsapp(phone, name, business_name)
    return {"status": "success", "lead": dict(new_lead)}


# ── Zero7 Team Group Messages Feed ──

@router.post("/api/whatsapp/zero7/group-messages")
async def ingest_zero7_group_message(request: Request):
    """
    Ingests messages from the Zero7 team WhatsApp group.
    Matches mentions to CRM leads and feeds the Sentinel Agent's autonomous memory.
    """
    body = await request.json()
    mid = body.get("wa_message_id")
    if not mid:
        raise HTTPException(status_code=400, detail="wa_message_id is required")

    sender_phone = body.get("sender_phone") or "unknown"
    sender_name = body.get("sender_name") or sender_phone
    text = (body.get("message_text") or "").strip()
    is_audio = int(body.get("is_audio") or 0)
    media_url = body.get("media_url") or ""
    timestamp = body.get("timestamp") or Repository.now()
    linked_lead_id = body.get("linked_lead_id")
    matched_lead_name = body.get("matched_lead_name")

    # Smart matching across CRM leads if not already linked
    if not linked_lead_id and text:
        leads = Repository._execute("SELECT id, name, business_name, phone_normalized FROM leads", fetchall=True) or []
        lower_txt = text.lower()
        for l in leads:
            l_name = (l.get("name") or "").strip()
            l_biz = (l.get("business_name") or "").strip()
            l_phone = l.get("phone_normalized")
            if l_phone and l_phone in lower_txt:
                linked_lead_id = l["id"]
                matched_lead_name = l_name
                break
            if l_name and len(l_name) >= 3 and l_name.lower() in lower_txt:
                linked_lead_id = l["id"]
                matched_lead_name = l_name
                break
            if l_biz and len(l_biz) >= 4 and l_biz.lower() in lower_txt:
                linked_lead_id = l["id"]
                matched_lead_name = l_name
                break

    saved = Repository.save_zero7_group_message(
        wa_message_id=mid,
        sender_phone=sender_phone,
        sender_name=sender_name,
        message_text=text,
        is_audio=is_audio,
        media_url=media_url,
        linked_lead_id=linked_lead_id,
        matched_lead_name=matched_lead_name,
        timestamp=timestamp
    )

    # If linked to a lead, update sentinel autonomous memory and auto-resolve pending alerts
    if linked_lead_id:
        try:
            import re
            from backend.ai.sentinel_agent import sentinel_agent
            sentinel_agent.record_group_mention(linked_lead_id, text, sender_name, timestamp)

            # Auto-resolve pending sentinel nag if team replied with action intent or discussion
            action_intent_pattern = r"(?:call|calling|dial|done|baat|switch\s*off|busy|kal|sham|drop|not\s*interested|not\s*picking|bhej|sent|shared|scheduled|meeting|demo)"
            if re.search(action_intent_pattern, text, re.IGNORECASE):
                resolved_count = Repository.resolve_sentinel_alerts_for_lead(linked_lead_id, resolved_by=sender_name, notes=text)
                if resolved_count > 0:
                    logger.info(
                        f"[SENTINEL] Auto-resolved {resolved_count} alert(s) for lead {linked_lead_id} based on group reply by {sender_name}: '{text[:40]}'"
                    )
                    try:
                        Repository.log_activity({
                            "lead_id": linked_lead_id,
                            "activity_type": "sentinel_auto_resolved",
                            "description": f"Sentinel accountability nag auto-resolved via Zero7 group reply from {sender_name}",
                            "metadata": {
                                "sender": sender_name,
                                "reply_snippet": text[:100],
                                "resolved_count": resolved_count
                            }
                        })
                    except Exception:
                        pass
        except Exception as ex:
            logger.warning(f"[SENTINEL] Group message link processing error: {ex}")

    return {"status": "success", "message": saved}


@router.get("/api/whatsapp/zero7/group-messages")
def get_zero7_group_messages(limit: int = 100, lead_id: Optional[str] = None, user: dict = Depends(require_auth)):
    """Retrieves recent Zero7 team group messages."""
    return Repository.list_zero7_group_messages(limit=limit, linked_lead_id=lead_id)


@router.post("/api/whatsapp/agent/sentinel/broadcast")
@router.post("/api/whatsapp/zero7/broadcast")
@router.post("/api/whatsapp/zdro7/broadcast")
async def broadcast_sentinel_to_zero7(request: Request, user: dict = Depends(require_auth)):
    """
    Dedicated restricted WhatsApp endpoint for the Sentinel Agent.
    SECURITY GUARANTEE:
    Messages sent to this endpoint can ONLY be delivered to the Zero7 team WhatsApp group (120363426285521103@g.us).
    Any attempt to provide external phone numbers or bypass the group is rejected by contract.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    message_text = (body.get("message_text") or body.get("message") or "").strip()
    lead_id = body.get("lead_id")
    aberration_type = body.get("aberration_type") or "unspecified_aberration"
    severity = body.get("severity") or "medium"

    if not message_text:
        raise HTTPException(status_code=400, detail="message_text is required")

    # Reject any attempt to specify an arbitrary recipient phone or outside chat
    if "recipient_phone" in body or "phone" in body or "to" in body:
        explicit_target = body.get("recipient_phone") or body.get("phone") or body.get("to")
        if explicit_target and str(explicit_target).lower() not in ("zdro7", "zero7", "120363426285521103@g.us"):
            raise HTTPException(
                status_code=403, 
                detail="Security Violation: Sentinel Agent is strictly restricted to the Zero7 WhatsApp group only. Arbitrary recipient routing is prohibited."
            )

    daemon_resp = None
    dispatch_status = "sent"
    error_msg = None

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{DAEMON_BASE_URL}/send-group-message/zero7",
                json={"message_text": message_text, "account": "central"}
            )
            if resp.status_code == 200:
                daemon_resp = resp.json()
            else:
                dispatch_status = "daemon_error"
                error_msg = f"Daemon responded with status {resp.status_code}: {resp.text}"
                logger.warning(f"[SENTINEL BROADCAST] {error_msg}")
    except httpx.HTTPError as e:
        dispatch_status = "daemon_offline"
        error_msg = f"WhatsApp daemon unreachable at {DAEMON_BASE_URL}: {str(e)}"
        logger.warning(f"[SENTINEL BROADCAST] {error_msg}")

    wa_mid = daemon_resp.get("wa_message_id") if daemon_resp else None

    # Log in sentinel_alerts_log table
    alert_record = Repository.log_sentinel_alert(
        lead_id=lead_id,
        aberration_type=aberration_type,
        severity=severity,
        nag_message=message_text,
        wa_message_id=wa_mid,
        status=dispatch_status,
        group_target="Zero7"
    )

    # Log into universal activity feed
    try:
        Repository.log_activity({
            "lead_id": lead_id,
            "activity_type": "sentinel_nag",
            "description": f"Sentinel Agent dispatched nag to Zero7 group ({aberration_type})",
            "metadata": {
                "group": "Zero7",
                "aberration_type": aberration_type,
                "severity": severity,
                "status": dispatch_status,
                "preview": message_text[:120]
            }
        })
    except Exception:
        pass

    return {
        "status": "success",
        "dispatch_status": dispatch_status,
        "group_target": "Zero7",
        "alert": alert_record,
        "wa_message_id": wa_mid,
        "error": error_msg
    }

# Backward compatibility alias
broadcast_sentinel_to_zdro7 = broadcast_sentinel_to_zero7

