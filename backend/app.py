from contextlib import asynccontextmanager
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    import os as _os
    _env_path = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), ".env")
    if _os.path.exists(_env_path):
        with open(_env_path, "r", encoding="utf-8") as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith("#") and "=" in _line:
                    _k, _v = _line.split("=", 1)
                    _os.environ.setdefault(_k.strip(), _v.strip())

from fastapi import FastAPI, HTTPException, Request, Depends, UploadFile, File, Form, BackgroundTasks, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse, RedirectResponse, HTMLResponse, Response, JSONResponse
from typing import Optional
import os
import io
import uuid
import re
import json
import logging
import asyncio
from collections import defaultdict
import httpx

from backend.ai.research_agent import generate_company_brief, generate_founder_handoff
from backend.ai.prototype_agent import generate_or_iterate_prototype
from backend.agents.pill_resolver import DataPillResolver
from backend.integrations.github_vault import provision_client_vault, get_client_project_path, push_file_to_github, update_media_manifest_in_vault, sync_lead_brief_to_vault, GITHUB_TOKEN

from backend.integrations.google_drive import (
    upload_recording as drive_upload,
    is_available as drive_is_available,
    get_file_stream as drive_get_stream,
    attach_drive_meeting_by_id_or_url,
    ensure_client_drive_hierarchy,
    ROOT_FOLDER_ID
)
from backend.integrations.deepgram import transcribe_audio, is_available as deepgram_is_available
from backend.integrations.google_tasks import (
    get_auth_url as gtasks_get_auth_url,
    exchange_code_for_tokens as gtasks_exchange_code,
    GoogleTasksClient,
    TASK_LIST_TITLE as GTASKS_LIST_TITLE
)

from backend.database import Repository, init_db
from backend.models import (
    UserLogin, UserCreate, UserUpdate, LeadCreate, LeadUpdate, DealCreate, DealUpdate, CallLogCreate, NoteCreate,
    AgentJobCreate, AgentJobStreamUpdate, AgentJobComplete, WorkerHeartbeat, DevicePairRequest,
    ConversationTranscriptUpload, ProjectCreateRequest, PrototypeRepContextUpdate,
    DealMilestoneCreate, DealMilestoneUpdate, DealPaymentCreate,
    DealDeliverableCreate, DealDeliverableUpdate, DealEnvironmentCreate,
    ActivityCreate, SubdomainRouteCreate, LeadAttributionCreate
)
from backend.auth import hash_password, verify_password, create_token, get_current_user
from backend.seed_data import seed_if_empty


ZERO7_PAGE_ACCESS_TOKEN = "EAAU4RibpjswBSmENdOAwWJo3wavZCxQf71pbOff3xbcOCZBdAa1g3qErFaETSONy3MwdkWfr8wBdRmdYnxMtMPjruuE5XlKZAONkaFyuwtOZC6VNk0HKo7cAKUYQpQ3qTW4hbDIlaAneLOviYbU32wK8Gzf0CX3QILibGK5ZAlA0AUgZCZCHPbIdF1689ymkFrwua98"
ZERO7_PAGE_ID = "1256505504219421"
TARGET_META_FORM_ID = "3136433653220686"
TARGET_META_FORM_NAME = "Lead form - Higher intent"
TARGET_CAMPAIGN_NAME = "Lead Campaign - September (Quality)"

def get_meta_page_token():
    t = os.getenv("META_PAGE_ACCESS_TOKEN")
    if t and len(t) > 50 and "EAA" in t and not t.startswith("EAAU4RibpjswBSdbclZCCwyZ"):
        return t
    return ZERO7_PAGE_ACCESS_TOKEN

async def sync_meta_graph_leads_direct():
    token = get_meta_page_token()
    page_id = ZERO7_PAGE_ID
    if not token:
        return {"created": 0}

    created_count = 0
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            forms_res = await client.get(f"https://graph.facebook.com/v20.0/{page_id}/leadgen_forms?access_token={token}")
            if forms_res.status_code != 200:
                return {"created": 0, "error": forms_res.text}
            forms = forms_res.json().get("data", [])

            existing_leads = Repository._execute("SELECT id, name, phone, channel_data FROM leads", fetchall=True)
            known_leadgen_ids = set()
            known_phones = set()
            known_names = set()
            for el in existing_leads:
                p = Repository.normalize_phone(el.get("phone"))
                if p:
                    known_phones.add(p)
                if el.get("name"):
                    known_names.add(el.get("name").strip().lower())
                cd = el.get("channel_data")
                if cd:
                    if isinstance(cd, str):
                        try:
                            cd = json.loads(cd)
                        except Exception:
                            cd = {}
                    if isinstance(cd, dict) and cd.get("leadgen_id"):
                        known_leadgen_ids.add(str(cd.get("leadgen_id")))

            for form in forms:
                form_id = str(form.get("id"))
                form_name = form.get("name") or ""
                # Strict filter: ONLY sync leads from the defined September Quality campaign / Higher intent form
                if form_id != TARGET_META_FORM_ID and "higher intent" not in form_name.lower():
                    continue

                meta_fields = "created_time,id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic,platform,field_data"
                leads_res = await client.get(f"https://graph.facebook.com/v20.0/{form_id}/leads?fields={meta_fields}&access_token={token}&limit=100")
                if leads_res.status_code != 200:
                    continue
                leads_data = leads_res.json().get("data", [])
                for item in leads_data:
                    leadgen_id = str(item.get("id"))
                    if leadgen_id in known_leadgen_ids:
                        continue

                    field_data = item.get("field_data", [])
                    field_map = {f.get("name"): (f.get("values", [""])[0] if f.get("values") else "") for f in field_data}
                    raw_phone = field_map.get("phone_number") or field_map.get("phone") or ""
                    norm_phone = Repository.normalize_phone(raw_phone)
                    if norm_phone and norm_phone in known_phones:
                        continue

                    lead_name = field_map.get("full_name") or field_map.get("name") or f"Meta Lead {leadgen_id}"
                    if lead_name.strip().lower() in known_names:
                        continue

                    lead_email = field_map.get("email") or ""
                    lead_city = field_map.get("city") or ""
                    lead_biz = field_map.get("company_name") or field_map.get("business_name") or ""

                    standard_keys = {"full_name", "name", "phone_number", "phone", "email", "city", "company_name", "business_name"}
                    custom_qas = [{"question": k, "answer": str(v)} for k, v in field_map.items() if k not in standard_keys and v]

                    item_campaign_name = item.get("campaign_name") or TARGET_CAMPAIGN_NAME
                    item_campaign_id = item.get("campaign_id") or ""
                    item_platform = item.get("platform") or "instagram"
                    item_ad_name = item.get("ad_name")
                    item_ad_id = item.get("ad_id")
                    item_adset_name = item.get("adset_name")
                    item_adset_id = item.get("adset_id")

                    channel_data = {
                        "leadgen_id": leadgen_id,
                        "form_id": form_id,
                        "form_name": form_name or TARGET_META_FORM_NAME,
                        "campaign_name": item_campaign_name,
                        "campaign_id": item_campaign_id,
                        "platform": item_platform,
                        "form_answers": custom_qas
                    }

                    ad_name = item_ad_name or f"Ad on {form_name or TARGET_META_FORM_NAME}"
                    if item_ad_id:
                        channel_data["ad_id"] = item_ad_id
                    if item_ad_name:
                        channel_data["ad_name"] = item_ad_name
                    if item_adset_id:
                        channel_data["adset_id"] = item_adset_id
                    if item_adset_name:
                        channel_data["adset_name"] = item_adset_name

                    lead_obj = {
                        "name": lead_name,
                        "business_name": lead_biz,
                        "phone": norm_phone or raw_phone,
                        "email": lead_email,
                        "city": lead_city,
                        "temperature": "warm",
                        "call_stage": "uncontacted",
                        "source": "meta_ads",
                        "meta_form_id": form_id,
                        "meta_ad_name": ad_name,
                        "status": "new",
                        "priority": "unexplored",
                        "next_action": "Speed to lead call (< 5 mins)",
                        "channel_data": channel_data,
                        "created_at": item.get("created_time")
                    }
                    new_lead = Repository.create_lead(lead_obj)
                    known_leadgen_ids.add(leadgen_id)
                    if norm_phone:
                        known_phones.add(norm_phone)
                    known_names.add(lead_name.strip().lower())
                    created_count += 1
                    try:
                        Repository.generate_lead_task(new_lead["id"])
                    except Exception:
                        pass

    except Exception as ex:
        logging.getLogger("uvicorn").error(f"[AUTO-SYNC] Error polling Meta Graph API: {ex}")

    return {"status": "success", "created": created_count}

async def run_background_meta_and_sheet_sync():
    """
    Continuous background loop that runs every 2 minutes:
    1. Ingests new leads & priority updates from Google Sheet 'Lead form - Higher intent'.
    2. Ingests any new Meta leads directly via Meta Graph API across all forms.
    Guarantees that new leads are synced automatically without manual intervention.
    """
    await asyncio.sleep(5)
    while True:
        try:
            # 1. Sync from Google Sheet
            try:
                loop = asyncio.get_running_loop()
                sheet_res = await loop.run_in_executor(None, Repository.sync_sheet_priorities)
                if sheet_res and sheet_res.get("created", 0) > 0:
                    logging.getLogger("uvicorn").info(f"[AUTO-SYNC] Ingested {sheet_res['created']} new leads from Google Sheet!")
            except Exception as e:
                logging.getLogger("uvicorn").warning(f"[AUTO-SYNC] Sheet sync check failed: {e}")

            # 2. Sync from Meta Graph API
            try:
                meta_res = await sync_meta_graph_leads_direct()
                if meta_res and meta_res.get("created", 0) > 0:
                    logging.getLogger("uvicorn").info(f"[AUTO-SYNC] Ingested {meta_res['created']} new leads from Meta Graph API!")
            except Exception as e:
                logging.getLogger("uvicorn").warning(f"[AUTO-SYNC] Meta Graph API check failed: {e}")

        except Exception as ex:
            logging.getLogger("uvicorn").error(f"[AUTO-SYNC] Poller exception: {ex}")

        await asyncio.sleep(120)

async def run_background_zoho_mail_sync():
    await asyncio.sleep(5)
    while True:
        try:
            from backend.integrations.zoho_mail import zoho_mail_manager
            await zoho_mail_manager.sync_emails_to_cache(force_refresh=True)
        except Exception as e:
            logging.getLogger("uvicorn").warning(f"[ZOHO MAIL] Background sync error: {e}")
        await asyncio.sleep(120)


async def run_background_sentinel_loop():
    """
    Continuous 24/7 Pipeline Sentinel & Accountability Nagger:
    Constantly audits all CRM leads, detects stalls and aberrations (e.g. uncontacted leads,
    unanswered proposals, missed calls), and proactively nudges the team on the Zero7 WhatsApp group.
    """
    await asyncio.sleep(15)  # initial warmup delay
    from backend.ai.sentinel_agent import sentinel_agent, CYCLE_INTERVAL_SECONDS, DEFAULT_COOLDOWN_HOURS
    cycle_interval = int(os.getenv("SENTINEL_CYCLE_SECONDS", str(CYCLE_INTERVAL_SECONDS)))
    batch_size = int(os.getenv("SENTINEL_BATCH_SIZE", "1"))
    cooldown = float(os.getenv("SENTINEL_COOLDOWN_HOURS", str(DEFAULT_COOLDOWN_HOURS)))

    logging.getLogger("uvicorn").info("[SENTINEL] 24/7 Pipeline Sentinel loop initialized. Target: Zero7 WhatsApp group.")

    while True:
        try:
            loop = asyncio.get_running_loop()
            report = await loop.run_in_executor(
                None,
                sentinel_agent.run_sentinel_cycle,
                batch_size,
                cooldown
            )
            dispatched = report.get("nags_dispatched_count", 0)
            if dispatched > 0:
                logging.getLogger("uvicorn").info(
                    f"[SENTINEL] Dispatched {dispatched} proactive accountability nags to Zero7 group."
                )
        except Exception as e:
            logging.getLogger("uvicorn").warning(f"[SENTINEL] Error during audit cycle: {e}")

        await asyncio.sleep(cycle_interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup tasks
    try:
        init_db()
        seed_if_empty()
    except Exception as e:
        logging.getLogger("uvicorn").error(f"Error during DB initialization: {e}")

    bg_tasks = []
    disable_external_sync = os.environ.get("ZERO7_DISABLE_EXTERNAL_SYNC", "").strip().lower() in ("1", "true", "yes")
    if not disable_external_sync:
        bg_tasks.extend([
            asyncio.create_task(run_background_meta_and_sheet_sync()),
            asyncio.create_task(run_background_zoho_mail_sync()),
            asyncio.create_task(run_background_sentinel_loop()),
        ])
    yield
    # Shutdown tasks
    for t in bg_tasks:
        t.cancel()
    try:
        from backend.db.connection import close_all_pools
        close_all_pools()
    except Exception as e:
        logging.getLogger("uvicorn").warning(f"Error closing DB pools on shutdown: {e}")


app = FastAPI(title="Zero7 CRM Backend", lifespan=lifespan)

from backend.mcp_server import router as mcp_router
from backend.routers import deals, health, auth, facts, whatsapp, leads, calls, subdomains

app.include_router(mcp_router)
app.include_router(deals.router)
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(facts.router)
app.include_router(whatsapp.router)
app.include_router(leads.router)
app.include_router(calls.router)
app.include_router(subdomains.router)


class HostSecurityMiddleware:
    """Pure ASGI host security guard so streaming and BackgroundTasks never block HTTP responses."""

    def __init__(self, asgi_app):
        self.asgi_app = asgi_app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = dict(scope.get("headers") or [])
            host = headers.get(b"host", b"").decode("latin-1").split(":")[0].lower().strip()
            root_domain = os.environ.get("ZERO7_ROOT_DOMAIN", "zero7.space").lower().strip()

            if host.endswith(f".{root_domain}") and host not in (
                f"cos.{root_domain}",
                f"mail.{root_domain}",
                f"www.{root_domain}",
                root_domain,
                "localhost",
                "127.0.0.1",
                "68.183.92.215",
            ):
                path = scope.get("path", "")
                is_public = (
                    path == "/"
                    or path.startswith("/static/")
                    or path.startswith("/api/public/")
                    or path.startswith("/api/prototypes/public/")
                    or path == "/favicon.ico"
                )
                if not is_public:
                    resp = JSONResponse(
                        status_code=403,
                        content={"error": "Access forbidden: Internal CRM APIs cannot be accessed from client prototype portals."},
                    )
                    await resp(scope, receive, send)
                    return
        await self.asgi_app(scope, receive, send)


app.add_middleware(HostSecurityMiddleware)


def require_auth(user: dict = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user


def require_admin(user: dict = Depends(require_auth)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


logger = logging.getLogger(__name__)


@app.get("/api/webhooks/meta-leads")
def verify_meta_webhook(request: Request):
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")
    expected_token = os.getenv("META_VERIFY_TOKEN", "zero7_meta_verify_2026")
    if mode == "subscribe" and token == expected_token:
        return PlainTextResponse(content=str(challenge))
    return PlainTextResponse(content="OK")

@app.post("/api/webhooks/meta-leads")
async def receive_meta_webhook(request: Request):
    payload = await request.json()
    try:
        if "name" in payload:
            channel_data = payload.get("channel_data") or {}
            for key in ["campaign_name", "adset_name", "ad_name", "ad_id", "platform", "form_name", "form_id"]:
                if key in payload and key not in channel_data:
                    channel_data[key] = payload[key]
            
            if "creative" in payload:
                channel_data["creative"] = payload["creative"]
            elif "creative_thumbnail_url" in payload or "thumbnail_url" in payload:
                channel_data["creative"] = {
                    "thumbnail_url": payload.get("creative_thumbnail_url") or payload.get("thumbnail_url"),
                    "image_url": payload.get("image_url"),
                    "title": payload.get("ad_title") or payload.get("ad_name"),
                    "body": payload.get("ad_body") or payload.get("ad_copy")
                }
            
            form_answers = payload.get("form_answers") or payload.get("custom_fields")
            if form_answers:
                if isinstance(form_answers, dict):
                    channel_data["form_answers"] = [{"question": k, "answer": str(v)} for k, v in form_answers.items()]
                elif isinstance(form_answers, list):
                    channel_data["form_answers"] = form_answers

            lead = Repository.create_lead({
                "name": payload.get("name"),
                "business_name": payload.get("business_name", ""),
                "phone": payload.get("phone", ""),
                "email": payload.get("email", ""),
                "city": payload.get("city", ""),
                "temperature": payload.get("temperature", "warm"),
                "call_stage": payload.get("call_stage", "uncontacted"),
                "source": "meta_ads",
                "meta_form_id": payload.get("form_id") or channel_data.get("form_id") or payload.get("meta_form_id", ""),
                "meta_ad_name": payload.get("ad_name") or channel_data.get("ad_name") or payload.get("meta_ad_name", "Meta Lead Ads Campaign"),
                "status": "new",
                "priority": payload.get("priority", "unexplored"),
                "deal_value": float(payload.get("deal_value")) if payload.get("deal_value") else None,
                "next_action": payload.get("next_action", "Speed to lead call (< 5 mins)"),
                "channel_data": channel_data if channel_data else None
            })
            return {"status": "success", "lead_id": lead["id"]}

        entries = payload.get("entry", [])
        created_count = 0
        token = get_meta_page_token()
        for entry in entries:
            changes = entry.get("changes", [])
            for change in changes:
                val = change.get("value", {})
                leadgen_id = val.get("leadgen_id")
                form_id = val.get("form_id")
                ad_id = val.get("ad_id")
                page_id = val.get("page_id")
                
                # Strict filter: ONLY process leads from target form
                if form_id and str(form_id) != TARGET_META_FORM_ID:
                    logging.getLogger("uvicorn").info(f"[WEBHOOK] Skipping lead {leadgen_id} from non-target form {form_id}")
                    continue

                channel_data = {
                    "leadgen_id": leadgen_id,
                    "form_id": form_id or TARGET_META_FORM_ID,
                    "form_name": TARGET_META_FORM_NAME,
                    "campaign_name": TARGET_CAMPAIGN_NAME,
                    "ad_id": ad_id,
                    "page_id": page_id,
                    "platform": "instagram" if "instagram" in str(val).lower() else "facebook"
                }
                lead_name = f"Meta Lead {leadgen_id}"
                lead_phone = ""
                lead_email = ""
                lead_city = ""
                lead_business = ""
                ad_name = f"Ad {ad_id}" if ad_id else "Meta Instant Form"

                if token and leadgen_id:
                    try:
                        import httpx
                        async with httpx.AsyncClient(timeout=8.0) as client:
                            meta_lead_fields = "created_time,id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic,platform,field_data"
                            res = await client.get(f"https://graph.facebook.com/v20.0/{leadgen_id}?fields={meta_lead_fields}&access_token={token}")
                            if res.status_code == 200:
                                ldata = res.json()
                                field_map = {f.get("name"): (f.get("values", [""])[0] if f.get("values") else "") for f in ldata.get("field_data", [])}
                                lead_name = field_map.get("full_name") or field_map.get("name") or lead_name
                                lead_phone = field_map.get("phone_number") or field_map.get("phone") or ""
                                lead_email = field_map.get("email") or ""
                                lead_city = field_map.get("city") or ""
                                lead_business = field_map.get("company_name") or field_map.get("business_name") or ""
                                
                                standard_keys = {"full_name", "name", "phone_number", "phone", "email", "city", "company_name", "business_name"}
                                custom_qas = [{"question": k, "answer": str(v)} for k, v in field_map.items() if k not in standard_keys and v]
                                if custom_qas:
                                    channel_data["form_answers"] = custom_qas
                            if ldata.get("ad_name"):
                                ad_name = ldata.get("ad_name")
                                channel_data["ad_name"] = ad_name
                            if ldata.get("ad_id"):
                                ad_id = ldata.get("ad_id")
                                channel_data["ad_id"] = ad_id
                            if ldata.get("adset_name"):
                                channel_data["adset_name"] = ldata.get("adset_name")
                            if ldata.get("adset_id"):
                                channel_data["adset_id"] = ldata.get("adset_id")
                            if ldata.get("campaign_name"):
                                channel_data["campaign_name"] = ldata.get("campaign_name")
                            if ldata.get("campaign_id"):
                                channel_data["campaign_id"] = ldata.get("campaign_id")
                            if ldata.get("platform"):
                                channel_data["platform"] = ldata.get("platform")
                                
                                if ad_id:
                                    ad_res = await client.get(f"https://graph.facebook.com/v20.0/{ad_id}?fields=name,campaign{{name}},adset{{name}},creative{{name,title,body,image_url,thumbnail_url}}&access_token={token}")
                                    if ad_res.status_code == 200:
                                        ad_info = ad_res.json()
                                        ad_name = ad_info.get("name", ad_name)
                                        channel_data["ad_name"] = ad_name
                                        if "campaign" in ad_info:
                                            channel_data["campaign_name"] = ad_info["campaign"].get("name")
                                        if "adset" in ad_info:
                                            channel_data["adset_name"] = ad_info["adset"].get("name")
                                        if "creative" in ad_info:
                                            cr = ad_info["creative"]
                                            channel_data["creative"] = {
                                                "thumbnail_url": cr.get("thumbnail_url") or cr.get("image_url"),
                                                "image_url": cr.get("image_url"),
                                                "title": cr.get("title") or cr.get("name"),
                                                "body": cr.get("body")
                                            }
                    except Exception as ex:
                        print("Error fetching Meta Graph API details:", ex)

                if leadgen_id:
                    norm_p = Repository.normalize_phone(lead_phone)
                    existing = Repository._execute(
                        "SELECT id FROM leads WHERE (phone = ? AND phone != '') OR (channel_data LIKE ?) LIMIT 1",
                        (norm_p or lead_phone or "___none___", f"%{leadgen_id}%"),
                        fetchone=True
                    )
                    if not existing:
                        lead = Repository.create_lead({
                            "name": lead_name,
                            "business_name": lead_business,
                            "phone": norm_p or lead_phone,
                            "email": lead_email,
                            "city": lead_city,
                            "temperature": "warm",
                            "call_stage": "uncontacted",
                            "source": "meta_ads",
                            "meta_form_id": form_id or leadgen_id,
                            "meta_ad_name": ad_name,
                            "status": "new",
                            "priority": "unexplored",
                            "next_action": "Speed to lead call (< 5 mins)",
                            "channel_data": channel_data
                        })
                        created_count += 1
                        try:
                            Repository.generate_lead_task(lead["id"])
                        except Exception:
                            pass
        return {"status": "success", "created": created_count}
    except Exception as e:
        print("Error processing webhook:", e)
        return {"status": "error", "message": str(e)}

@app.post("/api/integrations/meta/sync-now")
async def manual_sync_meta_and_sheet(user: dict = Depends(require_auth)):
    loop = asyncio.get_running_loop()
    sheet_res = await loop.run_in_executor(None, Repository.sync_sheet_priorities)
    meta_res = await sync_meta_graph_leads_direct()
    return {
        "status": "success",
        "google_sheets": sheet_res,
        "meta_graph_api": meta_res,
        "message": f"Sync complete. Sheet: {sheet_res.get('created', 0)} new, {sheet_res.get('updated', 0)} updated. Meta Graph: {meta_res.get('created', 0)} new."
    }

# In-memory cache for ad creatives (key -> creative dict)
_ad_creative_cache = {}

async def fetch_and_sync_ad_creative_from_meta(ad_id: str, ad_name: str = None) -> Optional[dict]:
    """
    Attempt to fetch ad creative directly from Meta Graph API using the configured token.
    If Meta returns the video or image CDN URL, downloads the media and uploads it directly to Google Drive!
    """
    token = get_meta_page_token()
    if not token or not ad_id:
        return None
    
    try:
        from backend.integrations import google_drive
        async with httpx.AsyncClient(timeout=25.0) as client:
            ad_res = await client.get(
                f"https://graph.facebook.com/v20.0/{ad_id}",
                params={
                    "fields": "name,creative{id,name,title,body,image_url,thumbnail_url,video_id,effective_object_story_id}",
                    "access_token": token
                }
            )
            if ad_res.status_code != 200:
                return None
            
            ad_data = ad_res.json()
            cr = ad_data.get("creative", {})
            title = cr.get("title") or cr.get("name") or ad_data.get("name") or ad_name
            body = cr.get("body") or ""
            video_id = cr.get("video_id")
            
            media_bytes = None
            mime_type = "image/png"
            filename = f"Ad_{ad_id}.png"
            is_video = False

            # If it's a video ad, fetch direct video source URL
            if video_id:
                v_res = await client.get(
                    f"https://graph.facebook.com/v20.0/{video_id}",
                    params={"fields": "source,picture,title,description", "access_token": token}
                )
                if v_res.status_code == 200:
                    v_data = v_res.json()
                    source_url = v_data.get("source")
                    if source_url:
                        m_resp = await client.get(source_url, follow_redirects=True, timeout=60.0)
                        if m_resp.status_code == 200:
                            media_bytes = m_resp.content
                            mime_type = "video/mp4"
                            clean_title = (title or f"ad_{ad_id}").replace("/", "-").replace("\\", "-")[:40]
                            filename = f"{clean_title}_{ad_id}.mp4"
                            is_video = True
            
            # If image ad or video source failed, try image
            if not media_bytes and (cr.get("image_url") or cr.get("thumbnail_url")):
                img_url = cr.get("image_url") or cr.get("thumbnail_url")
                m_resp = await client.get(img_url, follow_redirects=True, timeout=30.0)
                if m_resp.status_code == 200:
                    media_bytes = m_resp.content
                    mime_type = "image/jpeg" if "jpeg" in m_resp.headers.get("content-type", "").lower() else "image/png"
                    clean_title = (title or f"ad_{ad_id}").replace("/", "-").replace("\\", "-")[:40]
                    ext = ".jpg" if "jpeg" in mime_type else ".png"
                    filename = f"{clean_title}_{ad_id}{ext}"
                    is_video = False
            
            if media_bytes:
                drive_result = google_drive.upload_ad_creative(
                    file_bytes=media_bytes,
                    filename=filename,
                    mime_type=mime_type,
                    ad_name=title or ad_name
                )
                if drive_result:
                    drive_result["body"] = body
                    return drive_result
            
            return None
    except Exception as e:
        logger.warning(f"Error in fetch_and_sync_ad_creative_from_meta: {e}")
        return None

@app.get("/api/meta/ad-creative/{ad_id}")
async def get_ad_creative(
    ad_id: str,
    lead_id: Optional[str] = None,
    ad_name: Optional[str] = None,
    user: dict = Depends(require_auth)
):
    """
    Resolve ad creative data from Google Drive storage, local cache, or directly from Meta if access granted.
    Never fails with raw 400 errors or polls repeatedly.
    """
    from backend.integrations import google_drive

    # 1. Check if lead already has creative cached in database
    if lead_id:
        try:
            lead = Repository.get_lead(lead_id)
            if lead:
                ch = lead.get("channel_data") or {}
                if isinstance(ch, str):
                    ch = json.loads(ch)
                if not ad_name:
                    ad_name = ch.get("ad_name") or lead.get("meta_ad_name")
                if not ad_id or ad_id == "unknown":
                    ad_id = ch.get("ad_id") or ""
                
                existing_creative = ch.get("creative")
                if isinstance(existing_creative, dict) and (existing_creative.get("thumbnail_url") or existing_creative.get("file_id") or existing_creative.get("preview_link")):
                    return {"status": "success", "creative": existing_creative, "cached": True, "source": "lead_db"}
        except Exception as e:
            logger.warning(f"Error checking lead creative: {e}")

    # 2. Check in-memory cache
    cache_key = f"{ad_id}:{ad_name or ''}"
    if cache_key in _ad_creative_cache:
        creative = _ad_creative_cache[cache_key]
        if lead_id:
            _save_creative_to_lead(lead_id, creative)
        return {"status": "success", "creative": creative, "cached": True, "source": "memory_cache"}

    # 3. Check Google Drive Meta Ad Creatives folder & local storage
    if google_drive.is_available():
        drive_asset = google_drive.find_creative_in_drive(ad_name=ad_name or "", ad_id=ad_id or "")
        if drive_asset:
            creative = {
                "title": drive_asset.get("title") or ad_name or "Ad Creative",
                "filename": drive_asset.get("filename"),
                "file_id": drive_asset.get("file_id"),
                "mime_type": drive_asset.get("mime_type"),
                "is_video": drive_asset.get("is_video", True),
                "thumbnail_url": drive_asset.get("thumbnail_url"),
                "stream_url": drive_asset.get("stream_url"),
                "preview_link": drive_asset.get("preview_link"),
                "web_view_link": drive_asset.get("web_view_link"),
                "source": drive_asset.get("source", "google_drive")
            }
            _ad_creative_cache[cache_key] = creative
            if ad_id:
                _ad_creative_cache[ad_id] = creative
            if lead_id:
                _save_creative_to_lead(lead_id, creative)
            return {"status": "success", "creative": creative, "cached": False, "source": creative["source"]}

    # 4. Attempt direct Meta Graph API fetch & Drive sync (if token has ads_read permission)
    meta_synced = await fetch_and_sync_ad_creative_from_meta(ad_id, ad_name)
    if meta_synced:
        _ad_creative_cache[cache_key] = meta_synced
        if ad_id:
            _ad_creative_cache[ad_id] = meta_synced
        if lead_id:
            _save_creative_to_lead(lead_id, meta_synced)
        return {"status": "success", "creative": meta_synced, "cached": False, "source": "meta_synced_to_drive"}

    # 5. Graceful response if not in Google Drive yet
    folder_info = google_drive.get_or_create_creatives_folder() if google_drive.is_available() else None
    drive_folder_url = folder_info.get("webViewLink") if folder_info else f"https://drive.google.com/drive/folders/{google_drive.CREATIVES_FOLDER_ID}"
    
    return {
        "status": "not_found",
        "message": "Creative asset not found in Google Drive.",
        "drive_folder_id": google_drive.CREATIVES_FOLDER_ID,
        "drive_folder_url": drive_folder_url,
        "service_account_email": "zero7-crm-drive@cos-theta.iam.gserviceaccount.com",
        "ad_name": ad_name,
        "ad_id": ad_id,
        "creative": None
    }


@app.get("/api/creatives/drive-info")
async def get_drive_creatives_info(user: dict = Depends(require_auth)):
    """Return info about Google Drive creative storage folder and list available assets."""
    from backend.integrations import google_drive
    if not google_drive.is_available():
        return {"status": "error", "message": "Google Drive integration not available"}
    
    folder = google_drive.get_or_create_creatives_folder()
    files = google_drive.list_creative_files()
    return {
        "status": "success",
        "folder_id": google_drive.CREATIVES_FOLDER_ID,
        "folder_url": folder.get("webViewLink") if folder else f"https://drive.google.com/drive/folders/{google_drive.CREATIVES_FOLDER_ID}",
        "service_account_email": "zero7-crm-drive@cos-theta.iam.gserviceaccount.com",
        "files_count": len(files),
        "files": files
    }


@app.post("/api/creatives/set-folder")
async def set_creatives_drive_folder(data: dict, user: dict = Depends(require_auth)):
    """Set custom Google Drive folder or Shared Drive ID for creatives."""
    folder_id = (data.get("folder_id") or "").strip()
    if not folder_id:
        raise HTTPException(status_code=400, detail="folder_id is required")
    from backend.integrations import google_drive
    google_drive.set_creatives_folder_id(folder_id)
    folder_info = google_drive.get_or_create_creatives_folder()
    return {
        "status": "success",
        "folder_id": folder_id,
        "folder_url": folder_info.get("webViewLink") if folder_info else f"https://drive.google.com/drive/folders/{folder_id}"
    }



@app.post("/api/creatives/upload")
async def upload_ad_creative_file(
    file: UploadFile = File(...),
    lead_id: Optional[str] = Form(None),
    ad_name: Optional[str] = Form(None),
    user: dict = Depends(require_auth)
):
    """Upload an ad creative video or image directly to Google Drive."""
    from backend.integrations import google_drive
    if not google_drive.is_available():
        raise HTTPException(status_code=503, detail="Google Drive service not configured")
    
    try:
        content = await file.read()
        mime_type = file.content_type or "application/octet-stream"
        fname = file.filename or "ad_creative.mp4"
        
        result = google_drive.upload_ad_creative(
            file_bytes=content,
            filename=fname,
            mime_type=mime_type,
            ad_name=ad_name or ""
        )
        if not result:
            raise HTTPException(status_code=500, detail="Failed to upload file to Google Drive")
        
        creative = {
            "title": ad_name or fname,
            "filename": fname,
            "file_id": result["file_id"],
            "mime_type": mime_type,
            "is_video": mime_type.startswith("video/"),
            "thumbnail_url": result.get("thumbnail_url"),
            "stream_url": result.get("stream_url"),
            "preview_link": result.get("preview_link"),
            "web_view_link": result.get("web_view_link"),
            "source": "google_drive"
        }
        
        if lead_id:
            _save_creative_to_lead(lead_id, creative)
            
        return {"status": "success", "creative": creative}
    except Exception as ex:
        logger.error(f"Error in creative upload: {ex}")
        raise HTTPException(status_code=500, detail=str(ex))


@app.get("/api/creatives/stream/{file_id}")
async def stream_creative_media(file_id: str):
    """Stream media file from Google Drive."""
    from backend.integrations import google_drive
    data_tuple = google_drive.get_file_stream(file_id)
    if not data_tuple:
        raise HTTPException(status_code=404, detail="File not found on Google Drive")
    data_bytes, mime_type = data_tuple
    return StreamingResponse(io.BytesIO(data_bytes), media_type=mime_type)


@app.get("/api/creatives/thumbnail/{file_id}")
async def get_creative_thumbnail(file_id: str):
    """Redirect to Drive preview/thumbnail or stream file thumbnail."""
    # Drive public thumbnail URL pattern
    drive_thumb_url = f"https://drive.google.com/thumbnail?id={file_id}&sz=w600"
    return RedirectResponse(url=drive_thumb_url)


def _save_creative_to_lead(lead_id: str, creative: dict):
    """Save creative data into a lead's channel_data."""
    try:
        lead = Repository.get_lead(lead_id)
        if lead:
            ch = lead.get("channel_data") or {}
            if isinstance(ch, str):
                ch = json.loads(ch)
            ch["creative"] = creative
            Repository.update_lead(lead_id, {"channel_data": ch})
    except Exception as ex:
        print(f"Error saving creative to lead {lead_id}:", ex)


@app.get("/api/meta/backfill-creatives")
async def backfill_ad_creatives(force: bool = False, user: dict = Depends(require_auth)):
    """Backfill creative data for all Meta leads from Google Drive storage or cache."""
    from backend.integrations import google_drive

    leads = Repository.list_leads()
    meta_leads = [l for l in leads if l.get("source") == "meta_ads"]
    updated = 0
    errors = 0

    cached_files = google_drive.list_creative_files(force_refresh=True) if google_drive.is_available() else []

    for lead in meta_leads:
        ch = lead.get("channel_data") or {}
        if isinstance(ch, str):
            ch = json.loads(ch)
        
        if not force and ch.get("creative") and isinstance(ch["creative"], dict) and (ch["creative"].get("thumbnail_url") or ch["creative"].get("file_id")):
            continue

        ad_name = ch.get("ad_name") or lead.get("meta_ad_name") or ""
        ad_id = ch.get("ad_id") or ""

        # Check Drive & local assets
        if google_drive.is_available():
            drive_asset = google_drive.find_creative_in_drive(ad_name=ad_name, ad_id=ad_id, cached_files=cached_files)
            if drive_asset:

                creative = {
                    "title": drive_asset.get("title") or ad_name or "Ad Creative",
                    "filename": drive_asset.get("filename"),
                    "file_id": drive_asset.get("file_id"),
                    "mime_type": drive_asset.get("mime_type"),
                    "is_video": drive_asset.get("is_video", True),
                    "thumbnail_url": drive_asset.get("thumbnail_url"),
                    "stream_url": drive_asset.get("stream_url"),
                    "preview_link": drive_asset.get("preview_link"),
                    "web_view_link": drive_asset.get("web_view_link"),
                    "source": "google_drive"
                }
                ch["creative"] = creative
                try:
                    Repository.update_lead(lead["id"], {"channel_data": ch})
                    updated += 1
                    if ad_id:
                        _ad_creative_cache[ad_id] = creative
                except Exception as ex:
                    errors += 1
                continue

    return {"status": "success", "updated": updated, "errors": errors, "total_meta_leads": len(meta_leads)}


@app.get("/api/integrations/status")
def get_integrations_status(user: dict = Depends(require_auth)):
    domain = os.getenv("APP_DOMAIN", "cos.zero7.space")
    proto = "https" if not domain.startswith("localhost") and not domain.startswith("127.0.0.1") else "http"
    base_url = domain if domain.startswith("http") else f"{proto}://{domain}"
    webhook_url = f"{base_url}/api/webhooks/meta-leads"
    verify_token = os.getenv("META_VERIFY_TOKEN", "zero7_meta_verify_2026")
    leads = Repository.list_leads()
    meta_count = sum(1 for l in leads if l.get('source') == 'meta_ads')
    scraping_count = sum(1 for l in leads if l.get('source') == 'scraping')
    return {
        "meta_ads": {
            "name": "Meta Ads Lead Webhook",
            "status": "connected",
            "webhook_url": webhook_url,
            "verify_token": verify_token,
            "leads_received": meta_count,
            "event_type": "leadgen"
        },
        "whatsapp": {
            "name": "WhatsApp 24/7 Always-On Sync",
            "status": "connected",
            "protocol": "Baileys Daemon + Click-to-Chat",
            "account_phone": "+91 9993202900",
            "account_label": "Abhijeet Personal",
            "service": "zero7-whatsapp.service (systemd)",
            "uptime": "24/7 Always-On Active",
            "messages_synced": Repository._execute("SELECT COUNT(*) as cnt FROM whatsapp_messages", fetchone=True)['cnt'],
            "default_country_code": "+91",
            "message_templates_enabled": True
        },
        "scraping": {
            "name": "B2B Lead Scraping Ingestion",
            "status": "connected",
            "endpoint": "/api/leads/import-csv",
            "leads_ingested": scraping_count,
            "supported_formats": ["CSV", "JSON"]
        },
        "google_drive": {
            "name": "Google Drive Call Recordings",
            "status": "connected" if drive_is_available() else "staged",
            "note": "Service Account authenticated" if drive_is_available() else "Ready for Google Service Account integration"
        },
        "deepgram": {
            "name": "Deepgram Call Transcription",
            "status": "connected" if deepgram_is_available() else "not_configured",
            "model": "Nova-2",
            "features": ["Auto-transcription", "Hindi+English", "Speaker diarization", "Drive transcript upload"]
        }
    }


# ─── GOOGLE INTEGRATIONS ─────────────────────────────────

@app.post("/api/integrations/google-sheets/sync-priorities")
async def sync_google_sheets_priorities(request: Request, user: dict = Depends(require_auth)):
    sheet_id = "1hYCgiSy1upKN7BqsILAL5vSz1O-6wrLNyxK7XZldCxI"
    sheet_name = "Lead form - Higher intent"
    try:
        body = await request.json()
        if body and isinstance(body, dict):
            sheet_id = body.get("sheet_id", sheet_id)
            sheet_name = body.get("sheet_name", sheet_name)
    except Exception:
        pass
    try:
        result = Repository.sync_sheet_priorities(sheet_id=sheet_id, sheet_name=sheet_name)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to sync priorities: {str(e)}")

def get_google_tasks_client():
    cfg = Repository.get_google_tasks_config()
    if not cfg or not cfg.get("refresh_token") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return None
    
    def save_token_cb(new_access_token, expires_in=None):
        Repository.save_google_tasks_config({"access_token": new_access_token})
        
    return GoogleTasksClient(cfg, save_token_callback=save_token_cb)

@app.post("/api/leads/{id}/generate-task")
def generate_lead_task(id: str, background_tasks: BackgroundTasks, user: dict = Depends(require_auth)):
    updated = Repository.generate_lead_task(id)
    if not updated:
        raise HTTPException(status_code=404, detail="Lead not found")
        
    def auto_sync():
        try:
            client = get_google_tasks_client()
            if client:
                tid = client.create_or_update_lead_task(updated)
                if tid:
                    Repository.update_lead_google_task_id(id, tid)
        except Exception as e:
            logging.getLogger(__name__).warning(f"Auto-sync to Google Tasks failed: {e}")
            
    background_tasks.add_task(auto_sync)
    return updated

@app.post("/api/leads/generate-all-tasks")
def generate_all_lead_tasks(background_tasks: BackgroundTasks, user: dict = Depends(require_auth)):
    res = Repository.generate_all_lead_tasks()
    
    def auto_sync_all():
        try:
            client = get_google_tasks_client()
            if client:
                leads = Repository.list_leads({})
                sync_res = client.sync_all_lead_tasks(leads)
                for lead_id, task_id in sync_res.get("task_ids", {}).items():
                    Repository.update_lead_google_task_id(lead_id, task_id)
        except Exception as e:
            logging.getLogger(__name__).warning(f"Auto-sync all to Google Tasks failed: {e}")
            
    background_tasks.add_task(auto_sync_all)
    return res

# --- Capital-Per-Unit-Time AI Scheduling Endpoints ---
@app.get("/api/schedule/daily")
def get_daily_schedule(capacity: int = 50, user: dict = Depends(require_auth)):
    """Fetch today's ranked 50-action battle plan ordered by capital per unit time."""
    plan = Repository.get_daily_battle_plan(max_daily_capacity=capacity)
    return plan

@app.post("/api/schedule/regenerate")
def regenerate_schedule(background_tasks: BackgroundTasks, user: dict = Depends(require_auth)):
    """Sync latest Google Sheet data and regenerate ranked daily schedule."""
    Repository.sync_sheet_priorities()
    plan = Repository.get_daily_battle_plan(max_daily_capacity=50)
    return {
        "status": "success",
        "message": f"Daily battle plan regenerated! Top 10 needle movers locked in ({plan.get('top10_pipeline_in_play')} in play).",
        "plan": plan
    }

@app.post("/api/schedule/{id}/complete")
def complete_scheduled_action(id: str, request_data: dict = Body(default={}), user: dict = Depends(require_auth)):
    """Mark a scheduled task completed, update last_contacted_at, log activity, and return updated state."""
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    note_text = request_data.get("outcome") or "Completed scheduled needle-mover action."
    now = Repository.now()
    Repository.update_lead(id, {
        "last_contacted_at": now,
        "next_action": f"Follow-up: {note_text[:40]}",
        "updated_at": now
    })
    try:
        Repository.create_activity({
            "lead_id": id,
            "user_id": user.get("user_id"),
            "type": "task_completed",
            "title": "Scheduled Action Executed",
            "description": note_text
        })
    except Exception:
        pass
    return {"status": "success", "message": "Scheduled action completed and logged."}

# --- Google Tasks Integration Endpoints ---
@app.get("/api/integrations/google-tasks/status")
def get_google_tasks_status():
    cfg = Repository.get_google_tasks_config()
    if not cfg or not cfg.get("refresh_token"):
        return {
            "connected": False,
            "client_id": cfg.get("client_id") if cfg else "",
            "task_list_title": GTASKS_LIST_TITLE,
            "auto_sync": True
        }
    return {
        "connected": True,
        "client_id": cfg.get("client_id", ""),
        "task_list_id": cfg.get("task_list_id", ""),
        "task_list_title": cfg.get("task_list_title") or GTASKS_LIST_TITLE,
        "auto_sync": bool(cfg.get("auto_sync", 1))
    }

@app.post("/api/integrations/google-tasks/credentials")
def save_google_tasks_credentials(data: dict, user: dict = Depends(require_auth)):
    client_id = data.get("client_id", "").strip()
    client_secret = data.get("client_secret", "").strip()
    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="Client ID and Client Secret are required")
    Repository.save_google_tasks_config({
        "client_id": client_id,
        "client_secret": client_secret
    })
    return {"status": "success", "message": "Credentials saved"}

@app.get("/api/integrations/google-tasks/auth-url")
def get_google_tasks_auth_url(request: Request, client_id: Optional[str] = None, client_secret: Optional[str] = None):
    cfg = Repository.get_google_tasks_config()
    c_id = (client_id or (cfg.get("client_id") if cfg else "") or "").strip()
    c_sec = (client_secret or (cfg.get("client_secret") if cfg else "") or "").strip()
    
    if c_id and c_sec:
        Repository.save_google_tasks_config({"client_id": c_id, "client_secret": c_sec})
    elif not c_id:
        raise HTTPException(status_code=400, detail="Client ID not configured. Please enter Client ID and Client Secret first.")
        
    redirect_uri = "https://cos.zero7.space/api/integrations/google-tasks/callback"
    url = gtasks_get_auth_url(c_id, redirect_uri)
    return {"auth_url": url, "redirect_uri": redirect_uri}

@app.get("/api/integrations/google-tasks/callback")
def google_tasks_callback(request: Request, code: Optional[str] = None, error: Optional[str] = None):
    if error or not code:
        return RedirectResponse(url="/#/integrations?gtasks_error=" + (error or "missing_code"))
        
    cfg = Repository.get_google_tasks_config()
    if not cfg or not cfg.get("client_id") or not cfg.get("client_secret"):
        return RedirectResponse(url="/#/integrations?gtasks_error=missing_credentials")
        
    redirect_uri = "https://cos.zero7.space/api/integrations/google-tasks/callback"
    tokens = gtasks_exchange_code(cfg["client_id"], cfg["client_secret"], code, redirect_uri)
    if not tokens or "access_token" not in tokens:
        base_url = str(request.base_url).rstrip('/')
        tokens = gtasks_exchange_code(cfg["client_id"], cfg["client_secret"], code, f"{base_url}/api/integrations/google-tasks/callback")
        
    if not tokens or "access_token" not in tokens:
        return RedirectResponse(url="/#/integrations?gtasks_error=exchange_failed")
        
    Repository.save_google_tasks_config({
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token") or cfg.get("refresh_token"),
        "is_active": 1
    })
    
    client = get_google_tasks_client()
    if client:
        list_id = client.ensure_tasklist()
        if list_id:
            Repository.save_google_tasks_config({"task_list_id": list_id})
            
    return RedirectResponse(url="/#/integrations?gtasks_success=1")

@app.post("/api/integrations/google-tasks/disconnect")
def disconnect_google_tasks(user: dict = Depends(require_auth)):
    return Repository.disconnect_google_tasks()

@app.post("/api/integrations/google-tasks/sync-all")
def sync_all_to_google_tasks(user: dict = Depends(require_auth)):
    client = get_google_tasks_client()
    if not client:
        raise HTTPException(status_code=400, detail="Google Tasks is not connected. Please connect Google Tasks first.")
        
    leads = Repository.list_leads({})
    res = client.sync_all_lead_tasks(leads)
    
    for lead_id, task_id in res.get("task_ids", {}).items():
        Repository.update_lead_google_task_id(lead_id, task_id)
        
    return {
        "status": "success",
        "synced": res.get("synced", 0),
        "total": res.get("total_leads", 0),
        "failed": res.get("failed", 0),
        "message": f"Successfully synced {res.get('synced', 0)} lead tasks to Google Tasks (visible in your phone widget)"
    }

@app.post("/api/leads/{id}/sync-google-task")
def sync_single_lead_task(id: str, user: dict = Depends(require_auth)):
    client = get_google_tasks_client()
    if not client:
        raise HTTPException(status_code=400, detail="Google Tasks is not connected")
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not lead.get("next_action"):
        raise HTTPException(status_code=400, detail="Lead does not have a next action scheduled")
    task_id = client.create_or_update_lead_task(lead)
    if task_id:
        Repository.update_lead_google_task_id(id, task_id)
        return {"status": "success", "google_task_id": task_id, "message": "Synced to Google Tasks"}
    raise HTTPException(status_code=500, detail="Failed to sync to Google Tasks")

# ═════════════════════════════════════════════════════════════════
# AI-NATIVE CRM: COMPANY INTELLIGENCE & PROTOTYPE STUDIO ENDPOINTS
# ═════════════════════════════════════════════════════════════════

@app.get("/api/leads/{id}/ai/brief")
def get_company_brief(id: str, user: dict = Depends(require_auth)):
    """Fetch existing company brief, or return None if not yet generated."""
    brief = Repository.get_company_brief(id)
    if brief:
        return brief
    return None

@app.post("/api/leads/{id}/ai/research")
def refresh_company_brief(id: str, background_tasks: BackgroundTasks, user: dict = Depends(require_auth)):
    """Force re-run the research agent to generate an updated company brief."""
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    try:
        notes = Repository.get_lead_notes(id)
    except Exception:
        notes = []
    try:
        calls = Repository.get_lead_calls(id)
    except Exception:
        calls = []
    try:
        wa = Repository.get_lead_whatsapp_messages(id)
    except Exception:
        wa = []
    
    try:
        data = generate_company_brief(lead, notes=notes, calls=calls, wa_messages=wa)
        saved = Repository.save_company_brief(id, data)
        if lead.get("github_repo_url") or lead.get("project_path"):
            background_tasks.add_task(sync_lead_brief_to_vault, id)
        return saved
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Research Agent error: {str(e)}")

@app.post("/api/leads/{id}/ai/catch-me-up")
def founder_catch_me_up(id: str, user: dict = Depends(require_auth)):
    """
    Synthesizes a 60-second tactical founder debrief ("Catch Me Up")
    including recent activity, pending commitments, 3 killer talking points, and watch-outs.
    """
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    try:
        notes = Repository.get_lead_notes(id)
    except Exception:
        notes = []
    try:
        calls = Repository.get_lead_calls(id)
    except Exception:
        calls = []
    try:
        wa = Repository.get_lead_whatsapp_messages(id)
    except Exception:
        wa = []
    try:
        prototypes = Repository.get_lead_prototypes(id)
    except Exception:
        prototypes = []
    
    brief = Repository.get_company_brief(id)

    try:
        data = generate_founder_handoff(lead, brief=brief, notes=notes, calls=calls, wa_messages=wa, prototypes=prototypes)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Founder Handoff error: {str(e)}")

@app.post("/api/leads/{id}/github/provision")
def provision_lead_github_vault(id: str, user: dict = Depends(require_auth)):
    """
    Provisions a private GitHub repository vault and local project folder
    for this lead with universal AI instructions (zero7.json, CLAUDE.md, .cursorrules).
    """
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    result = provision_client_vault(id)
    if "error" in result and not result.get("success"):
        raise HTTPException(status_code=500, detail=result["error"])
    return result

@app.get("/api/leads/{id}/ai/prototypes")
def list_lead_prototypes(id: str, user: dict = Depends(require_auth)):
    """List all prototypes generated for this lead."""
    return Repository.get_lead_prototypes(id)

@app.get("/api/leads/{id}/ai/prototypes/{proto_id}")
def get_lead_prototype(id: str, proto_id: str, user: dict = Depends(require_auth)):
    """Fetch full prototype details including HTML content and conversation history."""
    proto = Repository.get_prototype_by_id(proto_id)
    if not proto or proto.get('lead_id') != id:
        raise HTTPException(status_code=404, detail="Prototype not found")
    return proto

@app.post("/api/leads/{id}/ai/prototype/chat")
async def chat_and_iterate_prototype(id: str, request: Request, user: dict = Depends(require_auth)):
    """
    Conversational prototype studio endpoint.
    Takes user instruction (e.g. 'Build an order management flow for Vidhi'),
    generates conversational reply + working interactive HTML app + WhatsApp pitch copy.
    """
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    body = await request.json()
    user_message = body.get("message", "").strip()
    proto_id = body.get("prototype_id")
    
    if not user_message:
        raise HTTPException(status_code=400, detail="Prompt message cannot be empty")
        
    brief = Repository.get_company_brief(id)
    
    existing_proto = None
    conv_history = []
    if proto_id:
        existing_proto = Repository.get_prototype_by_id(proto_id)
        if existing_proto:
            conv_history = existing_proto.get("conversation_history", []) or []

    try:
        result = generate_or_iterate_prototype(lead, conv_history, user_message, brief)
        
        # Update conversation history
        conv_history.append({"role": "user", "content": user_message})
        conv_history.append({"role": "assistant", "content": result.get("reply_text", "")})
        
        proto_data = {
            "title": result.get("prototype_title", f"{lead.get('business_name', 'Lead')} Prototype"),
            "description": result.get("sow_summary", ""),
            "html_content": result.get("prototype_html", ""),
            "conversation_history": conv_history
        }
        
        saved = Repository.save_prototype(id, proto_data, proto_id=proto_id)
        
        return {
            "status": "success",
            "prototype_id": saved["id"],
            "title": saved["title"],
            "reply_text": result.get("reply_text"),
            "html_content": saved["html_content"],
            "whatsapp_pitch": result.get("whatsapp_pitch"),
            "sow_summary": result.get("sow_summary"),
            "share_token": saved["share_token"],
            "conversation_history": saved.get("conversation_history", [])
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prototype Generator error: {str(e)}")

# ── Sales Rep Prototype Briefing & Context Endpoints ──

@app.get("/api/leads/{id}/prototype-rep-context")
def get_lead_prototype_rep_context(id: str, user: dict = Depends(require_auth)):
    """Fetches stored rep briefing context or pre-fills smart suggestions from brief and transcripts."""
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    stored = Repository.get_prototype_rep_context(id) or {}
    brief = Repository.get_company_brief(id) or {}
    try:
        calls = Repository.get_lead_calls(id) or []
    except Exception:
        calls = []

    biz = lead.get("business_name") or lead.get("name") or "Client"
    exec_summary = brief.get("executive_summary") or brief.get("overview") or ""
    pain_points = brief.get("operational_bottlenecks") or brief.get("pain_points") or []
    if isinstance(pain_points, str):
        pain_points = [pain_points]

    has_transcripts = any(bool(c.get("transcription_text")) for c in calls)
    has_brief = bool(exec_summary)
    is_briefed = bool(stored and any(stored.values()))

    # Build smart contextual suggestions
    suggested_workflow = f"{biz} Operations & WhatsApp Dispatch Flow"
    if pain_points:
        first_p = pain_points[0]
        if "inventory" in first_p.lower():
            suggested_workflow = f"{biz} Real-time Inventory & WhatsApp Stock Alert System"
        elif "order" in first_p.lower():
            suggested_workflow = f"{biz} Direct WhatsApp Order Capture & Dispatch Pipeline"

    return {
        "lead_id": id,
        "business_name": biz,
        "lead_name": lead.get("name"),
        "city": lead.get("city", "India"),
        "readiness": {
            "has_transcripts": has_transcripts,
            "transcript_count": sum(1 for c in calls if c.get("transcription_text")),
            "has_brief": has_brief,
            "is_briefed": is_briefed,
            "can_deploy": True
        },
        "rep_context": stored,
        "suggestions": {
            "suggested_workflow": suggested_workflow,
            "suggested_screens": ["Dashboard", "Orders Kanban", "Driver Dispatch", "WhatsApp Customer Share", "1-Click Invoice"],
            "pain_points": pain_points[:3],
            "brief_summary": exec_summary[:280]
        }
    }

@app.post("/api/leads/{id}/prototype-rep-context")
def save_lead_prototype_rep_context(id: str, data: PrototypeRepContextUpdate, background_tasks: BackgroundTasks, user: dict = Depends(require_auth)):
    """Saves rep tactical context for prototype creation and optionally deploys the agent."""
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    context_dict = {
        "primary_workflow": data.primary_workflow,
        "key_screens": data.key_screens or [],
        "tactical_notes": data.tactical_notes,
        "target_viewport": data.target_viewport or "desktop",
        "visual_style": data.visual_style or "zero7_dark",
        "briefed_by": user.get("name") or user.get("user_id") or "Sales Rep",
        "briefed_at": Repository.now()
    }
    saved_ctx = Repository.save_prototype_rep_context(id, context_dict)

    job_result = None
    if data.deploy_agent_now:
        screens_text = ", ".join(data.key_screens) if data.key_screens else "Core Workflow Screens"
        prompt = (
            f"Build a high-fidelity interactive prototype for {lead.get('business_name') or lead.get('name')}.\n"
            f"Primary Workflow: {data.primary_workflow or 'Operational Workflow'}\n"
            f"Key Required Screens: {screens_text}\n"
            f"Rep Tactical Context: {data.tactical_notes or 'Focus on eliminating manual WhatsApp/Excel bottlenecks'}\n"
            f"Style: {data.visual_style or 'Zero7 Dark Modern'}\n"
            f"Target Viewport: {data.target_viewport or 'Desktop'}\n"
            f"Include @lead.profile and @transcripts.all for full background context."
        )
        job_create = AgentJobCreate(
            prompt=prompt,
            agent_slug="prototype_maker",
            role="engineer",
            rep_context=context_dict
        )
        job_result = create_lead_agent_job(id, job_create, background_tasks, user)

    return {
        "status": "success",
        "lead_id": id,
        "rep_context": saved_ctx,
        "job": job_result
    }

# ── Public Shareable Prototype Preview Endpoints ──

@app.get("/api/public/prototype/{token}/raw")
def serve_raw_prototype_html(token: str):
    """Raw HTML content for iframe sandboxing."""
    proto = Repository.get_prototype_by_token(token)
    if not proto:
        raise HTTPException(status_code=404, detail="Prototype preview not found")
    Repository.increment_prototype_views(token)
    return HTMLResponse(content=proto.get("html_content") or "<h3>No preview content</h3>", status_code=200)

@app.get("/api/public/prototype/{token}")
def serve_public_prototype_shell(token: str):
    """Client-facing presentation frame with Zero7 branding and direct WhatsApp connect."""
    proto = Repository.get_prototype_by_token(token)
    if not proto:
        raise HTTPException(status_code=404, detail="Prototype preview not found")
    
    lead = Repository.get_lead(proto["lead_id"]) if proto.get("lead_id") else {}
    lead_name = lead.get("name", "Valued Partner")
    biz_name = lead.get("business_name") or "Your Business"
    title = proto.get("title", f"{biz_name} Prototype")
    
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title} — Zero7 Concept Demo</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body, html {{ margin: 0; padding: 0; height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }}
    .app-frame {{ height: calc(100vh - 56px); width: 100%; border: none; }}
  </style>
</head>
<body class="bg-slate-900 flex flex-col">
  <!-- Zero7 Presentation Bar -->
  <header class="h-14 bg-slate-950 border-b border-slate-800 px-4 flex items-center justify-between text-white shrink-0 z-10">
    <div class="flex items-center gap-3">
      <div class="w-8 h-8 rounded-lg bg-emerald-500 text-slate-950 font-bold flex items-center justify-center text-sm">Z7</div>
      <div>
        <div class="font-semibold text-sm tracking-tight flex items-center gap-2">
          <span>{title}</span>
          <span class="text-[10px] uppercase font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">Interactive Concept</span>
        </div>
        <div class="text-[11px] text-slate-400">Custom Engineering Preview built for <strong class="text-slate-200">{lead_name}</strong> by Zero7</div>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <a href="https://wa.me/919993202900?text=Hi%20Zero7%20Team!%20I%20reviewed%20the%20prototype%20for%20{biz_name}%20and%20would%20like%20to%20discuss%20next%20steps." 
         target="_blank" 
         class="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shadow-sm">
        <span>💬 Discuss on WhatsApp</span>
      </a>
    </div>
  </header>
  
  <!-- Interactive Sandboxed App -->
  <iframe src="/api/public/prototype/{token}/raw" class="app-frame" sandbox="allow-scripts allow-forms allow-same-origin allow-modals"></iframe>
</body>
</html>"""
    return HTMLResponse(content=html, status_code=200)

@app.get("/p/{token}")
def serve_shortlink_prototype(token: str):
    """Clean shortlink for client prototype previews."""
    return serve_public_prototype_shell(token)

@app.post("/api/leads/{id}/publish-prototype")
async def publish_lead_prototype(id: str, request: Request):
    """Direct prototype publisher endpoint for Antigravity Agent and skills."""
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    data = await request.json()
    title = data.get("title") or f"{lead.get('business_name') or lead.get('name') or 'Client'} Prototype"
    desc = data.get("description") or "Interactive concept prototype"
    html_content = data.get("html_content")
    if not html_content:
        raise HTTPException(status_code=400, detail="html_content is required")

    saved = Repository.save_prototype(id, {
        "title": title,
        "description": desc,
        "html_content": html_content
    })
    share_token = saved["share_token"]
    public_url = f"https://cos.zero7.space/p/{share_token}"
    Repository.update_lead(id, {
        "prototype_status": "built",
        "prototype_url": public_url
    })
    return {
        "success": True,
        "prototype_id": saved["id"],
        "share_token": share_token,
        "public_url": public_url,
        "status": "built"
    }

@app.post("/api/leads/{id}/verify-subdomain")
async def verify_lead_subdomain(id: str, request: Request):
    """Verifies DNS routing and reachability for a lead's assigned subdomain."""
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    data = await request.json()
    subdomain = data.get("subdomain") or lead.get("subdomain")
    if not subdomain:
        raise HTTPException(status_code=400, detail="subdomain is required")

    clean_subdomain = subdomain.replace("https://", "").replace("http://", "").split("/")[0].strip()
    import socket
    dns_resolved = False
    ip = None
    try:
        ip = socket.gethostbyname(clean_subdomain)
        dns_resolved = (ip == "68.183.92.215")
    except Exception:
        dns_resolved = False

    status = "active" if dns_resolved else "pending"
    Repository.update_lead(id, {
        "subdomain": clean_subdomain,
        "subdomain_status": status
    })
    return {
        "subdomain": clean_subdomain,
        "status": status,
        "resolved_ip": ip,
        "droplet_ip": "68.183.92.215"
    }


@app.post("/api/leads/{id}/provision-subdomain")
async def provision_lead_subdomain(id: str, request: Request):
    """Provisions or re-edits a client subdomain, automatically deleting previous DNS record if changed."""
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    data = await request.json()
    subdomain = data.get("subdomain") or lead.get("subdomain")
    if not subdomain:
        biz = lead.get("business_name") or lead.get("name") or "client"
        subdomain = f"proto-{biz}"

    force = bool(data.get("force", False))

    from backend.integrations.dns_provisioner import dns_provisioner
    result = dns_provisioner.provision_subdomain(id, subdomain, allow_collision_override=force)
    
    # Handle collision with another lead
    if result.get("collision"):
        return JSONResponse(status_code=409, content=result)

    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to provision subdomain"))
    return result

@app.delete("/api/leads/{id}/provision-subdomain")
async def deprovision_lead_subdomain(id: str):
    """De-provisions client subdomain and cleans up DNS record."""
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    from backend.integrations.dns_provisioner import dns_provisioner
    result = dns_provisioner.deprovision_subdomain(id)
    return result

@app.get("/api/leads/{id}/dns-status")
def get_lead_dns_status(id: str):
    """Returns DNS reachability, record ID, and assigned subdomain for a lead."""
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    subdomain = lead.get("subdomain")
    dns_record_id = lead.get("dns_record_id")
    status = lead.get("subdomain_status", "pending")
    
    dns_resolved = False
    resolved_ip = None
    if subdomain:
        import socket
        try:
            resolved_ip = socket.gethostbyname(subdomain)
            dns_resolved = (resolved_ip == "68.183.92.215")
        except Exception as e:
            resolved_ip = str(e)

    return {
        "lead_id": id,
        "subdomain": subdomain,
        "dns_record_id": dns_record_id,
        "status": status,
        "dns_verified": dns_resolved,
        "resolved_ip": resolved_ip,
        "droplet_ip": "68.183.92.215",
        "live_url": f"https://{subdomain}" if subdomain else None
    }


# ==================== ANTIGRAVITY AGENT ENDPOINTS ====================

class AgentJobBroadcaster:
    def __init__(self):
        self._subscribers = defaultdict(set)

    def subscribe(self, job_id: str) -> asyncio.Queue:
        q = asyncio.Queue()
        self._subscribers[job_id].add(q)
        return q

    def unsubscribe(self, job_id: str, q: asyncio.Queue):
        if job_id in self._subscribers:
            self._subscribers[job_id].discard(q)
            if not self._subscribers[job_id]:
                del self._subscribers[job_id]

    async def broadcast(self, job_id: str, data: dict):
        if job_id in self._subscribers:
            for q in list(self._subscribers[job_id]):
                try:
                    q.put_nowait(data)
                except Exception:
                    pass

agent_broadcaster = AgentJobBroadcaster()

@app.get("/api/agent/worker/status")
def get_worker_status():
    """Returns whether the local host Windows worker is online and active."""
    return Repository.get_worker_status("local_host")

@app.get("/api/agent/workers")
def get_all_workers():
    """Returns list of all registered workstations with live connectivity status."""
    return {"workers": Repository.list_all_workers()}

@app.delete("/api/agent/workers/{worker_id}")
def delete_worker(worker_id: str):
    """Remove a disconnected or obsolete agent workstation card."""
    return Repository.delete_worker_heartbeat(worker_id)

@app.post("/api/agent/workers/prune")
def prune_workers():
    """Prune stale offline workstations and ghost duplicates."""
    return Repository.prune_stale_workers()

@app.get("/api/agent/connector/download")
def download_agent_connector(token: Optional[str] = None, request: Request = None):
    """Packages the Zero7 Desktop Agent Bridge and native Windows runner into a personalized zip archive."""
    import zipfile
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    agent_worker_dir = os.path.join(base_dir, "agent_worker")

    # Resolve requesting user for personalized configuration bundle
    auth_token = token
    if not auth_token and request and request.headers.get("Authorization"):
        auth_header = request.headers.get("Authorization")
        if auth_header.startswith("Bearer "):
            auth_token = auth_header[7:]

    user_info = None
    if auth_token:
        try:
            from backend.auth import decode_token
            decoded = decode_token(auth_token)
            if decoded and decoded.get("user_id"):
                user_info = Repository.get_user(decoded["user_id"])
        except Exception:
            pass

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(agent_worker_dir):
            if "__pycache__" in root:
                continue
            for f in files:
                if f.endswith(".log") or f.endswith(".pyc"):
                    continue
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, agent_worker_dir)

                # Embed personalized identity if user is authenticated
                if f == "worker_config.json" and user_info:
                    cfg_content = json.dumps({
                        "user_email": user_info['email'],
                        "user_name": user_info['name'],
                        "user_id": user_info['id'],
                        "server_url": "https://cos.zero7.space",
                        "paired": True,
                        "created_at": Repository.now()
                    }, indent=2)
                    zf.writestr(os.path.join("Zero7_Agent_Bridge", rel_path), cfg_content)
                else:
                    zf.write(full_path, os.path.join("Zero7_Agent_Bridge", rel_path))

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=zero7-agent-bridge-installer.zip"}
    )

@app.post("/api/agent/device/pair")
def pair_device(data: DevicePairRequest, request: Request):
    """Authenticates founder credentials from the desktop companion and pairs their physical workstation."""
    user = Repository.get_user_by_email(data.email)
    if not user or not verify_password(data.password, user['password_hash']):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password. Only registered Zero7 CRM accounts can attach a workstation."
        )

    client_ip = request.client.host if request.client else None
    machine = data.machine_name or "Workstation"
    clean_machine = re.sub(r'[^a-zA-Z0-9_\-]', '', machine.replace(' ', '_'))
    clean_name = re.sub(r'[^a-zA-Z0-9_\-]', '', user['name'].replace(' ', '_').lower())
    worker_id = f"{clean_machine}_{clean_name}"

    token = create_token(user['id'], user.get('role', 'admin'))

    success = Repository.record_worker_heartbeat(
        worker_id=worker_id,
        metadata={"paired_via": "desktop_login", "installed_at": Repository.now()},
        machine_name=machine,
        user_email=user['email'],
        user_name=user['name'],
        os_info=data.os_info or "Windows",
        ip_address=client_ip,
        install_path=data.install_path,
        projects_root=data.projects_root,
        device_token=token
    )

    if not success:
        raise HTTPException(status_code=400, detail="Failed to register workstation attachment.")

    return {
        "status": "paired",
        "worker_id": worker_id,
        "machine_name": machine,
        "user_email": user['email'],
        "user_name": user['name'],
        "user_id": user['id'],
        "token": token
    }

@app.get("/api/agent/projects")
def get_available_agent_projects():
    """Returns list of detected Antigravity projects from local worker."""
    status = Repository.get_worker_status("local_host")
    projects = []
    if status and status.get("metadata") and status["metadata"].get("projects"):
        projects = status["metadata"]["projects"]
    return {"projects": projects}

@app.get("/api/agent/projects/{project_id_or_name}/conversations")
def get_project_conversations(project_id_or_name: str):
    """Returns list of synced conversation threads from Antigravity for a specific project."""
    status = Repository.get_worker_status("local_host")
    convs = []
    if status and status.get("metadata") and status["metadata"].get("conversations"):
        conv_data = status["metadata"]["conversations"]
        by_id = conv_data.get("by_project_id", {})
        by_name = conv_data.get("by_project_name", {})

        target = project_id_or_name.strip()
        target_lower = target.lower()

        if target in by_id:
            convs = by_id[target]
        elif target_lower in by_name:
            convs = by_name[target_lower]
        else:
            # Fuzzy match
            for pid, clist in by_id.items():
                if target_lower in pid.lower():
                    convs = clist
                    break
            if not convs:
                for pname, clist in by_name.items():
                    if target_lower in pname.lower() or pname.lower() in target_lower:
                        convs = clist
                        break
    return {"conversations": convs}

@app.post("/api/agent/worker/heartbeat")
def worker_heartbeat(data: WorkerHeartbeat, request: Request):
    """Worker heartbeat sent every ~20-30s from local host machine. Rejects unauthenticated/phantom users."""
    client_ip = request.client.host if request.client else None
    success = Repository.record_worker_heartbeat(
        worker_id=data.worker_id,
        metadata=data.metadata,
        machine_name=data.machine_name,
        user_email=data.user_email,
        user_name=data.user_name,
        os_info=data.os_info,
        ip_address=client_ip,
        install_path=data.install_path,
        projects_root=data.projects_root,
        device_token=data.device_token
    )
    if not success:
        raise HTTPException(
            status_code=401,
            detail=f"Unrecognized or unauthenticated account '{data.user_email}'. Please pair your desktop bridge via login."
        )
    return {"status": "ok"}

@app.post("/api/agent/worker/poll")
def worker_poll(request: Request):
    """Worker pulls next pending job and any queued worker commands to execute."""
    cmd = Repository.pop_pending_worker_command()
    job = Repository.claim_pending_agent_job()
    return {"job": job, "command": cmd}

@app.get("/api/agent/conversations/{conv_id}/transcript")
def get_conversation_transcript(conv_id: str):
    """Fetches full historical dialogue turns for an Antigravity conversation thread."""
    if conv_id.startswith("cloud_"):
        job_id = conv_id.replace("cloud_", "")
        job = Repository.get_agent_job(job_id)
        if job:
            msgs = []
            if job.get("prompt"):
                msgs.append({"role": "user", "content": job["prompt"], "created_at": job.get("created_at")})
            out = job.get("stream_output") or job.get("result") or ""
            if out or job.get("thoughts"):
                msgs.append({
                    "role": "assistant",
                    "content": out or ("Task is executing on Cloud AI Gateway..." if job.get("status") in ["pending", "running"] else "Task completed."),
                    "thoughts": job.get("thoughts", ""),
                    "created_at": job.get("completed_at") or job.get("updated_at") or job.get("created_at")
                })
            return {"conversation_id": conv_id, "messages": msgs, "pending": False}
        return {"conversation_id": conv_id, "messages": [], "pending": False}

    cached = Repository.get_conversation_transcript(conv_id)
    if cached and cached.get("messages") and len(cached["messages"]) > 0:
        return cached
    # Queue worker command to read local transcript from Windows PC
    Repository.queue_worker_command("get_transcript", {"conversation_id": conv_id})
    return {"conversation_id": conv_id, "messages": [], "pending": True}

@app.post("/api/agent/worker/conversations/{conv_id}/transcript")
def worker_upload_transcript(conv_id: str, data: ConversationTranscriptUpload, request: Request):
    """Worker uploads parsed transcript messages from host PC."""
    Repository.save_conversation_transcript(conv_id, data.project_id, data.messages)
    return {"status": "ok"}

@app.post("/api/agent/projects/create")
def create_agent_project(data: ProjectCreateRequest, user: dict = Depends(require_auth)):
    """Provisions a new Antigravity project directory and config."""
    biz_name = data.name.strip()
    default_path = data.path or rf"C:\Users\m_hit\Desktop\zero7 Consultancy\Projects\{biz_name}"
    cmd_id = Repository.queue_worker_command("create_project", {
        "name": biz_name,
        "path": default_path,
        "lead_id": data.lead_id
    })
    if data.lead_id:
        Repository.update_lead(data.lead_id, {
            "project_name": biz_name,
            "project_path": default_path
        })
    return {"status": "queued", "command_id": cmd_id, "name": biz_name, "path": default_path}

@app.post("/api/leads/{id}/agent/new-conversation")
def reset_lead_conversation(id: str, user: dict = Depends(require_auth)):
    """Resets the conversation pointer for this lead so the next prompt begins a fresh thread."""
    return {"status": "ok", "message": "Conversation context reset. Next prompt will start a new thread."}

@app.get("/api/agent/models")
def list_agent_models(user: dict = Depends(require_auth)):
    """Fetches live OmniRoute models catalog and combos."""
    from backend.ai.client import get_available_models, OMNIROUTE_TUNNEL_URL, OMNIROUTE_LOCAL_URL
    models = get_available_models()
    return {
        "status": "success",
        "gateway": "OmniRoute",
        "local_endpoint": OMNIROUTE_LOCAL_URL,
        "tunnel_endpoint": OMNIROUTE_TUNNEL_URL,
        "total_models": len(models),
        "models": models[:100]
    }

@app.post("/api/agent/worker/jobs/{job_id}/stream")
async def worker_update_stream(job_id: str, data: AgentJobStreamUpdate, request: Request):
    """Worker streams back incremental thoughts, console output, and conversation ID."""
    job = Repository.get_agent_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    Repository.update_agent_job_stream(
        job_id=job_id,
        stream_output=data.stream_output,
        thoughts=data.thoughts,
        conversation_id=data.conversation_id
    )
    # Broadcast to SSE subscribers immediately
    await agent_broadcaster.broadcast(job_id, {
        "id": job_id,
        "status": "running",
        "stream_output": data.stream_output,
        "thoughts": data.thoughts,
        "conversation_id": data.conversation_id
    })
    return {"status": "ok"}

@app.post("/api/agent/worker/jobs/{job_id}/complete")
async def worker_complete_job(job_id: str, data: AgentJobComplete, request: Request):
    """Worker marks the job as completed or failed."""
    job = Repository.get_agent_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    completed = Repository.complete_agent_job(
        job_id=job_id,
        status=data.status,
        stream_output=data.stream_output,
        thoughts=data.thoughts,
        error_message=data.error_message,
        conversation_id=data.conversation_id,
        artifacts=data.artifacts
    )
    # Broadcast final completion to SSE subscribers
    await agent_broadcaster.broadcast(job_id, {
        "id": job_id,
        "status": data.status,
        "stream_output": data.stream_output,
        "thoughts": data.thoughts,
        "conversation_id": data.conversation_id,
        "artifacts": data.artifacts,
        "error_message": data.error_message
    })
    return {"status": "ok", "job": completed}

@app.get("/api/agent/jobs/{job_id}/events")
async def stream_agent_job_events(job_id: str, request: Request):
    """Zero-Latency Server-Sent Events (SSE) feed for live agent reasoning and output streaming."""
    job = Repository.get_agent_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator():
        q = agent_broadcaster.subscribe(job_id)
        try:
            initial_data = {
                "id": job["id"],
                "status": job.get("status"),
                "stream_output": job.get("stream_output", ""),
                "thoughts": job.get("thoughts", ""),
                "conversation_id": job.get("conversation_id"),
                "artifacts": job.get("artifacts", [])
            }
            yield f"data: {json.dumps(initial_data)}\n\n"

            if job.get("status") in ("completed", "failed"):
                return

            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {json.dumps(data)}\n\n"
                    if data.get("status") in ("completed", "failed"):
                        break
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            agent_broadcaster.unsubscribe(job_id, q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

async def execute_cloud_agent_failover(job_id: str):
    """
    Tier-2 Cloud AI Gateway Failover Engine.
    Executes if no local Antigravity worker picked up the job within 30-40 seconds,
    ensuring 100% uptime even if all founder laptops are asleep or shut down.
    """
    job = Repository.get_agent_job(job_id)
    if not job or job.get("status") in ("running", "completed", "failed"):
        return

    logger.info(f"[CLOUD FAILOVER] Executing Job {job_id} via Cloud AI Gateway...")
    lead_id = job.get("lead_id")
    lead = Repository.get_lead(lead_id) if lead_id else None
    agent_slug = job.get("agent_slug") or "prototype_maker"
    user_prompt = job.get("prompt", "")

    # Mark as running with cloud indicator
    Repository.update_agent_job_stream(
        job_id=job_id,
        stream_output="⚡ [Cloud AI Gateway Active] Processing agent task in cloud...",
        thoughts="Local Antigravity worker offline. Cloud gateway seamlessly executing task...",
        conversation_id="cloud_" + job_id
    )
    await agent_broadcaster.broadcast(job_id, {
        "id": job_id,
        "status": "running",
        "stream_output": "⚡ [Cloud AI Gateway Active] Processing prompt...",
        "thoughts": "Local worker offline. Cloud gateway seamlessly took over.",
        "conversation_id": "cloud_" + job_id
    })

    try:
        from backend.ai.client import chat_completion
        
        # Robust zero-crash prompt resolution
        PROTOTYPE_STUDIO_SYSTEM_PROMPT = (
            "You are Zero7's Principal Solutions Architect and Prototype Builder. "
            "Build complete, working, high-fidelity interactive HTML mockups with Tailwind CSS CDN."
        )
        try:
            from backend.ai.prototype_agent import PROTOTYPE_STUDIO_SYSTEM_PROMPT as _imported_prompt
            PROTOTYPE_STUDIO_SYSTEM_PROMPT = _imported_prompt
        except Exception:
            try:
                from backend.ai.prototype_agent import PROTOTYPE_SYSTEM_PROMPT as _fallback_prompt
                PROTOTYPE_STUDIO_SYSTEM_PROMPT = _fallback_prompt
            except Exception:
                pass

        brief = Repository.get_company_brief(lead_id) if lead_id else {}
        brief_text = brief.get("executive_summary", "") if brief else ""
        client_name = job.get("project_name") or (lead.get("business_name") if lead else "Client")

        # Extract sales rep tactical briefing if provided
        rep_ctx = job.get("rep_context")
        if isinstance(rep_ctx, str):
            try:
                rep_ctx = json.loads(rep_ctx)
            except Exception:
                rep_ctx = {}
        rep_context_text = ""
        if rep_ctx and any(rep_ctx.values()):
            screens = rep_ctx.get("key_screens", [])
            screens_str = ", ".join(screens) if isinstance(screens, list) else str(screens)
            rep_context_text = (
                f"\n\n--- SALES REP TACTICAL PROTOTYPE BRIEFING ---\n"
                f"- Primary Workflow to Showcase: {rep_ctx.get('primary_workflow', 'Core Operational Flow')}\n"
                f"- Critical Interactive Screens / Must-Haves: {screens_str}\n"
                f"- Rep's Tactical Note & Closing Hook: {rep_ctx.get('tactical_notes', 'N/A')}\n"
                f"- Target Viewport: {rep_ctx.get('target_viewport', 'Desktop & Mobile')}\n"
                f"- Visual Style: {rep_ctx.get('visual_style', 'Zero7 Dark Modern')}\n"
            )

        role_prompts = {
            "prototype_maker": f"{PROTOTYPE_STUDIO_SYSTEM_PROMPT}\n\nCRITICAL: Always output complete, working, high-fidelity HTML mockups in ```html ... ``` codeblocks with Tailwind CSS CDN.",
            "lead_researcher": "You are Zero7's Lead Researcher and Enterprise Systems Analyst. Analyze the client's business model, existing tech stack, bottlenecks, and market opportunities. Provide structured, actionable intelligence.",
            "sow_architect": "You are Zero7's Principal SOW Architect. Draft clear, comprehensive Scope of Work documents, breaking down technical deliverables, Phase 1 MVP sprints, timeline, and commercial terms.",
            "whatsapp_nudge": "You are Zero7's WhatsApp Outreach Specialist. Craft punchy, polite, high-converting follow-up pitches and WhatsApp messages that reference client context and drive action.",
            "chief": "You are Zero7's Chief Orchestrator and General Systems Architect. Coordinate multi-agent workflows, synthesize deliverables, and execute client strategy.",
            "pipeline_sentinel": "You are Zero7's Pipeline Sentinel & Relentless Team Accountability Agent. Audit client pipeline status, detect stalled proposals, uncontacted leads, and broken follow-ups. Question the team directly on the Zero7 WhatsApp group and demand status updates."
        }
        base_prompt = role_prompts.get(agent_slug, PROTOTYPE_STUDIO_SYSTEM_PROMPT)

        sys_msg = (
            f"{base_prompt}\n\n"
            f"Target Client: {client_name}\n"
            f"Client Brief: {brief_text}"
            f"{rep_context_text}"
        )

        messages = [
            {"role": "system", "content": sys_msg},
            {"role": "user", "content": user_prompt}
        ]

        # Call OmniRoute / Cloud AI Gateway with chosen model
        from backend.ai.client import resolve_model_name, get_agent_model
        raw_model = job.get("model")
        chosen_model = resolve_model_name(raw_model) if raw_model and raw_model not in ("pro", "local", "flash") else get_agent_model(agent_slug)
        response_text = chat_completion(messages, model=chosen_model, temperature=0.7, max_tokens=3500)

        # Extract HTML prototype
        html_content = ""
        html_match = re.search(r"```html\s*(<!DOCTYPE html.*?)```", response_text, re.DOTALL | re.IGNORECASE)
        if not html_match:
            html_match = re.search(r"(<!DOCTYPE html.*?>.*?</html>)", response_text, re.DOTALL | re.IGNORECASE)
        if not html_match:
            html_match = re.search(r"(<html.*?>.*?</html>)", response_text, re.DOTALL | re.IGNORECASE)
        if html_match:
            html_content = html_match.group(1).strip()

        artifacts = []
        now_ts = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")

        # Save prototype in DB if lead exists
        if html_content and lead_id:
            try:
                existing_protos = Repository.get_lead_prototypes(lead_id)
                v_num = len(existing_protos) + 1
                proto_data = {
                    "version": f"v{v_num}",
                    "html_content": html_content,
                    "pitch_copy": f"Interactive Prototype {v_num} generated for {client_name}",
                    "conversation_history": [
                        {"role": "user", "content": user_prompt},
                        {"role": "assistant", "content": response_text[:500]}
                    ]
                }
                saved_proto = Repository.save_prototype(lead_id, proto_data)
                artifacts.append({
                    "name": f"v{v_num}_{agent_slug}.html",
                    "type": "prototype",
                    "id": saved_proto.get("id") if saved_proto else ""
                })
            except Exception as pe:
                logger.warning(f"[CLOUD FAILOVER] Prototype save error: {pe}")

        # If lead has a GitHub Vault, push deliverables and conversation transcript via GitHub API!
        if lead and lead.get("github_repo_url"):
            gh_url = lead["github_repo_url"]
            m = re.search(r"github\.com[/:]([^/]+/[^/]+?)(?:\.git)?$", gh_url)
            if m:
                repo_full = m.group(1)
                token = os.environ.get("GITHUB_TOKEN", GITHUB_TOKEN)
                if html_content:
                    push_file_to_github(repo_full, "prototypes/index.html", html_content, token, commit_message=f"feat(prototype): cloud AI gateway build [{now_ts}]")
                transcript_md = (
                    f"# Cloud AI Gateway Session: {client_name}\n"
                    f"- **Job ID**: `{job_id}`\n"
                    f"- **Date**: {now_ts}\n"
                    f"- **Engine**: Zero7 Cloud AI Gateway (Failover)\n\n"
                    f"### User Instruction\n> {user_prompt}\n\n"
                    f"### Deliverable Output\n{response_text}\n"
                )
                push_file_to_github(repo_full, f"conversations/{now_ts}_cloud_gateway_{agent_slug}.md", transcript_md, token, commit_message=f"docs(transcript): cloud session log [{now_ts}]")

        # Mark job complete
        completed = Repository.complete_agent_job(
            job_id=job_id,
            status="completed",
            stream_output=response_text,
            thoughts="Executed seamlessly via Zero7 Cloud AI Gateway (Tier-2 failover).",
            conversation_id="cloud_" + job_id,
            artifacts=artifacts
        )
        await agent_broadcaster.broadcast(job_id, {
            "id": job_id,
            "status": "completed",
            "stream_output": response_text,
            "thoughts": "Executed seamlessly via Zero7 Cloud AI Gateway (Tier-2 failover).",
            "conversation_id": "cloud_" + job_id,
            "artifacts": artifacts
        })
        logger.info(f"[CLOUD FAILOVER] Job {job_id} successfully completed via Cloud AI Gateway!")
    except Exception as e:
        logger.error(f"[CLOUD FAILOVER ERROR] {e}")
        Repository.complete_agent_job(
            job_id=job_id,
            status="failed",
            stream_output="",
            thoughts="",
            error_message=f"Cloud AI Gateway error: {str(e)}"
        )
        await agent_broadcaster.broadcast(job_id, {
            "id": job_id,
            "status": "failed",
            "error_message": f"Cloud AI Gateway error: {str(e)}"
        })

async def schedule_job_watchdog(job_id: str, delay_seconds: int = 35):
    """Safety-net watchdog: if job is still pending after delay, trigger Cloud Failover."""
    await asyncio.sleep(delay_seconds)
    job = Repository.get_agent_job(job_id)
    if job and job.get("status") == "pending":
        logger.info(f"[WATCHDOG] Job {job_id} still pending after {delay_seconds}s. Triggering Cloud Failover...")
        await execute_cloud_agent_failover(job_id)

@app.post("/api/leads/{id}/agent/jobs")
def create_lead_agent_job(id: str, data: AgentJobCreate, background_tasks: BackgroundTasks, user: dict = Depends(require_auth)):
    """Create an agent task for a specific lead."""
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Qualification and Call Stage Guardrail:
    # Autonomous prototypes and engineering tasks must NOT trigger automatically for leads who have not been reached!
    call_stage = (lead.get("call_stage") or "uncontacted").lower().strip()
    force = bool(getattr(data, "force", False))
    uncontacted_stages = {"uncontacted", "dnp", "dnpr", "busy", "wrong_number", "not_interested", "lost", "disqualified"}
    if call_stage in uncontacted_stages and not force:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot dispatch agent jobs for uncontacted or DNP leads (Current call stage: '{call_stage}'). The lead must be contacted and qualified before AI projects can be triggered. Pass 'force': true if manual override is intended."
        )

    from backend.integrations.github_vault import format_client_project_name, get_client_project_path
    biz_name = (data.project_name or lead.get("project_name") or format_client_project_name(lead.get("business_name"), lead.get("name"))).strip()
    import re
    client_id = re.sub(r'[^a-zA-Z0-9_-]', '_', biz_name).strip('_') or f"lead_{id[:8]}"
    
    # Determine target conversation_id
    if data.conversation_id is not None:
        target_conv_id = data.conversation_id if data.conversation_id.strip() else None
    else:
        target_conv_id = Repository.get_lead_latest_conversation_id(id)
    
    default_proj_path = get_client_project_path(lead.get("business_name") or biz_name, lead.get("name"))

    # Update lead project_name and project_path if missing or generic
    curr_proj_name = lead.get("project_name") or ""
    if not curr_proj_name or curr_proj_name in ("J", "Client", "Lead", "lead"):
        Repository.update_lead(id, {"project_name": biz_name, "project_path": default_proj_path})
    
    agent_slug = getattr(data, "agent_slug", None) or "prototype_maker"
    agent_def = Repository.get_agent(agent_slug)
    model = data.model
    if not model and agent_def and agent_def.get("model"):
        model = agent_def["model"]

    # Automatically resolve hierarchical @ data pills
    prompt = data.prompt
    try:
        from backend.agents.pill_resolver import DataPillResolver
        prompt = DataPillResolver.resolve(id, prompt)
    except Exception as err:
        print(f"[PILL RESOLVE ERROR] {err}")
    
    # Attach and persist sales rep tactical context if provided
    rep_ctx = getattr(data, "rep_context", None)
    if rep_ctx:
        Repository.save_prototype_rep_context(id, rep_ctx)
    else:
        rep_ctx = Repository.get_prototype_rep_context(id)

    job_data = {
        "lead_id": id,
        "client_id": client_id,
        "project_name": biz_name,
        "project_id": data.project_id or lead.get("project_id"),
        "project_path": data.project_path or lead.get("project_path") or default_proj_path,
        "prompt": prompt,
        "model": model or "flash",
        "role": getattr(data, "role", "engineer") or "engineer",
        "agent_slug": agent_slug,
        "conversation_id": target_conv_id,
        "rep_context": rep_ctx or {}
    }
    job = Repository.create_agent_job(job_data)

    # Check execution target and worker status
    target_exec = getattr(data, "execution_target", "cloud") or "cloud"
    worker_status = Repository.get_worker_status('local_host')

    if target_exec == "local" and worker_status.get("online"):
        # Explicit local execution on paired desktop worker: schedule a 35s watchdog fallback
        background_tasks.add_task(schedule_job_watchdog, job["id"], 35)
    else:
        # Default: Instant Autonomous OmniRoute Engine Execution
        logger.info(f"[ORCHESTRATOR] Dispatching Job {job['id']} immediately via OmniRoute Cloud AI Gateway...")
        background_tasks.add_task(execute_cloud_agent_failover, job["id"])

    return job

@app.get("/api/leads/{id}/agent/jobs")
def get_lead_agent_jobs(id: str, user: dict = Depends(require_auth)):
    """Fetch all agent jobs and thread history for this lead."""
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    jobs = Repository.get_lead_agent_jobs(id)
    return {"jobs": jobs}

@app.get("/api/agent/jobs/{job_id}")
def get_agent_job_status(job_id: str, user: dict = Depends(require_auth)):
    """Get real-time status and output of a specific job."""
    job = Repository.get_agent_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@app.get("/api/agent/runs")
def list_agent_runs(agent_slug: Optional[str] = None, limit: int = 50, user: dict = Depends(require_auth)):
    """List recent agent execution runs across leads."""
    runs = Repository.get_agent_runs(agent_slug=agent_slug, limit=limit) or []
    return runs

@app.get("/api/agents/{slug}/runs")
def list_specific_agent_runs(slug: str, limit: int = 50, user: dict = Depends(require_auth)):
    """List recent execution runs for a specific agent slug."""
    runs = Repository.get_agent_runs(agent_slug=slug, limit=limit) or []
    return runs



base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
static_dir = os.path.join(base_dir, 'static')

@app.get("/variables.css")
def serve_variables():
    p = os.path.join(base_dir, "variables.css")
    if os.path.exists(p):
        return FileResponse(p, media_type="text/css")
    return ""

@app.get("/theme.css")
def serve_theme():
    p = os.path.join(base_dir, "theme.css")
    if os.path.exists(p):
        return FileResponse(p, media_type="text/css")
    return ""

@app.get("/tokens.json")
def serve_tokens():
    p = os.path.join(base_dir, "tokens.json")
    if os.path.exists(p):
        return FileResponse(p, media_type="application/json")
    return {}

# ═════════════════════════════════════════════════════════════════
# AGENT STUDIO, DATA PILLS & HUMAN-IN-THE-LOOP ACTIONS API
# ═════════════════════════════════════════════════════════════════

@app.get("/api/leads/{id}/data-pills")
def get_lead_data_pills(id: str, user: dict = Depends(require_auth)):
    """Returns available dynamic data pills tree for autocomplete."""
    return DataPillResolver.inspect_available_pills_for_lead(id)

@app.post("/api/leads/{id}/preview-prompt")
async def preview_lead_prompt(id: str, request: Request, user: dict = Depends(require_auth)):
    """Resolves all @pills in prompt and returns preview."""
    body = await request.json()
    prompt = body.get("prompt", "")
    return DataPillResolver.resolve_prompt_pills(id, prompt)

@app.post("/api/leads/{id}/vault-files/sync")
async def sync_lead_vault_files(id: str, request: Request, user: dict = Depends(require_auth)):
    """Receives updated file list from local worker or triggers a GitHub rescan."""
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    
    files = body.get("files")
    if files and isinstance(files, list):
        Repository.update_lead_cached_files(id, files)
        return {"status": "success", "source": "worker", "files_count": len(files)}
    
    scanned = DataPillResolver.scan_lead_workspace_files(id)
    return {"status": "success", "source": "scanned", "files_count": len(scanned), "files": scanned}

@app.get("/api/agents")
def list_agents(user: dict = Depends(require_auth)):
    """List all defined agents."""
    return Repository.list_agents()

@app.get("/api/agents/{slug_or_id}")
def get_agent_definition(slug_or_id: str, user: dict = Depends(require_auth)):
    agent = Repository.get_agent(slug_or_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent

@app.post("/api/agents")
async def save_agent_definition(request: Request, user: dict = Depends(require_auth)):
    data = await request.json()
    saved = Repository.save_agent(data)
    return {"status": "success", "agent": saved}

# ── PIPELINE SENTINEL AGENT ENDPOINTS ──

@app.get("/api/agent/sentinel/status")
def get_sentinel_status(user: dict = Depends(require_auth)):
    """Returns real-time telemetry, audit stats, and recent alerts for the Sentinel Agent."""
    from backend.ai.sentinel_agent import sentinel_agent
    return sentinel_agent.get_status()

@app.get("/api/agent/sentinel/aberrations")
def get_sentinel_aberrations(user: dict = Depends(require_auth)):
    """Runs a live audit across all CRM leads and returns detected pipeline aberrations."""
    from backend.ai.sentinel_agent import sentinel_agent
    aberrations = sentinel_agent.audit_all_leads()
    return {
        "status": "success",
        "total_leads_scanned": sentinel_agent.last_audit_summary.get("total_leads_scanned", 0),
        "total_aberrations": len(aberrations),
        "aberrations": aberrations
    }

@app.post("/api/agent/sentinel/run-audit")
async def trigger_sentinel_audit(request: Request, user: dict = Depends(require_auth)):
    """Manually triggers an immediate Sentinel cycle and dispatches nags to the Zero7 group."""
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    batch_limit = int(body.get("batch_limit", 3))
    cooldown_hours = float(body.get("cooldown_hours", 0.0))
    from backend.ai.sentinel_agent import sentinel_agent
    loop = asyncio.get_running_loop()
    report = await loop.run_in_executor(None, sentinel_agent.run_sentinel_cycle, batch_limit, cooldown_hours)
    return report

@app.post("/api/agent/sentinel/trigger-nudge")
async def trigger_sentinel_lead_nudge(request: Request, user: dict = Depends(require_auth)):
    """Triggers an immediate proactive accountability nag for a specific lead to the Zero7 group."""
    body = await request.json()
    lead_id = body.get("lead_id")
    if not lead_id:
        raise HTTPException(status_code=400, detail="lead_id is required")
    from backend.ai.sentinel_agent import sentinel_agent
    aberrations = sentinel_agent.audit_all_leads()
    lead_aberration = next((a for a in aberrations if a.get("lead_id") == lead_id), None)
    if not lead_aberration:
        lead = Repository.get_lead(lead_id)
        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found")
        lead_aberration = {
            "lead_id": lead_id,
            "lead_name": lead.get("name"),
            "business_name": lead.get("business_name") or lead.get("name"),
            "aberration_type": "manual_pipeline_inquiry",
            "severity": "high",
            "idle_hours": 0.0,
            "description": f"Manual pipeline update inquiry for {lead.get('name')}"
        }
    nag_copy = sentinel_agent.generate_nag_copy(lead_aberration)
    res = sentinel_agent.dispatch_nag_to_zero7(lead_aberration, nag_copy)
    return {
        "status": "success",
        "nag_copy": nag_copy,
        "dispatch_result": res
    }

@app.get("/api/skills")
def list_skills(user: dict = Depends(require_auth)):
    return Repository.list_skills()

@app.post("/api/skills")
async def save_skill_definition(request: Request, user: dict = Depends(require_auth)):
    data = await request.json()
    saved = Repository.save_skill(data)
    return {"status": "success", "skill": saved}

@app.delete("/api/skills/{slug}")
def delete_skill_definition(slug: str, user: dict = Depends(require_auth)):
    Repository.delete_skill(slug)
    return {"status": "success", "deleted": slug}

@app.get("/api/data-pills")
def list_custom_data_pills(user: dict = Depends(require_auth)):
    return Repository.list_custom_data_pills()

@app.post("/api/data-pills")
async def save_custom_data_pill(request: Request, user: dict = Depends(require_auth)):
    data = await request.json()
    saved = Repository.save_custom_data_pill(data)
    return {"status": "success", "pill": saved}

@app.delete("/api/data-pills/{id}")
def delete_custom_data_pill(id: str, user: dict = Depends(require_auth)):
    Repository.delete_custom_data_pill(id)
    return {"status": "success", "deleted": id}

@app.get("/api/mcp-servers")
def list_mcp_servers(user: dict = Depends(require_auth)):
    return Repository.list_mcp_servers()

@app.post("/api/mcp-servers")
async def save_mcp_server(request: Request, user: dict = Depends(require_auth)):
    data = await request.json()
    saved = Repository.save_mcp_server(data)
    return {"status": "success", "server": saved}

@app.get("/api/actions")
def list_agent_actions(lead_id: Optional[str] = None, status: Optional[str] = None, user: dict = Depends(require_auth)):
    return Repository.list_actions(lead_id=lead_id, status=status)

@app.post("/api/actions")
async def create_agent_action(request: Request, user: dict = Depends(require_auth)):
    data = await request.json()
    staged = Repository.stage_action(data)
    return {"status": "success", "action": staged}

ACTION_FINAL_STATUSES = {"approved", "rejected"}

def _action_status(action: dict) -> str:
    return str((action or {}).get("status") or "pending").strip().lower()

def _action_already_finalized_response(action: dict, requested_transition: str):
    current_status = _action_status(action)
    return {
        "status": "success",
        "unchanged": True,
        "detail": f"Action is already {current_status}; duplicate {requested_transition} ignored.",
        "action": action,
    }

def _parse_action_payload(action: dict) -> dict:
    payload = (action or {}).get("payload") or {}
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, str):
        raw = payload.strip()
        if not raw:
            return {}
        try:
            decoded = json.loads(raw)
            if isinstance(decoded, dict):
                return decoded
            return {"value": decoded}
        except Exception:
            return {"raw": payload}
    return {"value": payload}

def _execute_approved_action(action: dict) -> str:
    action_type = str(action.get("action_type") or action.get("type") or "generic").strip()
    payload = _parse_action_payload(action)

    if action_type == "send_whatsapp":
        lead_id = action.get("lead_id") or payload.get("lead_id")
        recipient = payload.get("recipient") or payload.get("phone") or payload.get("to")
        msg_text = payload.get("message") or payload.get("text") or payload.get("body")
        if not msg_text or not str(msg_text).strip():
            return "Approved; WhatsApp action had no message text, so no message was queued."
        lead = Repository.get_lead(lead_id) if lead_id else None
        phone = recipient or ((lead or {}).get("phone") if lead else "")
        if not phone:
            return "Approved; WhatsApp action had no recipient phone, so no message was queued."
        Repository.save_outgoing_whatsapp_message("central", phone, str(msg_text).strip(), lead_id=lead_id)
        return f"Message queued and logged for {phone}"

    if action_type == "generate_prototype":
        lead_id = action.get("lead_id") or payload.get("lead_id")
        if not lead_id:
            return "Approved; prototype generation action had no lead_id, so no prototype was deployed."
        from backend.ai.master_orchestrator import master_orchestrator
        proto_res = master_orchestrator.handle_prototype_requested(lead_id)
        if not isinstance(proto_res, dict):
            proto_res = {}
        return f"Prototype deployed: {proto_res.get('live_url', 'Active')}"

    if action_type == "anomaly_alert":
        severity = payload.get("severity") or payload.get("level") or payload.get("priority") or "warning"
        title = payload.get("title") or payload.get("summary") or payload.get("message") or "Anomaly alert"
        lead_id = action.get("lead_id") or payload.get("lead_id")
        lead_suffix = f" (Lead: {lead_id})" if lead_id else ""
        return f"Anomaly alert acknowledged [{severity}]: {title}{lead_suffix}"

    if action_type == "schedule_task":
        title = payload.get("title") or payload.get("task") or payload.get("summary") or "Task"
        due = payload.get("due_at") or payload.get("due") or ""
        return f"Schedule task approved: {title}" + (f" (Due: {due})" if due else "")

    title = payload.get("title") or payload.get("summary") or payload.get("message") or ""
    if title:
        return f"Approved; recorded human authorization for '{action_type}': {title}"
    return f"Approved; recorded human authorization for action type '{action_type}'"

@app.post("/api/actions/{action_id}/approve")
def approve_agent_action(action_id: str, user: dict = Depends(require_auth)):
    action = Repository.get_action(action_id)
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")

    if _action_status(action) in ACTION_FINAL_STATUSES:
        return _action_already_finalized_response(action, "approval")

    reviewer = user.get("name", "founder")

    # Atomic transition: prevents race conditions and double-executions
    transition = Repository.transition_action_status_if_not_final(
        action_id,
        "approved",
        reviewed_by=reviewer,
        result="Approval accepted; executing action...",
        final_statuses=("approved", "rejected"),
    )

    if transition["state"] == "not_found":
        raise HTTPException(status_code=404, detail="Action not found")
    if transition["state"] == "already_finalized":
        return _action_already_finalized_response(transition["action"], "approval")

    claimed_action = transition["action"] or action
    try:
        result_detail = _execute_approved_action(claimed_action)
    except Exception as exc:
        result_detail = f"Approved, but execution encountered error: {type(exc).__name__}: {str(exc)[:300]}"

    updated = Repository.update_action_status(
        action_id,
        "approved",
        reviewed_by=reviewer,
        result=result_detail,
    )
    return {"status": "success", "action": updated, "detail": result_detail}

@app.post("/api/actions/{action_id}/reject")
def reject_agent_action(action_id: str, user: dict = Depends(require_auth)):
    action = Repository.get_action(action_id)
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")

    if _action_status(action) in ACTION_FINAL_STATUSES:
        return _action_already_finalized_response(action, "rejection")

    reviewer = user.get("name", "founder")
    transition = Repository.transition_action_status_if_not_final(
        action_id,
        "rejected",
        reviewed_by=reviewer,
        result=f"Rejected by {reviewer}",
        final_statuses=("approved", "rejected"),
    )

    if transition["state"] == "not_found":
        raise HTTPException(status_code=404, detail="Action not found")
    if transition["state"] == "already_finalized":
        return _action_already_finalized_response(transition["action"], "rejection")

    return {"status": "success", "action": transition["action"], "detail": f"Rejected by {reviewer}"}

# ═════════════════════════════════════════════════════════════════
# MASTER ORCHESTRATOR & COCKPIT ENDPOINTS
# ═════════════════════════════════════════════════════════════════

@app.get("/api/orchestrator/cockpit")
def get_orchestrator_cockpit(user: dict = Depends(require_auth)):
    """Returns real-time pipeline status, pending actions deck, and fleet telemetry for all clients."""
    from backend.ai.master_orchestrator import master_orchestrator
    return master_orchestrator.get_cockpit_overview()

@app.post("/api/leads/{id}/orchestrator/prototype")
async def trigger_orchestrator_prototype(id: str, request: Request, user: dict = Depends(require_auth)):
    """Universal 1-click prototype generator: provisions Supabase schema, deploys to Vercel, binds Hostinger DNS for any client."""
    from backend.ai.master_orchestrator import master_orchestrator
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    prompt = body.get("prompt")
    return master_orchestrator.handle_prototype_requested(id, prompt_override=prompt)

# ── Zoho Mail Integration Endpoints ──
from backend.integrations.zoho_mail import zoho_mail_manager

@app.get("/api/mail/overview")
async def get_mail_overview(force_refresh: bool = False, user: dict = Depends(require_auth)):
    try:
        overview = await zoho_mail_manager.get_account_overview(force_refresh=force_refresh)
        labels = Repository.get_mail_labels()
        user_role = (user.get("role") or "member").lower()
        user_email = (user.get("email") or "").strip().lower()

        # If user is a member/intern, strictly sandbox to their own alias
        if user_role != "admin":
            user_aliases = [a for a in overview.get("aliases", []) if a.get("email", "").lower() == user_email]
            if not user_aliases:
                user_aliases = [{
                    "email": user_email,
                    "displayName": user.get("name") or user_email.split("@")[0].title(),
                    "sendMailId": "",
                    "isPrimary": True,
                    "mode": "alias"
                }]
        else:
            user_aliases = overview.get("aliases", [])

        return {
            "status": "connected",
            "accountId": overview.get("accountId"),
            "primaryEmail": overview.get("primaryEmail"),
            "aliases": user_aliases,
            "folders": overview.get("folders", {}),
            "labels": labels,
            "currentUser": {
                "id": user.get("id"),
                "name": user.get("name"),
                "email": user_email,
                "role": user_role,
            }
        }
    except Exception as e:
        logging.getLogger("uvicorn").error(f"[ZOHO MAIL] Overview error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/mail/messages")
async def get_mail_messages(
    folder: str = "inbox",
    alias: str = "all",
    label: str = "",
    search: str = "",
    page: int = 1,
    limit: int = 12,
    force_refresh: bool = False,
    user: dict = Depends(require_auth),
):
    try:
        user_role = (user.get("role") or "member").lower()
        user_email = (user.get("email") or "").strip().lower()

        # Enforce multi-tenant alias isolation: non-admins are strictly forced to their own email alias
        effective_alias = user_email if user_role != "admin" else alias

        custom_labels_map, local_flags_map = Repository.get_mail_metadata_maps()
        all_labels = Repository.get_mail_labels()
        data = await zoho_mail_manager.list_messages_and_counts(
            folder=folder,
            alias=effective_alias,
            label=label,
            search=search,
            page=page,
            limit=limit,
            custom_labels_map=custom_labels_map,
            local_flags_map=local_flags_map,
            all_labels=all_labels,
            force_refresh=force_refresh,
        )
        return data
    except Exception as e:
        logging.getLogger("uvicorn").error(f"[ZOHO MAIL] List messages error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/mail/messages/{folder_id}/{message_id}")
async def get_mail_thread(
    folder_id: str,
    message_id: str,
    user: dict = Depends(require_auth),
):
    try:
        user_role = (user.get("role") or "member").lower()
        user_email = (user.get("email") or "").strip().lower()

        # Sandbox check: non-admins can only read messages sent to, from, or cc'd to their email
        if user_role != "admin":
            msg = Repository.get_cached_email_by_id(message_id)
            if msg:
                matched = [str(a).lower() for a in (msg.get("matchedAliases") or [])]
                to_addrs = [str(e).lower() for e in (msg.get("toEmails") or [])]
                cc_addrs = [str(e).lower() for e in (msg.get("ccEmails") or [])]
                from_addr = str(msg.get("fromEmail") or "").lower()
                all_involved = set(matched + to_addrs + cc_addrs + [from_addr])
                if user_email not in all_involved:
                    raise HTTPException(status_code=403, detail="Access denied: you do not have permission to view this message")

        Repository.update_mail_metadata([message_id], "read")
        custom_labels_map, local_flags_map = Repository.get_mail_metadata_maps()
        data = await zoho_mail_manager.get_message_and_thread(
            folder_id=folder_id,
            message_id=message_id,
            custom_labels_map=custom_labels_map,
            local_flags_map=local_flags_map,
        )
        data["labels"] = Repository.get_mail_labels()
        return data
    except HTTPException:
        raise
    except Exception as e:
        logging.getLogger("uvicorn").error(f"[ZOHO MAIL] Get thread error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/mail/ImageDisplay")
async def zoho_mail_image_display_fallback(
    request: Request,
    na: Optional[str] = None,
    nmsgId: Optional[str] = None,
    f: Optional[str] = None,
    mode: Optional[str] = None,
    cid: Optional[str] = None,
):
    """
    Direct handler for Zoho Mail's /mail/ImageDisplay URLs inside email HTML bodies.
    No auth required so browser <img> tags load without issue.
    """
    try:
        mid = nmsgId or request.query_params.get("nmsgId") or ""
        clean_cid = (cid or request.query_params.get("cid") or "").strip("&")
        clean_f = (f or request.query_params.get("f") or "").strip("&")
        content, content_type, filename = await zoho_mail_manager.get_inline_image(
            folder_id="",
            message_id=mid,
            cid=clean_cid,
            filename=clean_f,
        )
        return Response(
            content=content,
            media_type=content_type,
            headers={
                "Content-Disposition": f'inline; filename="{filename}"',
                "Cache-Control": "public, max-age=86400",
            },
        )
    except Exception as e:
        logging.getLogger("uvicorn").warning(f"[ZOHO MAIL] ImageDisplay fallback error: {e}")
        transparent_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc`\x00\x00\x00\x02\x00\x01H\xaf\xa4q\x00\x00\x00\x00IEND\xaeB`\x82"
        return Response(content=transparent_png, media_type="image/png")

@app.get("/api/mail/inline-image/{folder_id}/{message_id}")
async def get_mail_inline_image(
    folder_id: str,
    message_id: str,
    cid: Optional[str] = None,
    f: Optional[str] = None,
    att_id: Optional[str] = None,
):
    """Serves inline images referenced by cid or filename inside email bodies."""
    try:
        content, content_type, filename = await zoho_mail_manager.get_inline_image(
            folder_id=folder_id,
            message_id=message_id,
            cid=cid,
            filename=f,
            attachment_id=att_id,
        )
        return Response(
            content=content,
            media_type=content_type,
            headers={
                "Content-Disposition": f'inline; filename="{filename}"',
                "Cache-Control": "public, max-age=86400",
            },
        )
    except Exception as e:
        logging.getLogger("uvicorn").warning(f"[ZOHO MAIL] Inline image error ({message_id}): {e}")
        transparent_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc`\x00\x00\x00\x02\x00\x01H\xaf\xa4q\x00\x00\x00\x00IEND\xaeB`\x82"
        return Response(content=transparent_png, media_type="image/png")

@app.get("/api/mail/attachments/{folder_id}/{message_id}/{attachment_id}")
async def download_mail_attachment(
    request: Request,
    folder_id: str,
    message_id: str,
    attachment_id: str,
    name: Optional[str] = None,
    download: Optional[str] = None,
    token: Optional[str] = None,
):
    """
    Downloads or previews attachment.
    Defaults to inline disposition so PDFs, images, and text render directly in browser dialogs!
    Pass ?download=1 to force a download.
    """
    try:
        from backend.auth import decode_token
        auth_header = request.headers.get("Authorization") or ""
        raw_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else "")
        if raw_token:
            decoded = decode_token(raw_token)
            if decoded and decoded.get("role") != "admin":
                user_email = (decoded.get("email") or "").lower()
                msg = Repository.get_cached_email_by_id(message_id)
                if msg and user_email:
                    matched = [str(a).lower() for a in (msg.get("matchedAliases") or [])]
                    to_addrs = [str(e).lower() for e in (msg.get("toEmails") or [])]
                    cc_addrs = [str(e).lower() for e in (msg.get("ccEmails") or [])]
                    from_addr = str(msg.get("fromEmail") or "").lower()
                    if user_email not in matched and user_email not in to_addrs and user_email not in cc_addrs and user_email != from_addr:
                        raise HTTPException(status_code=403, detail="Access denied to attachment")

        content, content_type, filename = await zoho_mail_manager.download_attachment(folder_id, message_id, attachment_id)
        final_name = name or filename
        disposition = "attachment" if download in ("1", "true", "yes") else "inline"
        return Response(
            content=content,
            media_type=content_type,
            headers={
                "Content-Disposition": f'{disposition}; filename="{final_name}"',
                "Cache-Control": "public, max-age=86400",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logging.getLogger("uvicorn").error(f"[ZOHO MAIL] Attachment download error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/mail/send")
async def send_mail_endpoint(
    request: Request,
    user: dict = Depends(require_auth),
):
    """
    Sends email via Zoho Mail. Supports both multipart/form-data (with file uploads)
    and JSON payloads.
    """
    try:
        content_type = request.headers.get("content-type", "")
        raw_files = []
        if "multipart/form-data" in content_type:
            form = await request.form()
            from_address = str(form.get("fromAddress") or "admin@zero7.space")
            to_address = str(form.get("toAddress") or "")
            cc_address = str(form.get("ccAddress") or "")
            bcc_address = str(form.get("bccAddress") or "")
            subject = str(form.get("subject") or "(No Subject)")
            content = str(form.get("content") or "")
            in_reply_to = str(form.get("inReplyTo") or "")
            action = str(form.get("action") or "")

            # Extract uploaded files
            for upload_file in form.getlist("files"):
                if hasattr(upload_file, "filename") and upload_file.filename:
                    fbytes = await upload_file.read()
                    if fbytes:
                        raw_files.append((upload_file.filename, fbytes, upload_file.content_type or "application/octet-stream"))
        else:
            body = await request.json()
            from_address = body.get("fromAddress") or "admin@zero7.space"
            to_address = body.get("toAddress") or ""
            cc_address = body.get("ccAddress") or ""
            bcc_address = body.get("bccAddress") or ""
            subject = body.get("subject") or "(No Subject)"
            content = body.get("content") or ""
            in_reply_to = body.get("inReplyTo") or ""
            action = body.get("action") or ""
            for item in (body.get("files") or []):
                if item.get("data") and item.get("filename"):
                    import base64
                    raw_data = base64.b64decode(item["data"])
                    raw_files.append((item["filename"], raw_data, item.get("type", "application/octet-stream")))

        if not to_address.strip():
            raise HTTPException(status_code=400, detail="Recipient (To) email address is required")

        user_role = (user.get("role") or "member").lower()
        user_email = (user.get("email") or "").strip().lower()

        # Strict Sandboxing: Non-admins can only send as their own assigned alias
        if user_role != "admin":
            from_address = user_email

        res = await zoho_mail_manager.send_mail(
            from_address=from_address,
            to_address=to_address,
            subject=subject,
            content=content,
            cc_address=cc_address,
            bcc_address=bcc_address,
            in_reply_to=in_reply_to,
            action=action,
            raw_files=raw_files if raw_files else None,
        )
        return {"status": "sent", "data": res.get("data", {})}
    except HTTPException:
        raise
    except Exception as e:
        logging.getLogger("uvicorn").error(f"[ZOHO MAIL] Send error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/mail/messages/action")
async def mail_messages_action(request: Request, user: dict = Depends(require_auth)):
    try:
        body = await request.json()
        message_ids = [str(m) for m in (body.get("messageIds") or []) if m]
        action = (body.get("action") or "").strip().lower()
        label_id = body.get("labelId")

        if not message_ids or not action:
            raise HTTPException(status_code=400, detail="messageIds and action are required")

        user_role = (user.get("role") or "member").lower()
        user_email = (user.get("email") or "").strip().lower()

        # Sandbox check: ensure user has rights to modify these messages
        if user_role != "admin":
            for mid in message_ids:
                msg = Repository.get_cached_email_by_id(mid)
                if msg:
                    matched = [str(a).lower() for a in (msg.get("matchedAliases") or [])]
                    to_addrs = [str(e).lower() for e in (msg.get("toEmails") or [])]
                    cc_addrs = [str(e).lower() for e in (msg.get("ccEmails") or [])]
                    from_addr = str(msg.get("fromEmail") or "").lower()
                    if user_email not in matched and user_email not in to_addrs and user_email not in cc_addrs and user_email != from_addr:
                        raise HTTPException(status_code=403, detail=f"Access denied: cannot perform action on message {mid}")

        expanded_ids = Repository.expand_thread_message_ids(message_ids)
        Repository.update_mail_metadata(expanded_ids, action, label_id=label_id)
        if action != "assign_label":
            await zoho_mail_manager.perform_message_action(expanded_ids, action)
        return {"status": "success", "updated": len(expanded_ids), "action": action}
    except HTTPException:
        raise
    except Exception as e:
        logging.getLogger("uvicorn").error(f"[ZOHO MAIL] Action error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/mail/labels")
async def create_mail_label_endpoint(request: Request, user: dict = Depends(require_auth)):
    try:
        body = await request.json()
        name = (body.get("name") or "").strip()
        color = (body.get("color") or "#4880ff").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Label name is required")
        lbl = Repository.create_mail_label(name, color)
        return {"status": "success", "label": lbl, "labels": Repository.get_mail_labels()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class NoCacheStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

app.mount("/static", NoCacheStaticFiles(directory=static_dir), name="static")

@app.get("/mail")
@app.get("/mail/{full_path:path}")
def serve_mail_portal(full_path: str = ""):
    mail_index = os.path.join(static_dir, "mail", "index.html")
    if os.path.exists(mail_index):
        resp = FileResponse(mail_index)
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp
    raise HTTPException(status_code=404, detail="Mail app not found")

@app.get("/")
def serve_index(request: Request):
    host = (request.headers.get("host") or "").split(":")[0].lower().strip()
    
    # 1. Dedicated Webmail Domain Routing (mail.zero7.space)
    if host == "mail.zero7.space":
        mail_index = os.path.join(static_dir, "mail", "index.html")
        if os.path.exists(mail_index):
            resp = FileResponse(mail_index)
            resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
            resp.headers["Pragma"] = "no-cache"
            resp.headers["Expires"] = "0"
            return resp

    # 2. Check if this is a custom client subdomain (e.g. burosys.zero7.space or demo.client.com)
    # Exclude the primary CRM control center domain, localhost, and droplet IP
    if host and host not in ("cos.zero7.space", "localhost", "127.0.0.1", "68.183.92.215"):
        lead = Repository.get_lead_by_subdomain_or_slug(host)
        if lead:
            protos = Repository.get_lead_prototypes(lead["id"])
            if protos and len(protos) > 0:
                return serve_public_prototype_shell(protos[0]["share_token"])
            else:
                biz = lead.get("business_name") or lead.get("name") or "Client"
                splash_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{biz} — Concept Prototype Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-white min-h-screen flex items-center justify-center p-6 font-sans">
  <div class="max-w-md w-full bg-slate-800/90 border border-slate-700 p-8 rounded-2xl text-center shadow-2xl">
    <div class="w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold text-lg mx-auto mb-4">Z7</div>
    <h2 class="text-xl font-bold tracking-tight mb-2">{biz}</h2>
    <p class="text-sm text-slate-400 mb-6">An interactive AI solution prototype is currently being prepared for this client portal.</p>
    <div class="inline-flex items-center gap-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs px-3 py-1.5 rounded-full font-medium">
      <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
      <span>Subdomain Routing Active ({host})</span>
    </div>
  </div>
 </body>
</html>"""
                return HTMLResponse(content=splash_html, status_code=200)

    resp = FileResponse(os.path.join(static_dir, "index.html"))
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp
