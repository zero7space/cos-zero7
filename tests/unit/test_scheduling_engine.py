import pytest
from backend.services.scheduling_engine import SchedulingEngine

def test_scale_extraction_enterprise():
    lead = {
        "id": "test_1",
        "name": "Abhishek Kedia",
        "business_name": "Garment Manufacturing Unit",
        "channel_data": {
            "employee_count": "50-200",
            "monthly_revenue": "₹25L - ₹50L",
            "form_answers": [
                {"question": "How many employees work in your company?", "answer": "50-200"},
                {"question": "Managing work in Excel/Tally/Paper registers?", "answer": "yes"}
            ]
        }
    }
    metrics = SchedulingEngine.extract_scale_metrics(lead)
    assert metrics["scale_score"] >= 80
    assert "₹3.5L" in metrics["estimated_deal_value"] or "₹2.0L" in metrics["estimated_deal_value"]


def test_disproportionate_classification():
    lead = {
        "id": "test_akshay",
        "name": "Akshay",
        "business_name": "Fitserve Health Tech",
        "priority": "high",
        "channel_data": {
            "sheet_next_step": "isse call par baat hui isko ek final quotation bana ke dena hai aur close karne pe kaam karna hai",
            "meeting_flag": "Y",
            "employee_count": "11-50"
        }
    }
    scored = SchedulingEngine.score_and_classify_lead(lead)
    assert scored["tier"] == "disproportionate"
    assert "Deliver quotation" in scored["task_action"] or "quotation" in scored["task_action"].lower()
    assert scored["ev_score"] >= 65.0


def test_necessity_classification():
    lead = {
        "id": "test_kulldip",
        "name": "Kulldip Daryani",
        "business_name": "Retail Store",
        "priority": "low",
        "channel_data": {
            "sheet_next_step": "confirm meeting on 23",
            "employee_count": "2-10"
        }
    }
    scored = SchedulingEngine.score_and_classify_lead(lead)
    assert scored["tier"] == "necessity"
    assert scored["has_hard_commitment"] is True


def test_daily_battle_plan_capacity_limit():
    dummy_leads = []
    for i in range(120):
        dummy_leads.append({
            "id": f"lead_{i}",
            "name": f"Prospect {i}",
            "business_name": f"Company {i}",
            "priority": "high" if i < 20 else ("medium" if i < 60 else "low"),
            "channel_data": {
                "employee_count": "50-200" if i < 15 else "2-10",
                "sheet_next_step": "quotation sent" if i < 10 else ("confirm meeting on 23" if i < 25 else "speed to lead call")
            }
        })
    plan = SchedulingEngine.generate_daily_battle_plan(dummy_leads, max_daily_capacity=50)
    assert plan["scheduled_count"] <= 50
    assert plan["max_capacity"] == 50
    assert len(plan["top_10_needle_movers"]) == 10
    # First 10 should strictly be disproportionate returns
    for it in plan["top_10_needle_movers"]:
        assert it["tier"] == "disproportionate"
