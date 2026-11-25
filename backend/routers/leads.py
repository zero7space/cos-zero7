"""
COS Theta — Leads Domain Router
Manages lead lifecycle, CRM records, conversion to deals, activities, and attribution.
"""

import logging
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from backend.models import LeadCreate, LeadUpdate, ActivityCreate, LeadAttributionCreate, NoteCreate
from backend.database import Repository
from backend.auth import require_auth, require_admin
from backend.integrations.github_vault import provision_client_vault, sync_lead_brief_to_vault

logger = logging.getLogger(__name__)
router = APIRouter(tags=["leads"])


def _dump_model(model_obj):
    """Pydantic v2 model_dump with v1 fallback."""
    if hasattr(model_obj, "model_dump"):
        return model_obj.model_dump(exclude_unset=True)
    return model_obj.dict(exclude_unset=True)


@router.get("/api/leads")
def list_leads(
    status: Optional[str] = None,
    source: Optional[str] = None,
    assigned_to: Optional[str] = None,
    user: dict = Depends(require_auth),
):
    filters = {}
    if status:
        filters["status"] = status
    if source:
        filters["source"] = source

    if user.get("role") == "member":
        filters["assigned_to"] = user.get("user_id")
    else:
        if assigned_to:
            filters["assigned_to"] = assigned_to

    return Repository.list_leads(filters)


@router.post("/api/leads")
def create_lead(data: LeadCreate, user: dict = Depends(require_auth)):
    return Repository.create_lead(_dump_model(data))


@router.get("/api/leads/phones")
def get_lead_phones(user: dict = Depends(require_auth)):
    """Return all CRM lead phone numbers mapped to lead IDs. Used by the desktop sync agent."""
    return Repository.get_all_lead_phones()


@router.get("/api/leads/{id}")
def get_lead(id: str, user: dict = Depends(require_auth)):
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if user.get("role") == "member" and lead["assigned_to"] != user.get("user_id"):
        raise HTTPException(status_code=403, detail="Forbidden")

    lead_dict = dict(lead)
    try:
        lead_dict["activity"] = Repository.get_lead_activity(id)
    except Exception as e:
        logger.error(f"Error fetching lead activity for {id}: {e}")
        calls = Repository.get_lead_calls(id) or []
        notes = Repository.get_lead_notes(id) or []
        acts = []
        for n in notes:
            acts.append({"type": "note", "id": n.get("id"), "title": n.get("content"), "notes": n.get("content"), "created_at": n.get("created_at")})
        for c in calls:
            acts.append({"type": "call", "id": c.get("id"), "notes": c.get("notes"), "outcome": c.get("outcome"), "duration_minutes": c.get("duration_minutes"), "recording_drive_url": c.get("recording_drive_url"), "created_at": c.get("called_at")})
        lead_dict["activity"] = acts
    return lead_dict


VAULT_SYNC_FIELDS = {
    "name", "business_name", "city", "assigned_to", "priority", "status",
    "call_stage", "last_update_notes", "deal_value", "phone", "email",
    "website", "demo_video_url", "next_action",
}


@router.put("/api/leads/{id}")
def update_lead(
    id: str,
    data: LeadUpdate,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_auth),
):
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if user.get("role") == "member" and lead["assigned_to"] != user.get("user_id"):
        raise HTTPException(status_code=403, detail="Forbidden")

    update_data = _dump_model(data)
    if user.get("role") == "member" and "assigned_to" in update_data:
        req_owner = update_data["assigned_to"] or None
        if req_owner != (lead.get("assigned_to") or None):
            raise HTTPException(status_code=403, detail="Only admins can reassign lead owners")
    if "assigned_to" in update_data and update_data["assigned_to"]:
        if not Repository.get_user(update_data["assigned_to"]):
            raise HTTPException(status_code=400, detail="Assigned consultant not found")

    try:
        updated_lead = Repository.update_lead(id, update_data, mark_crm_locks=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Check if lead stage newly moved to 'qualified'
    new_stage = (data.call_stage or data.status or "").lower()
    old_stage = (lead.get("call_stage") or lead.get("status") or "").lower()
    if "qualif" in new_stage and "qualif" not in old_stage:
        if not lead.get("github_repo_url") and not lead.get("project_path"):
            background_tasks.add_task(provision_client_vault, id)
    elif (set(update_data.keys()) & VAULT_SYNC_FIELDS) and (
        lead.get("github_repo_url") or updated_lead.get("github_repo_url") or lead.get("project_path")
    ):
        background_tasks.add_task(sync_lead_brief_to_vault, id)

    return updated_lead


@router.delete("/api/leads/{id}")
def delete_lead(id: str, user: dict = Depends(require_admin)):
    try:
        from backend.integrations.dns_provisioner import dns_provisioner
        dns_provisioner.deprovision_subdomain(id)
    except Exception as e:
        logger.warning(f"Could not auto-deprovision subdomain for lead {id}: {e}")
    Repository.delete_lead(id)
    return {"status": "success"}


@router.post("/api/leads/{id}/convert")
def convert_lead(id: str, user: dict = Depends(require_auth)):
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    deal_title = lead.get("business_name") or lead.get("name") or "Client Project"

    demo_url = lead.get("prototype_url") or lead.get("demo_video_url") or ""
    sub = lead.get("subdomain")
    prod_url = f"https://{sub}" if sub else ""

    deal = Repository.create_deal({
        "lead_id": id,
        "title": deal_title,
        "value": lead.get("deal_value") or 0.0,
        "stage": "won",
        "delivery_stage": "in_development",
        "amount_received": 0.0,
        "payment_status": "pending",
        "demo_url": demo_url,
        "production_url": prod_url,
        "city": lead.get("city") or "",
        "assigned_to": lead.get("assigned_to") or user.get("user_id"),
        "notes": f"Converted from lead: {lead.get('name')} ({lead.get('email') or 'No email'}) - {lead.get('city') or ''}",
    })
    Repository.update_lead(id, {"status": "won"})
    return deal


@router.get("/api/leads/{id}/activities")
def get_lead_activities_endpoint(id: str, limit: int = 50, user: dict = Depends(require_auth)):
    return {"activities": Repository.get_lead_activities(id, limit=limit)}


@router.post("/api/leads/{id}/activities")
async def create_lead_activity_endpoint(
    id: str,
    request: Request,
    user: dict = Depends(require_auth),
):
    body = await request.json()
    act_type = body.get("activity_type", "").upper()
    notes = body.get("notes", "") or body.get("content", "")
    outcome = body.get("outcome", "Connected")
    title = body.get("title", "Activity Logged")

    if act_type == "CALL":
        return Repository.log_call({
            "lead_id": id,
            "user_id": user.get("user_id"),
            "outcome": outcome,
            "notes": notes,
            "duration_minutes": body.get("duration_minutes", 5),
        })
    elif act_type == "NOTE":
        return Repository.add_note({
            "lead_id": id,
            "user_id": user.get("user_id"),
            "content": notes,
        })
    else:
        return Repository.log_activity(
            lead_id=id,
            activity_type=body.get("activity_type", "note"),
            title=title,
            content=notes,
            deal_id=body.get("deal_id"),
            actor_id=user.get("user_id"),
            metadata=body.get("metadata"),
        )


@router.get("/api/leads/{id}/activity")
def get_activity(id: str, user: dict = Depends(require_auth)):
    return Repository.get_lead_activity(id)


@router.get("/api/leads/{id}/attribution")
def get_lead_attribution_endpoint(id: str, user: dict = Depends(require_auth)):
    attr = Repository.get_lead_attribution(id)
    if not attr:
        lead = Repository.get_lead(id)
        if lead and lead.get("channel_data"):
            return {"attribution": lead["channel_data"]}
        return {"attribution": None}
    return {"attribution": attr}


@router.post("/api/leads/{id}/attribution")
def save_lead_attribution_endpoint(
    id: str, data: LeadAttributionCreate, user: dict = Depends(require_auth)
):
    saved = Repository.save_lead_attribution(id, _dump_model(data))
    return {"attribution": saved}


@router.post("/api/leads/{id}/notes")
def add_note(id: str, data: NoteCreate, user: dict = Depends(require_auth)):
    lead = Repository.get_lead(id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if user.get("role") == "member" and lead["assigned_to"] != user.get("user_id"):
        raise HTTPException(status_code=403, detail="Forbidden")
    d = _dump_model(data)
    d["lead_id"] = id
    d["user_id"] = user.get("user_id")
    return Repository.add_note(d)


@router.post("/api/leads/import-csv")
async def import_csv_leads(request: Request, user: dict = Depends(require_auth)):
    try:
        body = await request.json()
        leads_data = body.get("leads", [])
        if not leads_data:
            raise HTTPException(status_code=400, detail="No leads provided in payload")
        created = []
        for item in leads_data:
            scraping_data = item.get("channel_data") or {}
            for k in [
                "website", "linkedin_url", "linkedin", "industry",
                "employee_count", "employees", "rating", "reviews",
                "query", "scraped_query", "batch",
            ]:
                if k in item and item[k]:
                    clean_k = (
                        "linkedin_url" if k == "linkedin"
                        else ("employee_count" if k == "employees"
                        else ("scraped_query" if k == "query" else k))
                    )
                    scraping_data[clean_k] = item[k]

            lead_dict = {
                "name": item.get("name") or "Scraped Lead",
                "business_name": item.get("business_name") or item.get("company", ""),
                "phone": item.get("phone", ""),
                "email": item.get("email", ""),
                "city": item.get("city", ""),
                "temperature": item.get("temperature", "warm"),
                "call_stage": item.get("call_stage", "first_call"),
                "source": "scraping",
                "status": "new",
                "priority": item.get("priority", "medium"),
                "deal_value": float(item.get("deal_value", 0)) if item.get("deal_value") else None,
                "assigned_to": item.get("assigned_to") or user.get("user_id"),
                "last_update_notes": item.get("notes") or "Imported from B2B scraping list",
                "channel_data": scraping_data if scraping_data else None,
            }
            created.append(Repository.create_lead(lead_dict))
        return {"status": "success", "imported": len(created), "leads": created}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Import failed: {str(e)}")
