"""
COS Theta — Lead Facts Repository
Evidence-based ledger repository providing audit trails, confidence scoring,
and safe application of AI/webhook observations to customer records.
"""

import uuid
from typing import Any, Dict, List, Optional
from backend.repositories.base import BaseRepository


class FactsRepository(BaseRepository):
    @classmethod
    def create_fact(cls, fact_data: Dict[str, Any]) -> Dict[str, Any]:
        """Creates a proposed fact in the evidence ledger."""
        fact_id = fact_data.get("id") or f"fact_{uuid.uuid4().hex[:12]}"
        now = cls.now()

        cls._execute(
            """
            INSERT INTO lead_facts (
                id, lead_id, field_name, proposed_value, current_value,
                source, quote_evidence, confidence, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                fact_id,
                fact_data["lead_id"],
                fact_data["field_name"],
                str(fact_data.get("proposed_value", "")),
                str(fact_data.get("current_value", "")),
                fact_data.get("source", "system"),
                fact_data.get("quote_evidence", ""),
                float(fact_data.get("confidence", 1.0)),
                fact_data.get("status", "pending"),
                now,
            ),
            commit=True,
        )
        return cls.get_fact(fact_id) or {}

    @classmethod
    def get_fact(cls, fact_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves a single fact entry by ID."""
        return cls._execute(
            "SELECT * FROM lead_facts WHERE id = ?",
            (fact_id,),
            fetchone=True,
        )

    @classmethod
    def get_facts_by_lead(cls, lead_id: str, status: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns all proposed/applied facts for a given lead, sorted newest first."""
        if status:
            return cls._execute(
                "SELECT * FROM lead_facts WHERE lead_id = ? AND status = ? ORDER BY created_at DESC",
                (lead_id, status),
                fetchall=True,
            )
        return cls._execute(
            "SELECT * FROM lead_facts WHERE lead_id = ? ORDER BY created_at DESC",
            (lead_id,),
            fetchall=True,
        )

    @classmethod
    def apply_fact(cls, fact_id: str, applied_by: str = "system") -> Optional[Dict[str, Any]]:
        """
        Applies a proposed fact to the live lead record and records the audit trail.
        """
        fact = cls.get_fact(fact_id)
        if not fact:
            return None

        lead_id = fact["lead_id"]
        field_name = fact["field_name"]
        proposed_value = fact["proposed_value"]
        now = cls.now()

        # Whitelist allowed lead fields to prevent arbitrary SQL column injection
        allowed_fields = {
            "name", "business_name", "phone", "email", "website", "city",
            "temperature", "call_stage", "source", "status", "pipeline_stage",
            "priority", "deal_value", "next_action", "next_action_date",
            "project_name", "subdomain", "notes"
        }
        if field_name not in allowed_fields:
            raise ValueError(f"Field '{field_name}' is not an authorized lead field for automatic fact application.")

        # Update the live lead record
        cls._execute(
            f"UPDATE leads SET {field_name} = ?, updated_at = ? WHERE id = ?",
            (proposed_value, now, lead_id),
            commit=True,
        )

        # Mark the fact as applied
        cls._execute(
            "UPDATE lead_facts SET status = 'applied', applied_at = ?, applied_by = ? WHERE id = ?",
            (now, applied_by, fact_id),
            commit=True,
        )

        return cls.get_fact(fact_id)

    @classmethod
    def reject_fact(cls, fact_id: str, rejected_by: str = "system") -> Optional[Dict[str, Any]]:
        """Rejects a proposed fact, preventing it from overwriting client records."""
        now = cls.now()
        cls._execute(
            "UPDATE lead_facts SET status = 'rejected', applied_at = ?, applied_by = ? WHERE id = ?",
            (now, rejected_by, fact_id),
            commit=True,
        )
        return cls.get_fact(fact_id)
