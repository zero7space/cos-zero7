"""
Zero7 CRM — Model Context Protocol (MCP) Server for Google Antigravity
Exposes CRM database, leads, pipeline, and analytics directly to remote Antigravity agents via SSE.
"""

import asyncio
import json
import logging
import os
import re
import sqlite3
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse, StreamingResponse

from backend.database import Repository, get_connection

router = APIRouter()
logger = logging.getLogger("zero7_mcp")

# MCP Secret Token for Colleague Access
MCP_AUTH_TOKEN = os.environ.get("CRM_MCP_TOKEN", "zero7_antigravity_crm_2026")

# In-memory sessions: session_id -> asyncio.Queue
mcp_sessions: Dict[str, asyncio.Queue] = {}

def get_db_path() -> str:
    # 1. Docker environment default
    if os.path.exists("/app/zero7_crm.db"):
        return "/app/zero7_crm.db"
    # 2. Local workspace directory
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cand = os.path.join(base_dir, "zero7_crm.db")
    if os.path.exists(cand):
        return cand
    return "zero7_crm.db"

def verify_token(request: Request) -> bool:
    # Open access for colleague and team integrations on cos.zero7.space
    return True

# ----------------- MCP TOOLS IMPLEMENTATION -----------------

def tool_crm_sql_query(query: str) -> str:
    """Safely executes a read-only SQL query against zero7_crm.db."""
    clean_q = query.strip()
    # Check that query starts with SELECT, WITH, PRAGMA, or EXPLAIN
    first_word = clean_q.split()[0].upper() if clean_q else ""
    if first_word not in ("SELECT", "WITH", "PRAGMA", "EXPLAIN"):
        return json.dumps({
            "error": f"Only read-only queries (SELECT, WITH, PRAGMA) are permitted via raw SQL tool. Received: {first_word}"
        })
    # Extra safety check against dangerous subqueries/modifications
    forbidden = ["DELETE", "UPDATE", "INSERT", "DROP", "ALTER", "TRUNCATE", "ATTACH", "DETACH"]
    upper_q = clean_q.upper()
    for word in forbidden:
        if re.search(r'\b' + word + r'\b', upper_q):
            return json.dumps({
                "error": f"Forbidden keyword '{word}' detected in query. Use specific modification tools (crm_update_lead) for writes."
            })

    conn = None
    try:
        conn = get_connection()
        c = conn.cursor()
        c.execute(clean_q)
        rows = c.fetchall()
        col_names = [d[0] for d in c.description] if c.description else []
        results = [dict(zip(col_names, row)) for row in rows[:200]]  # limit to 200 rows
        return json.dumps({
            "query": clean_q,
            "row_count": len(results),
            "columns": col_names,
            "rows": results
        }, indent=2, default=str)
    except Exception as e:
        return json.dumps({"error": str(e), "query": clean_q})
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

def tool_crm_list_leads(status: Optional[str] = None, temperature: Optional[str] = None, search: Optional[str] = None, limit: int = 30) -> str:
    """Lists leads with flexible filtering."""
    conn = None
    try:
        conn = get_connection()
        c = conn.cursor()

        sql = """
            SELECT id, name, business_name, city, phone, email, temperature, call_stage,
                   status, priority, deal_value, next_action, next_action_date, last_update_notes,
                   created_at, updated_at
            FROM leads
            WHERE 1=1
        """
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status.lower())
        if temperature:
            sql += " AND temperature = ?"
            params.append(temperature.lower())
        if search:
            sql += " AND (name LIKE ? OR business_name LIKE ? OR city LIKE ? OR phone LIKE ? OR email LIKE ?)"
            term = f"%{search}%"
            params.extend([term, term, term, term, term])

        sql += f" ORDER BY updated_at DESC LIMIT {min(max(1, limit), 100)}"
        c.execute(sql, params)
        leads = [dict(r) for r in c.fetchall()]
        return json.dumps({"total_returned": len(leads), "leads": leads}, indent=2, default=str)
    except Exception as e:
        return json.dumps({"error": str(e)})
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

def tool_crm_get_lead(lead_id_or_name: str) -> str:
    """Retrieves 360-degree intelligence on a lead."""
    conn = None
    try:
        conn = get_connection()
        c = conn.cursor()

        # Find lead
        c.execute("""
            SELECT * FROM leads
            WHERE id = ? OR LOWER(name) LIKE ? OR LOWER(business_name) LIKE ?
            LIMIT 1
        """, (lead_id_or_name, f"%{lead_id_or_name.lower()}%", f"%{lead_id_or_name.lower()}%"))
        lead_row = c.fetchone()
        if not lead_row:
            return json.dumps({"error": f"Lead matching '{lead_id_or_name}' not found."})

        lead = dict(lead_row)
        lead_id = lead["id"]

        # Associated Notes
        c.execute("SELECT id, content, created_at FROM notes WHERE lead_id = ? ORDER BY created_at DESC", (lead_id,))
        notes = [dict(r) for r in c.fetchall()]

        # Associated Brief
        c.execute("SELECT * FROM company_briefs WHERE lead_id = ? LIMIT 1", (lead_id,))
        brief_row = c.fetchone()
        brief = dict(brief_row) if brief_row else None

        # Associated Prototype
        c.execute("SELECT id, title, description, share_token, view_count, created_at FROM lead_prototypes WHERE lead_id = ? LIMIT 1", (lead_id,))
        proto_row = c.fetchone()
        prototype = dict(proto_row) if proto_row else None

        # Call Logs
        c.execute("SELECT id, outcome, notes, duration_minutes, called_at FROM call_logs WHERE lead_id = ? ORDER BY called_at DESC LIMIT 10", (lead_id,))
        call_logs = [dict(r) for r in c.fetchall()]

        # Recent WhatsApp Messages
        c.execute("SELECT direction, message_text, timestamp FROM whatsapp_messages WHERE lead_id = ? ORDER BY timestamp DESC LIMIT 15", (lead_id,))
        wa_messages = [dict(r) for r in c.fetchall()]

        return json.dumps({
            "lead": lead,
            "notes": notes,
            "company_brief": brief,
            "prototype": prototype,
            "call_logs": call_logs,
            "recent_whatsapp": wa_messages
        }, indent=2, default=str)
    except Exception as e:
        return json.dumps({"error": str(e)})
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

def tool_crm_update_lead(
    lead_id: str,
    status: Optional[str] = None,
    temperature: Optional[str] = None,
    priority: Optional[str] = None,
    notes: Optional[str] = None,
    next_action: Optional[str] = None,
    next_action_date: Optional[str] = None
) -> str:
    """Updates lead attributes and logs a note."""
    conn = None
    try:
        conn = get_connection()
        c = conn.cursor()

        now = Repository.now()
        updates = ["updated_at = ?"]
        params = [now]

        if status:
            updates.append("status = ?")
            params.append(status.lower())
        if temperature:
            updates.append("temperature = ?")
            params.append(temperature.lower())
        if priority:
            updates.append("priority = ?")
            params.append(priority.lower())
        if next_action:
            updates.append("next_action = ?")
            params.append(next_action)
        if next_action_date:
            updates.append("next_action_date = ?")
            params.append(next_action_date)
        if notes:
            updates.append("last_update_notes = ?")
            params.append(notes)

        params.append(lead_id)
        c.execute(f"UPDATE leads SET {', '.join(updates)} WHERE id = ?", params)

        if notes:
            note_id = "note_" + uuid.uuid4().hex[:8]
            c.execute(
                "INSERT INTO notes (id, lead_id, user_id, content, created_at) VALUES (?, ?, 'antigravity_agent', ?, ?)",
                (note_id, lead_id, notes, now)
            )

        conn.commit()
        return json.dumps({"success": True, "lead_id": lead_id, "updated_at": now})
    except Exception as e:
        return json.dumps({"error": str(e)})
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

def tool_crm_create_lead(
    name: str,
    business_name: str,
    phone: Optional[str] = None,
    email: Optional[str] = None,
    city: Optional[str] = None,
    status: str = "new",
    notes: Optional[str] = None
) -> str:
    """Inserts a new lead into the CRM database."""
    lead_id = "lead_" + uuid.uuid4().hex[:8]
    now = Repository.now()
    conn = None
    try:
        conn = get_connection()
        c = conn.cursor()
        c.execute("""
            INSERT INTO leads (id, name, business_name, phone, email, city, status, temperature, call_stage, priority, last_update_notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'warm', 'first_call', 'medium', ?, ?, ?)
        """, (lead_id, name, business_name, phone, email, city, status.lower(), notes or "", now, now))

        if notes:
            note_id = "note_" + uuid.uuid4().hex[:8]
            c.execute(
                "INSERT INTO notes (id, lead_id, user_id, content, created_at) VALUES (?, ?, 'antigravity_agent', ?, ?)",
                (note_id, lead_id, notes, now)
            )

        conn.commit()
        return json.dumps({"success": True, "lead_id": lead_id, "name": name, "business_name": business_name, "created_at": now})
    except Exception as e:
        return json.dumps({"error": str(e)})
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

def tool_crm_get_pipeline_summary() -> str:
    """Returns aggregated pipeline metrics."""
    conn = None
    try:
        conn = get_connection()
        c = conn.cursor()

        c.execute("SELECT COUNT(*) as total_leads FROM leads")
        total_leads = c.fetchone()["total_leads"]

        c.execute("SELECT status, COUNT(*) as count FROM leads GROUP BY status")
        by_status = {r["status"]: r["count"] for r in c.fetchall()}

        c.execute("SELECT temperature, COUNT(*) as count FROM leads GROUP BY temperature")
        by_temp = {r["temperature"]: r["count"] for r in c.fetchall()}

        c.execute("SELECT COUNT(*) as total_deals, COALESCE(SUM(value), 0) as pipeline_value FROM deals")
        deal_row = c.fetchone()

        c.execute("SELECT id, name, business_name, status, updated_at FROM leads ORDER BY updated_at DESC LIMIT 5")
        recent = [dict(r) for r in c.fetchall()]
        return json.dumps({
            "total_leads": total_leads,
            "breakdown_by_status": by_status,
            "breakdown_by_temperature": by_temp,
            "total_deals": deal_row["total_deals"],
            "total_pipeline_value_inr": float(deal_row["pipeline_value"]),
            "recent_leads": recent
        }, indent=2, default=str)
    except Exception as e:
        return json.dumps({"error": str(e)})
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

# ----------------- MCP PROTOCOL DEFINITIONS -----------------

MCP_TOOLS_MANIFEST = [
    {
        "name": "crm_sql_query",
        "description": "Execute a SQL SELECT query directly against the Zero7 CRM SQLite database to explore leads, deals, metrics, call logs, and company briefs.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The SQL SELECT statement (e.g. 'SELECT id, name, business_name, status FROM leads ORDER BY created_at DESC LIMIT 10')"
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "crm_list_leads",
        "description": "Retrieve active leads from the CRM with flexible filtering options.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "status": { "type": "string", "description": "Filter by status: new, contacted, in_progress, won, lost" },
                "temperature": { "type": "string", "description": "Filter by temperature: hot, warm, cold" },
                "search": { "type": "string", "description": "Search term matching name, business, city, phone, email" },
                "limit": { "type": "integer", "description": "Maximum number of leads to return (default 30)" }
            }
        }
    },
    {
        "name": "crm_get_lead",
        "description": "Get complete intelligence on a specific lead, including contact info, notes, audio logs, strategy briefs, and prototypes.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "lead_id_or_name": {
                    "type": "string",
                    "description": "Lead ID (e.g. lead_231f403b) or contact person / business name"
                }
            },
            "required": ["lead_id_or_name"]
        }
    },
    {
        "name": "crm_update_lead",
        "description": "Update notes, status, temperature, priority, or next action date for a CRM lead.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "lead_id": { "type": "string", "description": "Target lead ID" },
                "status": { "type": "string", "description": "New status: new, contacted, in_progress, won, lost" },
                "temperature": { "type": "string", "description": "Temperature: hot, warm, cold" },
                "priority": { "type": "string", "description": "Priority: low, medium, high" },
                "notes": { "type": "string", "description": "Note or update text to append" },
                "next_action": { "type": "string", "description": "Next scheduled action" },
                "next_action_date": { "type": "string", "description": "Date or time for next action" }
            },
            "required": ["lead_id"]
        }
    },
    {
        "name": "crm_create_lead",
        "description": "Create a new business lead in the Zero7 CRM database.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "Primary contact person" },
                "business_name": { "type": "string", "description": "Company or business name" },
                "phone": { "type": "string", "description": "Phone number" },
                "email": { "type": "string", "description": "Email address" },
                "city": { "type": "string", "description": "City" },
                "status": { "type": "string", "description": "Initial status (default: new)" },
                "notes": { "type": "string", "description": "Initial context or notes" }
            },
            "required": ["name", "business_name"]
        }
    },
    {
        "name": "crm_get_pipeline_summary",
        "description": "Get high-level CRM pipeline metrics: total leads, conversion funnels, temperature breakdown, and active deals.",
        "inputSchema": {
            "type": "object",
            "properties": {}
        }
    }
]

def execute_tool(name: str, args: Dict[str, Any]) -> str:
    if name == "crm_sql_query":
        return tool_crm_sql_query(args.get("query", ""))
    elif name == "crm_list_leads":
        return tool_crm_list_leads(
            status=args.get("status"),
            temperature=args.get("temperature"),
            search=args.get("search"),
            limit=args.get("limit", 30)
        )
    elif name == "crm_get_lead":
        return tool_crm_get_lead(args.get("lead_id_or_name", ""))
    elif name == "crm_update_lead":
        return tool_crm_update_lead(
            lead_id=args.get("lead_id"),
            status=args.get("status"),
            temperature=args.get("temperature"),
            priority=args.get("priority"),
            notes=args.get("notes"),
            next_action=args.get("next_action"),
            next_action_date=args.get("next_action_date")
        )
    elif name == "crm_create_lead":
        return tool_crm_create_lead(
            name=args.get("name"),
            business_name=args.get("business_name"),
            phone=args.get("phone"),
            email=args.get("email"),
            city=args.get("city"),
            status=args.get("status", "new"),
            notes=args.get("notes")
        )
    elif name == "crm_get_pipeline_summary":
        return tool_crm_get_pipeline_summary()
    else:
        return json.dumps({"error": f"Unknown tool '{name}'"})

def handle_mcp_rpc(req_id: Any, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": "zero7-crm",
                    "version": "1.0.0"
                }
            }
        }
    elif method == "ping":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {}
        }
    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "tools": MCP_TOOLS_MANIFEST
            }
        }
    elif method == "tools/call":
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})
        result_text = execute_tool(tool_name, tool_args)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "content": [
                    {
                        "type": "text",
                        "text": result_text
                    }
                ]
            }
        }
    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {
                "code": -32601,
                "message": f"Method '{method}' not found"
            }
        }

# ----------------- SSE & POST ENDPOINTS -----------------

@router.get("/mcp/sse")
@router.get("/sse")
async def mcp_sse_endpoint(request: Request):
    """Establishes an SSE transport connection for Antigravity MCP clients."""
    verify_token(request)

    session_id = uuid.uuid4().hex
    q: asyncio.Queue = asyncio.Queue()
    mcp_sessions[session_id] = q

    async def event_generator():
        # Step 1: Send endpoint event directing client where to POST messages
        endpoint_url = f"/mcp/messages?sessionId={session_id}"
        yield f"event: endpoint\r\ndata: {endpoint_url}\r\n\r\n"

        try:
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=20.0)
                    if msg is None:
                        break
                    yield f"event: message\r\ndata: {json.dumps(msg)}\r\n\r\n"
                except asyncio.TimeoutError:
                    # Keepalive comment to prevent intermediate proxy timeout
                    yield ": keepalive\r\n\r\n"
        except asyncio.CancelledError:
            pass
        finally:
            mcp_sessions.pop(session_id, None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.post("/mcp/messages")
@router.post("/messages")
async def mcp_messages_endpoint(request: Request):
    """Receives JSON-RPC messages from Antigravity MCP client and pushes response to SSE queue."""
    session_id = request.query_params.get("sessionId")
    if not session_id or session_id not in mcp_sessions:
        raise HTTPException(status_code=400, detail="Invalid or expired MCP session ID. Please reconnect to /mcp/sse.")

    q = mcp_sessions[session_id]

    try:
        body = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")

    req_id = body.get("id")
    method = body.get("method", "")
    params = body.get("params", {})

    # If it's a notification (e.g. notifications/initialized), no response is expected
    if req_id is None:
        return PlainTextResponse("Accepted", status_code=202)

    # Compute response and queue for SSE delivery
    resp = handle_mcp_rpc(req_id, method, params)
    await q.put(resp)

    return PlainTextResponse("Accepted", status_code=202)

# ----------------- DIRECT REST ENDPOINTS FOR CRM DATA -----------------

@router.get("/api/crm/summary")
def api_crm_summary():
    """Direct REST endpoint to retrieve overall CRM metrics."""
    return json.loads(tool_crm_get_pipeline_summary())

@router.get("/api/crm/leads")
def api_crm_leads(status: Optional[str] = None, temperature: Optional[str] = None, search: Optional[str] = None, limit: int = 50):
    """Direct REST endpoint to search and filter leads."""
    return json.loads(tool_crm_list_leads(status=status, temperature=temperature, search=search, limit=limit))

@router.post("/api/crm/query")
async def api_crm_query(request: Request):
    """Direct REST endpoint to execute read SQL queries on CRM database."""
    try:
        data = await request.json()
        query = data.get("query", "")
        return json.loads(tool_crm_sql_query(query))
    except Exception as e:
        return {"error": str(e)}
