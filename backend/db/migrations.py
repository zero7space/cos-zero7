"""
COS Theta — Database Migrations and Safe Data Backfills
Ensures backward compatibility for existing database files.
"""

import sqlite3
import datetime
import json
import uuid


def run_migrations(cursor):
    """Safe column additions for databases created in earlier versions."""
    lead_cols = [
        ("city", "TEXT"),
        ("temperature", "TEXT DEFAULT 'warm'"),
        ("call_stage", "TEXT DEFAULT 'uncontacted'"),
        ("last_update_notes", "TEXT"),
        ("channel_data", "TEXT"),
        ("priority", "TEXT DEFAULT 'unexplored'"),
        ("next_action", "TEXT"),
        ("next_action_date", "TEXT"),
        ("next_action_priority", "TEXT DEFAULT 'medium'"),
        ("website", "TEXT"),
        ("project_path", "TEXT"),
        ("project_id", "TEXT"),
        ("project_name", "TEXT"),
        ("google_task_id", "TEXT"),
        ("subdomain", "TEXT"),
        ("subdomain_status", "TEXT DEFAULT 'pending'"),
        ("dns_record_id", "TEXT"),
        ("demo_video_url", "TEXT"),
        ("demo_video_title", "TEXT"),
        ("demo_video_status", "TEXT DEFAULT 'pending'"),
        ("prototype_status", "TEXT DEFAULT 'pending'"),
        ("prototype_url", "TEXT"),
        ("prototype_rep_context", "TEXT DEFAULT '{}'"),
        ("phone_normalized", "TEXT"),
        ("pipeline_stage", "TEXT DEFAULT 'new'"),
        ("github_repo_url", "TEXT DEFAULT ''"),
        ("github_repo_status", "TEXT DEFAULT 'pending'"),
        ("cached_file_tree", "TEXT DEFAULT '[]'"),
        ("drive_folder_id", "TEXT DEFAULT ''"),
        ("drive_folder_url", "TEXT DEFAULT ''"),
    ]
    for col, col_type in lead_cols:
        try:
            cursor.execute(f"ALTER TABLE leads ADD COLUMN {col} {col_type}")
        except sqlite3.OperationalError:
            pass

    deal_cols = [
        ("city", "TEXT"),
        ("delivery_stage", "TEXT DEFAULT 'in_development'"),
        ("amount_received", "REAL DEFAULT 0.0"),
        ("payment_status", "TEXT DEFAULT 'pending'"),
        ("payment_milestones", "TEXT DEFAULT '[]'"),
        ("github_repo_url", "TEXT DEFAULT ''"),
        ("production_url", "TEXT DEFAULT ''"),
        ("demo_url", "TEXT DEFAULT ''"),
        ("proposal_url", "TEXT DEFAULT ''"),
        ("proposal_title", "TEXT DEFAULT ''"),
        ("deliverables", "TEXT DEFAULT '[]'"),
        ("target_delivery_date", "TEXT DEFAULT ''"),
        ("actual_delivery_date", "TEXT DEFAULT ''"),
    ]
    for col, col_type in deal_cols:
        try:
            cursor.execute(f"ALTER TABLE deals ADD COLUMN {col} {col_type}")
        except sqlite3.OperationalError:
            pass

    call_cols = [
        ("recording_file_name", "TEXT"),
        ("recording_mime_type", "TEXT"),
        ("recording_size_bytes", "INTEGER"),
        ("recording_duration_secs", "INTEGER"),
        ("recording_drive_file_id", "TEXT"),
        ("recording_drive_url", "TEXT"),
        ("transcription_text", "TEXT"),
        ("transcription_drive_file_id", "TEXT"),
        ("transcription_confidence", "REAL"),
        ("transcription_language", "TEXT"),
        ("is_video", "INTEGER DEFAULT 0"),
        ("is_internal", "INTEGER DEFAULT 0"),
        ("teammate_user_id", "TEXT"),
        ("call_type", "TEXT DEFAULT 'client'"),
    ]
    for col, col_type in call_cols:
        try:
            cursor.execute(f"ALTER TABLE call_logs ADD COLUMN {col} {col_type}")
        except sqlite3.OperationalError:
            pass

    user_cols = [
        ("phone", "TEXT"),
        ("phone_normalized", "TEXT"),
    ]
    for col, col_type in user_cols:
        try:
            cursor.execute(f"ALTER TABLE users ADD COLUMN {col} {col_type}")
        except sqlite3.OperationalError:
            pass

    wa_cols = [
        ("media_url", "TEXT"),
    ]
    for col, col_type in wa_cols:
        try:
            cursor.execute(f"ALTER TABLE whatsapp_messages ADD COLUMN {col} {col_type}")
        except sqlite3.OperationalError:
            pass

    agent_job_cols = [
        ("role", "TEXT DEFAULT 'engineer'"),
        ("agent_slug", "TEXT DEFAULT 'prototype_maker'"),
        ("project_id", "TEXT"),
        ("rep_context", "TEXT DEFAULT '{}'"),
    ]
    for col, col_type in agent_job_cols:
        try:
            cursor.execute(f"ALTER TABLE agent_jobs ADD COLUMN {col} {col_type}")
        except sqlite3.OperationalError:
            pass

    agent_def_cols = [
        ("fallback_model", "TEXT DEFAULT 'none'"),
        ("role", "TEXT DEFAULT 'assistant'"),
    ]
    for col, col_type in agent_def_cols:
        try:
            cursor.execute(f"ALTER TABLE agent_definitions ADD COLUMN {col} {col_type}")
        except sqlite3.OperationalError:
            pass

    worker_cols = [
        ("machine_name", "TEXT"),
        ("user_email", "TEXT"),
        ("user_name", "TEXT"),
        ("os_info", "TEXT"),
        ("ip_address", "TEXT"),
        ("install_path", "TEXT"),
        ("projects_root", "TEXT"),
        ("device_token", "TEXT"),
        ("is_paired", "INTEGER DEFAULT 1"),
    ]
    for col, col_type in worker_cols:
        try:
            cursor.execute(f"ALTER TABLE agent_worker_heartbeats ADD COLUMN {col} {col_type}")
        except sqlite3.OperationalError:
            pass

    try:
        cursor.execute("ALTER TABLE agent_actions ADD COLUMN result TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass

    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sentinel_alerts_log (
                id TEXT PRIMARY KEY,
                lead_id TEXT,
                aberration_type TEXT NOT NULL,
                severity TEXT DEFAULT 'medium',
                nag_message TEXT NOT NULL,
                group_target TEXT DEFAULT 'Zero7',
                wa_message_id TEXT,
                status TEXT DEFAULT 'sent',
                dispatched_at TIMESTAMP,
                created_at TIMESTAMP,
                FOREIGN KEY (lead_id) REFERENCES leads (id)
            )
        """)
    except sqlite3.OperationalError:
        pass

    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS zero7_group_messages (
                id TEXT PRIMARY KEY,
                wa_message_id TEXT UNIQUE,
                sender_phone TEXT,
                sender_name TEXT,
                message_text TEXT,
                is_audio INTEGER DEFAULT 0,
                media_url TEXT,
                linked_lead_id TEXT,
                matched_lead_name TEXT,
                timestamp TIMESTAMP,
                created_at TIMESTAMP,
                FOREIGN KEY (linked_lead_id) REFERENCES leads (id)
            )
        """)
    except sqlite3.OperationalError:
        pass

    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sentinel_lead_context (
                lead_id TEXT PRIMARY KEY,
                lead_name TEXT,
                business_name TEXT,
                synthesized_context TEXT,
                group_mentions_summary TEXT DEFAULT '',
                call_insights_summary TEXT DEFAULT '',
                commitments_made TEXT DEFAULT '[]',
                unresolved_questions TEXT DEFAULT '[]',
                last_context_update TIMESTAMP,
                created_at TIMESTAMP,
                FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
            )
        """)
    except sqlite3.OperationalError:
        pass

    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS call_lead_mentions (
                id TEXT PRIMARY KEY,
                call_id TEXT NOT NULL,
                lead_id TEXT NOT NULL,
                topic TEXT,
                notes TEXT,
                transcript_excerpt TEXT,
                action_items TEXT,
                time_offset_start INTEGER DEFAULT 0,
                time_offset_end INTEGER DEFAULT 0,
                created_at TIMESTAMP,
                updated_at TIMESTAMP,
                FOREIGN KEY (call_id) REFERENCES call_logs (id) ON DELETE CASCADE,
                FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
            )
        """)
    except sqlite3.OperationalError:
        pass


def run_backfills(cursor):
    """Safe data backfills and historical cleanups."""
    # 1. Backfill phone_normalized on all existing leads
    try:
        leads_rows = cursor.execute(
            "SELECT id, phone FROM leads WHERE phone_normalized IS NULL OR phone_normalized = ''"
        ).fetchall()
        for l_row in leads_rows:
            lid, ph = l_row[0], l_row[1]
            if ph:
                d_str = "".join(ch for ch in str(ph) if ch.isdigit())
                norm_ph = d_str[-10:] if len(d_str) >= 10 else d_str
                cursor.execute("UPDATE leads SET phone_normalized = ? WHERE id = ?", (norm_ph, lid))
    except Exception:
        pass

    # 2. Backfill deal_milestones, deal_deliverables, deal_environments from existing deals
    try:
        now_ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        deals_rows = cursor.execute(
            "SELECT id, payment_milestones, deliverables, github_repo_url, production_url, demo_url, proposal_url, proposal_title FROM deals"
        ).fetchall()
        for d_row in deals_rows:
            did, p_ms, d_list, gh, prod, demo, prop_url, prop_title = (
                d_row[0], d_row[1], d_row[2], d_row[3], d_row[4], d_row[5], d_row[6], d_row[7]
            )
            # Milestones
            ms_count = cursor.execute("SELECT COUNT(*) FROM deal_milestones WHERE deal_id = ?", (did,)).fetchone()[0]
            if ms_count == 0 and p_ms:
                try:
                    ms_items = json.loads(p_ms) if isinstance(p_ms, str) else p_ms
                    if isinstance(ms_items, list):
                        for idx, item in enumerate(ms_items):
                            m_id = "mls_" + uuid.uuid4().hex[:8]
                            cursor.execute(
                                """
                                INSERT INTO deal_milestones (id, deal_id, milestone_name, target_amount, status, due_date, paid_date, sort_order, created_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                                (
                                    m_id,
                                    did,
                                    item.get("name", f"Milestone {idx+1}"),
                                    float(item.get("amount") or 0.0),
                                    item.get("status", "pending"),
                                    item.get("due_date"),
                                    item.get("paid_date"),
                                    idx,
                                    now_ts,
                                ),
                            )
                except Exception:
                    pass
            # Deliverables
            del_count = cursor.execute("SELECT COUNT(*) FROM deal_deliverables WHERE deal_id = ?", (did,)).fetchone()[0]
            if del_count == 0 and d_list:
                try:
                    d_items = json.loads(d_list) if isinstance(d_list, str) else d_list
                    if isinstance(d_items, list):
                        for idx, item in enumerate(d_items):
                            del_id = "del_" + uuid.uuid4().hex[:8]
                            title = item.get("title") if isinstance(item, dict) else str(item)
                            status = item.get("status", "pending") if isinstance(item, dict) else "pending"
                            cursor.execute(
                                """
                                INSERT INTO deal_deliverables (id, deal_id, title, description, status, sort_order, created_at)
                                VALUES (?, ?, ?, '', ?, ?, ?)
                            """,
                                (del_id, did, title, status, idx, now_ts),
                            )
                except Exception:
                    pass
            # Environments
            env_count = cursor.execute("SELECT COUNT(*) FROM deal_environments WHERE deal_id = ?", (did,)).fetchone()[0]
            if env_count == 0:
                env_map = [
                    ("github", "GitHub Repository", gh, 1),
                    ("production", "Production Domain", prod, 1),
                    ("staging_demo", "Staging / Prototype Demo", demo, 1),
                    ("proposal_sow", prop_title or "Proposal / SOW", prop_url, 0),
                ]
                for etype, elabel, eurl, eprim in env_map:
                    if eurl:
                        env_id = "env_" + uuid.uuid4().hex[:8]
                        cursor.execute(
                            """
                            INSERT INTO deal_environments (id, deal_id, env_type, label, url, is_primary, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                            (env_id, did, etype, elabel, eurl, eprim, now_ts),
                        )
    except Exception:
        pass

    # 3. Clean up legacy dummy 'CREATED' notes and restore uncontacted call_stage for fresh leads
    try:
        cursor.execute("""
            UPDATE leads 
            SET call_stage = 'uncontacted', last_update_notes = NULL 
            WHERE (last_update_notes = 'CREATED' OR last_update_notes LIKE 'CREATED%' OR last_update_notes = 'Status: CREATED' OR last_update_notes LIKE 'Status: CREATED%') 
              AND (call_stage IN ('connected', 'first_call') OR call_stage IS NULL)
        """)
        cursor.execute(
            "DELETE FROM notes WHERE content = 'CREATED' OR content LIKE 'CREATED%' OR content = 'Status: CREATED' OR content LIKE 'Status: CREATED%'"
        )
    except Exception:
        pass

    # 4. Clean up legacy 'subj:%' thread_key values so separate emails with identical subjects are not falsely merged
    try:
        cursor.execute("""
            UPDATE zoho_emails_cache
            SET thread_key = CASE 
                WHEN thread_id IS NOT NULL AND thread_id != '' AND LOWER(thread_id) != 'none' THEN thread_id
                ELSE message_id
            END
            WHERE thread_key LIKE 'subj:%'
        """)
        cursor.execute("""
            UPDATE zoho_emails_cache
            SET thread_count = (
                SELECT COUNT(*) FROM zoho_emails_cache z2 WHERE z2.thread_key = zoho_emails_cache.thread_key
            )
        """)
    except Exception:
        pass

    # 5. Team member phone configuration & internal call log backfill
    try:
        # Pre-populate Shailesh's phone number
        cursor.execute("""
            UPDATE users
            SET phone = '9993963968', phone_normalized = '9993963968'
            WHERE (id = 'usr_550ef8c1' OR email = 'shailesh@zero7.space' OR LOWER(name) LIKE '%shailesh%')
              AND (phone IS NULL OR phone = '')
        """)
        # Pre-populate Abhijeet's phone if known
        cursor.execute("""
            UPDATE users
            SET phone = '+91 9993202900', phone_normalized = '9993202900'
            WHERE (id = 'usr_e76bc446' OR email = 'abhijeet@zero7.space' OR LOWER(name) LIKE '%abhijeet%')
              AND (phone IS NULL OR phone = '')
        """)
        # Backfill existing internal discussion call_b82bb15e
        cursor.execute("""
            UPDATE call_logs
            SET is_internal = 1,
                teammate_user_id = 'usr_550ef8c1',
                call_type = 'internal'
            WHERE id = 'call_b82bb15e'
        """)
    except Exception:
        pass

    # 6. Multi-lead internal discussion modeling: call_lead_mentions table & safe migration
    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS call_lead_mentions (
                id TEXT PRIMARY KEY,
                call_id TEXT NOT NULL,
                lead_id TEXT NOT NULL,
                topic TEXT,
                notes TEXT,
                transcript_excerpt TEXT,
                action_items TEXT,
                time_offset_start INTEGER DEFAULT 0,
                time_offset_end INTEGER DEFAULT 0,
                created_at TIMESTAMP,
                updated_at TIMESTAMP,
                FOREIGN KEY (call_id) REFERENCES call_logs (id) ON DELETE CASCADE,
                FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_call_lead_mentions_call ON call_lead_mentions(call_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_call_lead_mentions_lead ON call_lead_mentions(lead_id)")

        # Migrate existing internal calls that had a single lead_id into call_lead_mentions
        cursor.execute("""
            SELECT id, lead_id, outcome, notes, transcription_text, called_at
            FROM call_logs
            WHERE (is_internal = 1 OR call_type = 'internal') AND lead_id IS NOT NULL AND lead_id != ''
        """)
        legacy_rows = cursor.fetchall() or []
        for r in legacy_rows:
            cid = r[0] if isinstance(r, tuple) else r["id"]
            lid = r[1] if isinstance(r, tuple) else r["lead_id"]
            outcome = (r[2] if isinstance(r, tuple) else r.get("outcome")) or "Internal Sync"
            notes = (r[3] if isinstance(r, tuple) else r.get("notes")) or ""
            trans = (r[4] if isinstance(r, tuple) else r.get("transcription_text")) or ""
            called_at = r[5] if isinstance(r, tuple) else r.get("called_at")

            cursor.execute("SELECT id FROM call_lead_mentions WHERE call_id = ? AND lead_id = ?", (cid, lid))
            if not cursor.fetchone():
                mention_id = f"clm_{uuid.uuid4().hex[:10]}"
                cursor.execute("""
                    INSERT INTO call_lead_mentions (id, call_id, lead_id, topic, notes, transcript_excerpt, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (mention_id, cid, lid, outcome, notes, trans[:1500] if trans else "", called_at, called_at))

        # Decouple internal calls from single lead_id so they are independent entities
        cursor.execute("""
            UPDATE call_logs
            SET lead_id = NULL
            WHERE (is_internal = 1 OR call_type = 'internal') AND lead_id IS NOT NULL
        """)
    except Exception:
        pass

