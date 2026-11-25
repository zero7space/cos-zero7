from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from backend.auth import require_auth
from backend.database import Repository
from backend.models import (
    DealCreate,
    DealUpdate,
    DealMilestoneCreate,
    DealMilestoneUpdate,
    DealPaymentCreate,
    DealDeliverableCreate,
    DealDeliverableUpdate,
    DealEnvironmentCreate,
)

router = APIRouter(tags=["deals"])


def _dump_model(model_obj):
    """Pydantic v2 model_dump with v1 fallback."""
    if hasattr(model_obj, "model_dump"):
        return model_obj.model_dump(exclude_unset=True)
    return model_obj.dict(exclude_unset=True)


@router.get("/api/deals")
def list_deals(
    stage: Optional[str] = None,
    delivery_stage: Optional[str] = None,
    payment_status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    user: dict = Depends(require_auth),
):
    filters = {}
    if stage:
        filters['stage'] = stage
    if delivery_stage:
        filters['delivery_stage'] = delivery_stage
    if payment_status:
        filters['payment_status'] = payment_status
    if assigned_to:
        filters['assigned_to'] = assigned_to
    return Repository.list_deals(filters)


@router.get("/api/deals/{id}")
def get_deal(id: str, user: dict = Depends(require_auth)):
    deal = Repository.get_deal(id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    return deal


@router.post("/api/deals")
def create_deal(data: DealCreate, user: dict = Depends(require_auth)):
    d = _dump_model(data)
    if not d.get('assigned_to'):
        d['assigned_to'] = user.get('user_id')
    return Repository.create_deal(d)


@router.put("/api/deals/{id}")
def update_deal(id: str, data: DealUpdate, user: dict = Depends(require_auth)):
    return Repository.update_deal(id, _dump_model(data))


@router.delete("/api/deals/{id}")
def delete_deal(id: str, user: dict = Depends(require_auth)):
    res = Repository.delete_deal(id)
    if not res:
        raise HTTPException(status_code=404, detail="Deal not found")
    return res


@router.post("/api/deals/{id}/revert")
def revert_deal(id: str, user: dict = Depends(require_auth)):
    res = Repository.delete_deal(id)
    if not res:
        raise HTTPException(status_code=404, detail="Deal not found")
    return {"status": "success", "message": "Deal reverted back to lead successfully", "lead_id": res.get("lead_id")}


@router.post("/api/deals/{id}/deliverables")
async def update_deal_deliverables(id: str, request: Request, user: dict = Depends(require_auth)):
    deal = Repository.get_deal(id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    data = await request.json()
    deliverables = data.get('deliverables', [])
    return Repository.update_deal(id, {"deliverables": deliverables})


@router.post("/api/deals/{id}/milestones")
async def update_deal_milestones(id: str, request: Request, user: dict = Depends(require_auth)):
    deal = Repository.get_deal(id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    data = await request.json()
    update_data = {}
    if 'payment_milestones' in data:
        update_data["payment_milestones"] = data['payment_milestones']
    if 'amount_received' in data:
        update_data["amount_received"] = float(data['amount_received'])
    if 'payment_status' in data:
        update_data["payment_status"] = data['payment_status']
    return Repository.update_deal(id, update_data)


@router.get("/api/deals/{id}/milestones")
def list_deal_milestones_endpoint(id: str, user: dict = Depends(require_auth)):
    return {"milestones": Repository.list_deal_milestones(id)}


@router.post("/api/deals/{id}/milestones/items")
def create_deal_milestone_endpoint(id: str, data: DealMilestoneCreate, user: dict = Depends(require_auth)):
    d = _dump_model(data)
    d['deal_id'] = id
    return Repository.create_deal_milestone(d)


@router.put("/api/deals/milestones/{mls_id}")
def update_deal_milestone_endpoint(mls_id: str, data: DealMilestoneUpdate, user: dict = Depends(require_auth)):
    updated = Repository.update_deal_milestone(mls_id, _dump_model(data))
    if not updated:
        raise HTTPException(status_code=404, detail="Milestone not found")
    return updated


@router.delete("/api/deals/milestones/{mls_id}")
def delete_deal_milestone_endpoint(mls_id: str, user: dict = Depends(require_auth)):
    ok = Repository.delete_deal_milestone(mls_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Milestone not found")
    return {"status": "success"}


@router.get("/api/deals/{id}/payments")
def list_deal_payments_endpoint(id: str, user: dict = Depends(require_auth)):
    return {"payments": Repository.list_deal_payments(id)}


@router.post("/api/deals/{id}/payments")
def record_deal_payment_endpoint(id: str, data: DealPaymentCreate, user: dict = Depends(require_auth)):
    d = _dump_model(data)
    d['deal_id'] = id
    d['recorded_by'] = user.get('user_id')
    return Repository.record_deal_payment(d)


@router.get("/api/deals/{id}/deliverables")
def list_deal_deliverables_endpoint(id: str, user: dict = Depends(require_auth)):
    return {"deliverables": Repository.list_deal_deliverables(id)}


@router.post("/api/deals/{id}/deliverables/items")
def create_deal_deliverable_endpoint(id: str, data: DealDeliverableCreate, user: dict = Depends(require_auth)):
    d = _dump_model(data)
    d['deal_id'] = id
    return Repository.create_deal_deliverable(d)


@router.put("/api/deals/deliverables/{del_id}")
def update_deal_deliverable_endpoint(del_id: str, data: DealDeliverableUpdate, user: dict = Depends(require_auth)):
    updated = Repository.update_deal_deliverable(del_id, _dump_model(data))
    if not updated:
        raise HTTPException(status_code=404, detail="Deliverable not found")
    return updated


@router.delete("/api/deals/deliverables/{del_id}")
def delete_deal_deliverable_endpoint(del_id: str, user: dict = Depends(require_auth)):
    ok = Repository.delete_deal_deliverable(del_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Deliverable not found")
    return {"status": "success"}


@router.get("/api/deals/{id}/environments")
def list_deal_environments_endpoint(id: str, user: dict = Depends(require_auth)):
    return {"environments": Repository.list_deal_environments(id)}


@router.post("/api/deals/{id}/environments")
def set_deal_environment_endpoint(id: str, data: DealEnvironmentCreate, user: dict = Depends(require_auth)):
    d = _dump_model(data)
    return Repository.set_deal_environment(
        deal_id=id,
        env_type=d.get('env_type', 'github'),
        label=d.get('label', 'Link'),
        url=d.get('url', ''),
        is_primary=d.get('is_primary', 0),
    )
