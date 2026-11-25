"""
COS Theta — Evidence-Based Fact Service
Verifies and gates data extracted by AI agents, WhatsApp listeners, and call transcripts
before modifying live customer records, preventing hallucinations and data corruption.
"""

from typing import Any, Dict, List, Optional
from backend.repositories.facts import FactsRepository
from backend.repositories.activities import ActivityRepository
from backend.repositories.base import BaseRepository


class FactService:
    @staticmethod
    def propose_lead_fact(
        lead_id: str,
        field_name: str,
        proposed_value: Any,
        source: str,
        quote_evidence: str = "",
        confidence: float = 1.0,
        auto_apply_if_empty: bool = True,
    ) -> Dict[str, Any]:
        """
        Proposes a new fact observed from an AI agent or communication channel.
        If the lead's field is currently blank and auto_apply_if_empty is True,
        the fact is automatically applied and an audit activity is recorded.
        If the field already contains user data, the fact is held in 'pending' for review.
        """
        # Fetch current lead data to inspect existing value
        lead = BaseRepository._execute(
            "SELECT * FROM leads WHERE id = ?",
            (lead_id,),
            fetchone=True,
        )
        if not lead:
            raise ValueError(f"Lead with id {lead_id} not found.")

        current_val = lead.get(field_name)
        proposed_str = str(proposed_value).strip() if proposed_value is not None else ""
        current_str = str(current_val).strip() if current_val is not None else ""

        # Avoid redundant facts if the value is already identical
        if proposed_str == current_str:
            return {
                "status": "unchanged",
                "lead_id": lead_id,
                "field_name": field_name,
                "current_value": current_str,
                "proposed_value": proposed_str,
            }

        # Record fact in evidence ledger
        fact_payload = {
            "lead_id": lead_id,
            "field_name": field_name,
            "proposed_value": proposed_str,
            "current_value": current_str,
            "source": source,
            "quote_evidence": quote_evidence,
            "confidence": confidence,
            "status": "pending",
        }
        fact = FactsRepository.create_fact(fact_payload)

        # Decide whether to auto-apply or hold for human verification
        is_field_blank = not current_str or current_str.lower() in ("none", "null", "unexplored", "pending")
        if auto_apply_if_empty and is_field_blank and confidence >= 0.7:
            applied_fact = FactsRepository.apply_fact(fact["id"], applied_by=f"auto_{source}")
            ActivityRepository.create_activity(
                lead_id=lead_id,
                activity_type="fact_applied",
                title=f"Auto-updated {field_name}",
                content=f"Extracted '{proposed_str}' from {source} (confidence: {confidence:.0%})",
                actor_id=f"agent_{source}",
                metadata={"fact_id": fact["id"], "source": source, "evidence": quote_evidence},
            )
            return applied_fact or fact

        # Otherwise hold for human review and log activity
        ActivityRepository.create_activity(
            lead_id=lead_id,
            activity_type="fact_proposed",
            title=f"Proposed update to {field_name}",
            content=f"Proposed '{proposed_str}' (current: '{current_str}') from {source}",
            actor_id=f"agent_{source}",
            metadata={"fact_id": fact["id"], "source": source, "evidence": quote_evidence},
        )
        return fact

    @staticmethod
    def review_fact(fact_id: str, action: str, user_id: str = "admin") -> Optional[Dict[str, Any]]:
        """
        Human review of a proposed fact: applies or rejects it.
        """
        fact = FactsRepository.get_fact(fact_id)
        if not fact:
            return None

        if action == "apply":
            res = FactsRepository.apply_fact(fact_id, applied_by=user_id)
            ActivityRepository.create_activity(
                lead_id=fact["lead_id"],
                activity_type="fact_approved",
                title=f"Approved {fact['field_name']} update",
                content=f"Updated to '{fact['proposed_value']}'",
                actor_id=user_id,
                metadata={"fact_id": fact_id},
            )
            return res
        elif action == "reject":
            res = FactsRepository.reject_fact(fact_id, rejected_by=user_id)
            ActivityRepository.create_activity(
                lead_id=fact["lead_id"],
                activity_type="fact_rejected",
                title=f"Rejected {fact['field_name']} proposal",
                content=f"Kept current value '{fact['current_value']}'",
                actor_id=user_id,
                metadata={"fact_id": fact_id},
            )
            return res
        else:
            raise ValueError(f"Invalid review action: '{action}'. Must be 'apply' or 'reject'.")

    @staticmethod
    def get_lead_facts(lead_id: str, status: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieves facts for a lead."""
        return FactsRepository.get_facts_by_lead(lead_id, status=status)
