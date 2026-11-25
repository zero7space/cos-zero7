import pytest
from backend.database import Repository

def test_sheet_columns_not_flattened():
    """Verify that sheet sync does not flatten column 16 remarks into 'unexplored'."""
    # Run sync on the real sheet
    res = Repository.sync_sheet_priorities()
    assert res["status"] == "success"
    assert res["total_sheet_rows"] >= 140

    # Verify that high-priority leads with remarks like 'quotation sent' or 'close' exist
    high_leads = Repository._execute("SELECT name, priority, channel_data FROM leads WHERE priority = 'high'", fetchall=True)
    assert len(high_leads) >= 15

    # Check that channel_data contains sheet_next_step
    has_sheet_step = False
    for l in high_leads:
        cd = l.get("channel_data") or ""
        if "sheet_next_step" in cd:
            has_sheet_step = True
            break
    assert has_sheet_step is True

def test_battle_plan_generation():
    """Verify that get_daily_battle_plan returns 50 ranked items with Top 10."""
    plan = Repository.get_daily_battle_plan(max_daily_capacity=50)
    assert plan["scheduled_count"] <= 50
    assert len(plan["top_10_needle_movers"]) == 10
    assert "₹" in plan["total_pipeline_in_play"]
    assert "₹" in plan["top10_pipeline_in_play"]
