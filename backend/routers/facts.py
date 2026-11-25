"""
COS Theta — Evidence-Based Fact Ledger Router
Provides API endpoints for querying, proposing, and human-reviewing customer facts.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from backend.services.fact_service import FactService
from backend.auth import require_auth

router = APIRouter(tags=["facts"])


class ProposeFactRequest(BaseModel):
    field_name: str
    proposed_value: str
    source: str = "manual"
    quote_evidence: str = ""
    confidence: float = 1.0
    auto_apply_if_empty: bool = True


class ReviewFactRequest(BaseModel):
    action: str  # "apply" or "reject"


@router.get("/api/leads/{id}/facts")
def get_lead_facts(id: str, status: Optional[str] = None, user: dict = Depends(require_auth)):
    return {"facts": FactService.get_lead_facts(id, status=status)}


@router.post("/api/leads/{id}/facts")
def propose_lead_fact(id: str, data: ProposeFactRequest, user: dict = Depends(require_auth)):
    try:
        fact = FactService.propose_lead_fact(
            lead_id=id,
            field_name=data.field_name,
            proposed_value=data.proposed_value,
            source=data.source or user.get("user_id", "user"),
            quote_evidence=data.quote_evidence,
            confidence=data.confidence,
            auto_apply_if_empty=data.auto_apply_if_empty,
        )
        return fact
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/facts/{fact_id}/review")
def review_lead_fact(fact_id: str, data: ReviewFactRequest, user: dict = Depends(require_auth)):
    try:
        fact = FactService.review_fact(
            fact_id=fact_id,
            action=data.action,
            user_id=user.get("user_id", "admin"),
        )
        if not fact:
            raise HTTPException(status_code=404, detail="Fact not found")
        return fact
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
