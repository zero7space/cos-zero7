import os
from fastapi import APIRouter
from backend.db.connection import get_connection

router = APIRouter(tags=["health"])


@router.get("/api/health")
def health():
    checks = {}

    # Database check
    try:
        conn = get_connection()
        conn.execute("SELECT 1").fetchone()
        lead_count = conn.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
        checks["database"] = "ok"
        checks["lead_count"] = lead_count
        conn.close()
    except Exception as e:
        checks["database"] = f"error: {e}"

    # Integrations check
    checks["gemini"] = "configured" if bool(os.environ.get("GEMINI_API_KEY")) else "not_configured"
    checks["deepgram"] = "configured" if bool(os.environ.get("DEEPGRAM_API_KEY")) else "not_configured"
    checks["hostinger"] = "configured" if bool(os.environ.get("HOSTINGER_API_TOKEN")) else "not_configured"

    is_healthy = checks.get("database") == "ok"
    return {"status": "healthy" if is_healthy else "degraded", "checks": checks}
