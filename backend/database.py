import sqlite3
import uuid
import datetime
import json
import os
import re
from typing import Optional, List, Dict, Any

from backend.db import DB_PATH, get_connection, init_db
from backend.repositories import (
    ActivityRepository,
    SubdomainRepository,
    AttributionRepository,
    PrototypeRepository,
    NoteRepository,
    CallLogRepository,
    DealRepository,
)


class Repository:
    @staticmethod
    def now():
        return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    @staticmethod
    def _execute(query, params=(), commit=False, fetchone=False, fetchall=False, retries=5, return_rowcount=False):
        import time
        last_err = None
        for attempt in range(retries):
            conn = None
            try:
                conn = get_connection()
                c = conn.cursor()
                c.execute(query, params)
                rowcount = c.rowcount
                res = None
                if fetchone:
                    row = c.fetchone()
                    if row:
                        res = dict(row)
                elif fetchall:
                    rows = c.fetchall()
                    if rows:
                        res = [dict(r) for r in rows]
                    else:
                        res = []
                if commit:
                    conn.commit()
                if return_rowcount:
                    return rowcount
                return res
            except sqlite3.OperationalError as e:
                last_err = e
                if conn:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                err_msg = str(e).lower()
                if ('locked' in err_msg or 'busy' in err_msg) and attempt < retries - 1:
                    time.sleep(0.15 * (2 ** attempt))
                    continue
                raise
            except Exception as e:
                last_err = e
                if conn:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                raise
            finally:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        pass
        if last_err:
            raise last_err

    @staticmethod
    def normalize_email(email: str) -> str:
        return str(email or "").strip().lower()

    @staticmethod
    def get_user_by_email(email: str):
        email_norm = Repository.normalize_email(email)
        if not email_norm:
            return None
        return Repository._execute("SELECT * FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1", (email_norm,), fetchone=True)

    @staticmethod
    def get_user_by_phone(phone: str):
        if not phone:
            return None
        norm_10 = Repository.normalize_phone(phone)
        if not norm_10 or len(norm_10) < 7:
            return None
        row = Repository._execute("""
            SELECT * FROM users 
            WHERE phone_normalized = ? 
               OR phone LIKE ? 
               OR phone = ?
            LIMIT 1
        """, (norm_10, f"%{norm_10}", phone), fetchone=True)
        return row

    @staticmethod
    def get_user(user_id: str):
        return Repository._execute("SELECT * FROM users WHERE id = ?", (user_id,), fetchone=True)

    @staticmethod
    def create_user(name: str, email: str, password_hash: str, role: str, phone: str = None):
        email_norm = Repository.normalize_email(email)
        if not email_norm:
            raise ValueError("Email is required")

        existing = Repository.get_user_by_email(email_norm)
        if existing:
            update_data = {"name": (name or "").strip(), "role": role, "email": email_norm}
            if phone is not None:
                raw_phone = str(phone or "").strip()
                update_data["phone"] = raw_phone
                update_data["phone_normalized"] = Repository.normalize_phone(raw_phone)
            # Never overwrite existing password with empty or blank string
            if password_hash is not None and str(password_hash).strip():
                update_data["password_hash"] = password_hash
            return Repository.update_user(existing["id"], update_data)

        user_id = 'usr_' + uuid.uuid4().hex[:12]
        raw_phone = str(phone or '').strip()
        norm_phone = Repository.normalize_phone(raw_phone)
        Repository._execute(
            "INSERT INTO users (id, name, email, password_hash, role, phone, phone_normalized, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, (name or "").strip(), email_norm, password_hash or "", role, raw_phone, norm_phone, Repository.now()),
            commit=True
        )
        return Repository.get_user(user_id)

    @staticmethod
    def update_user(user_id: str, data: dict):
        current = Repository.get_user(user_id)
        if not current:
            return None
        data = dict(data or {})
        updates = []
        params = []

        if "email" in data and data["email"] is not None:
            email_norm = Repository.normalize_email(data["email"])
            if email_norm:
                data["email"] = email_norm
            else:
                data.pop("email", None)

        # Never overwrite an existing password hash with an empty or blank string
        if "password_hash" in data:
            ph = data.get("password_hash")
            if ph is None or not str(ph).strip():
                data.pop("password_hash", None)

        for key in ['name', 'email', 'role', 'password_hash']:
            if key in data and data[key] is not None:
                updates.append(f"{key} = ?")
                params.append(data[key])
        if 'phone' in data and data['phone'] is not None:
            raw_phone = (data['phone'] or '').strip()
            norm_phone = Repository.normalize_phone(raw_phone)
            updates.append("phone = ?")
            params.append(raw_phone)
            updates.append("phone_normalized = ?")
            params.append(norm_phone)
        if updates:
            query = f"UPDATE users SET {', '.join(updates)} WHERE id = ?"
            params.append(user_id)
            Repository._execute(query, tuple(params), commit=True)
        return Repository.get_user(user_id)

    @staticmethod
    def delete_user(user_id: str):
        Repository._execute("UPDATE leads SET assigned_to = NULL WHERE assigned_to = ?", (user_id,), commit=True)
        Repository._execute("UPDATE deals SET assigned_to = NULL WHERE assigned_to = ?", (user_id,), commit=True)
        Repository._execute("DELETE FROM users WHERE id = ?", (user_id,), commit=True)

    @staticmethod
    def list_users():
        users = Repository._execute("SELECT id, name, email, phone, phone_normalized, role, created_at FROM users ORDER BY created_at ASC", fetchall=True)
        for u in users:
            uid = u['id']
            lead_res = Repository._execute("SELECT COUNT(*) as count FROM leads WHERE assigned_to = ?", (uid,), fetchone=True)
            u['assigned_leads_count'] = lead_res['count'] if lead_res else 0

            deal_res = Repository._execute("SELECT COUNT(*) as count, COALESCE(SUM(value), 0) as total_val FROM deals WHERE assigned_to = ?", (uid,), fetchone=True)
            u['assigned_deals_count'] = deal_res['count'] if deal_res else 0
            u['pipeline_value'] = float(deal_res['total_val']) if deal_res else 0.0
        return users

    @staticmethod
    def _format_lead(lead):
        if not lead:
            return None
        d = dict(lead)
        if 'channel_data' in d and d['channel_data']:
            if isinstance(d['channel_data'], str):
                try:
                    d['channel_data'] = json.loads(d['channel_data'])
                except Exception:
                    pass
        else:
            d['channel_data'] = None
        return d

    @staticmethod
    def create_lead(data: dict):
        name = (data.get('name') or '').strip()
        phone = (data.get('phone') or '').strip()
        if not name and not phone:
            raise ValueError("Cannot create lead without at least a name or phone number.")

        lead_id = 'lead_' + uuid.uuid4().hex[:8]
        now = Repository.now()
        channel_data = data.get('channel_data')
        if isinstance(channel_data, dict):
            channel_data_str = json.dumps(channel_data)
        elif isinstance(channel_data, str):
            channel_data_str = channel_data
        else:
            channel_data_str = None

        Repository._execute(
            """INSERT INTO leads (id, name, business_name, phone, email, city, temperature, call_stage, source, status, assigned_to, 
            meta_form_id, meta_ad_name, priority, deal_value, next_action, next_action_date, last_update_notes, 
            channel_data, last_contacted_at, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                lead_id, data.get('name'), data.get('business_name'), data.get('phone'), data.get('email'),
                data.get('city'), data.get('temperature', 'warm'), data.get('call_stage', 'uncontacted'),
                data.get('source', 'manual'), data.get('status', 'new'), data.get('assigned_to'),
                data.get('meta_form_id'), data.get('meta_ad_name'), data.get('priority', 'unexplored'),
                data.get('deal_value'), data.get('next_action'), data.get('next_action_date'), data.get('last_update_notes'),
                channel_data_str, data.get('last_contacted_at'), data.get('created_at') or now, data.get('updated_at') or now
            ),
            commit=True
        )
        return Repository.get_lead(lead_id)

    @staticmethod
    def bulk_create_leads(leads_list: list):
        created = []
        for d in leads_list:
            created.append(Repository.create_lead(d))
        return created

    @staticmethod
    def get_lead(lead_id: str):
        row = Repository._execute("SELECT * FROM leads WHERE id = ?", (lead_id,), fetchone=True)
        return Repository._format_lead(row)

    @staticmethod
    def get_lead_by_phone(phone: str):
        if not phone:
            return None
        norm_10 = Repository.normalize_phone(phone)
        if not norm_10 or len(norm_10) < 7:
            return None
        row = Repository._execute("""
            SELECT * FROM leads 
            WHERE phone_normalized = ? 
               OR phone LIKE ? 
               OR phone = ?
            LIMIT 1
        """, (norm_10, f"%{norm_10}", phone), fetchone=True)
        return Repository._format_lead(row) if row else None


    @staticmethod
    def get_lead_by_subdomain_or_slug(host: str):
        clean_host = host.lower().strip()
        subdomain_part = clean_host.replace(".zero7.space", "").strip()
        
        # 1. Direct match on subdomain column
        row = Repository._execute("SELECT * FROM leads WHERE LOWER(subdomain) = ? OR LOWER(subdomain) = ?", (clean_host, subdomain_part), fetchone=True)
        if row:
            return Repository._format_lead(row)
        
        # 2. Match on business_name or name slug
        rows = Repository._execute("SELECT * FROM leads", fetchall=True)
        for r in rows:
            biz = (r['business_name'] or r['name'] or '').lower().strip()
            slug = re.sub(r'[^a-z0-9]+', '-', biz).strip('-')
            if slug and (slug == subdomain_part or slug in subdomain_part or subdomain_part in slug):
                return Repository._format_lead(r)
        return None

    ALLOWED_LEAD_COLUMNS = {
        "name", "business_name", "phone", "phone_normalized", "email", "website", "city",
        "temperature", "call_stage", "source", "status", "pipeline_stage", "assigned_to",
        "meta_form_id", "meta_ad_name", "priority", "deal_value", "next_action",
        "next_action_date", "next_action_priority", "last_update_notes", "channel_data",
        "project_path", "project_id", "project_name", "subdomain", "subdomain_status",
        "dns_record_id", "demo_video_url", "demo_video_title", "demo_video_status",
        "prototype_status", "prototype_url", "prototype_rep_context", "google_task_id",
        "github_repo_url", "github_repo_status", "cached_file_tree", "drive_folder_id",
        "drive_folder_url", "last_contacted_at", "created_at", "updated_at",
    }
    NULLABLE_LEAD_COLUMNS = {
        "assigned_to", "deal_value", "next_action", "next_action_date",
        "last_update_notes", "business_name", "phone_normalized", "email", "website", "city",
        "meta_form_id", "meta_ad_name", "channel_data", "project_path",
        "project_id", "project_name", "subdomain", "dns_record_id",
        "demo_video_url", "demo_video_title", "prototype_url",
        "google_task_id", "github_repo_url", "drive_folder_id",
        "drive_folder_url", "last_contacted_at",
    }
    CRM_LOCKABLE_FIELDS = ("priority", "last_update_notes", "next_action")

    @staticmethod
    def update_lead(lead_id: str, data: dict, mark_crm_locks: bool = False):
        """Update allowed lead columns, normalize phone/nullable fields, and lock CRM-edited fields against Sheet overwrite."""
        current = Repository.get_lead(lead_id)
        if not current:
            return None

        clean_data = {}
        for key, val in data.items():
            if key not in Repository.ALLOWED_LEAD_COLUMNS:
                continue
            if key == "assigned_to" and isinstance(val, str) and not val.strip():
                val = None
            elif key == "deal_value" and val == "":
                val = None
            if val is None and key not in Repository.NULLABLE_LEAD_COLUMNS:
                continue
            clean_data[key] = val

        eff_name = (clean_data["name"] if "name" in clean_data else current.get("name")) or ""
        eff_name = str(eff_name).strip()
        if "name" in clean_data and not eff_name:
            raise ValueError("Lead name cannot be empty.")
        eff_phone = (clean_data["phone"] if "phone" in clean_data else current.get("phone")) or ""
        eff_phone = str(eff_phone).strip()
        if not eff_name and not eff_phone:
            raise ValueError("Cannot leave lead without at least a name or phone number.")

        if "phone" in clean_data and "phone_normalized" not in clean_data:
            clean_data["phone_normalized"] = Repository.normalize_phone(clean_data["phone"]) or None

        if mark_crm_locks and "channel_data" not in clean_data:
            locked_keys = [k for k in Repository.CRM_LOCKABLE_FIELDS if k in clean_data]
            if locked_keys:
                curr_cd = current.get("channel_data")
                if isinstance(curr_cd, dict):
                    cd = dict(curr_cd)
                elif isinstance(curr_cd, str) and curr_cd.strip():
                    try:
                        cd = json.loads(curr_cd)
                    except Exception:
                        cd = {}
                else:
                    cd = {}
                locks = dict(cd.get("crm_locked_fields")) if isinstance(cd.get("crm_locked_fields"), dict) else {}
                if "priority" in locked_keys and "sheet_priority" not in cd:
                    cd["sheet_priority"] = (current.get("priority") or "unexplored").lower()
                if "last_update_notes" in locked_keys and "sheet_updates" not in cd:
                    cd["sheet_updates"] = current.get("last_update_notes") or ""
                if "next_action" in locked_keys and "sheet_next_step" not in cd:
                    cd["sheet_next_step"] = current.get("next_action") or ""
                now_ts = Repository.now()
                for lk in locked_keys:
                    locks[lk] = now_ts
                cd["crm_locked_fields"] = locks
                clean_data["channel_data"] = cd

        updates = []
        params = []
        for key, val in clean_data.items():
            if key == "channel_data" and isinstance(val, dict):
                val = json.dumps(val)
            updates.append(f"{key} = ?")
            params.append(val)

        if updates:
            if "updated_at" not in clean_data:
                updates.append("updated_at = ?")
                params.append(Repository.now())
            query = f"UPDATE leads SET {', '.join(updates)} WHERE id = ?"
            params.append(lead_id)
            Repository._execute(query, tuple(params), commit=True)
        return Repository.get_lead(lead_id)

    @staticmethod
    def update_lead_cached_files(lead_id: str, files: list):
        Repository._execute("UPDATE leads SET cached_file_tree = ? WHERE id = ?", (json.dumps(files), lead_id), commit=True)

    @staticmethod
    def get_lead_cached_files(lead_id: str) -> list:
        row = Repository._execute("SELECT cached_file_tree FROM leads WHERE id = ?", (lead_id,), fetchone=True)
        if row and row.get("cached_file_tree"):
            try:
                return json.loads(row["cached_file_tree"])
            except Exception:
                return []
        return []

    @staticmethod
    def purge_empty_leads():
        """Purge all phantom leads where name and phone are empty/blank, along with orphan child records."""
        empty_leads = Repository._execute("SELECT id FROM leads WHERE name IS NULL OR trim(name) = ''", fetchall=True)
        if not empty_leads:
            return 0
        
        empty_ids = [l['id'] for l in empty_leads]
        id_placeholders = ','.join(['?'] * len(empty_ids))
        
        for table in ['sentinel_alerts_log', 'lead_facts', 'lead_prototypes', 'whatsapp_messages', 'activities', 'notes', 'call_logs', 'deals', 'custom_data_pills']:
            try:
                Repository._execute(f"DELETE FROM {table} WHERE lead_id IN ({id_placeholders})", tuple(empty_ids), commit=True)
            except Exception:
                pass
        
        Repository._execute(f"DELETE FROM leads WHERE id IN ({id_placeholders})", tuple(empty_ids), commit=True)
        return len(empty_ids)

    @staticmethod
    def delete_lead(lead_id: str):
        try:
            Repository._execute("DELETE FROM sentinel_alerts_log WHERE lead_id = ?", (lead_id,), commit=True)
            Repository._execute("DELETE FROM lead_facts WHERE lead_id = ?", (lead_id,), commit=True)
            Repository._execute("DELETE FROM lead_prototypes WHERE lead_id = ?", (lead_id,), commit=True)
            Repository._execute("DELETE FROM whatsapp_messages WHERE lead_id = ?", (lead_id,), commit=True)
            Repository._execute("DELETE FROM activities WHERE lead_id = ?", (lead_id,), commit=True)
        except Exception:
            pass
        Repository._execute("DELETE FROM notes WHERE lead_id = ?", (lead_id,), commit=True)
        Repository._execute("DELETE FROM call_logs WHERE lead_id = ?", (lead_id,), commit=True)
        Repository._execute("DELETE FROM deals WHERE lead_id = ?", (lead_id,), commit=True)
        Repository._execute("DELETE FROM leads WHERE id = ?", (lead_id,), commit=True)

    @staticmethod
    def list_leads(filters: dict = None):
        query = "SELECT * FROM leads"
        params = []
        if filters:
            conds = []
            for k, v in filters.items():
                if v:
                    conds.append(f"{k} = ?")
                    params.append(v)
            if conds:
                query += " WHERE " + " AND ".join(conds)
        query += " ORDER BY created_at DESC"
        rows = Repository._execute(query, tuple(params), fetchall=True)
        return [Repository._format_lead(r) for r in rows]

    # Deal delegations
    _format_deal = DealRepository._format_deal
    create_deal = DealRepository.create_deal
    get_deal = DealRepository.get_deal
    update_deal = DealRepository.update_deal
    list_deals = DealRepository.list_deals
    delete_deal = DealRepository.delete_deal

    # Call Log & Note delegations
    log_call = CallLogRepository.log_call
    update_call_transcription = CallLogRepository.update_call_transcription
    get_internal_calls = CallLogRepository.get_internal_calls
    link_internal_call_to_lead = CallLogRepository.link_internal_call_to_lead
    add_call_lead_mention = CallLogRepository.add_call_lead_mention
    get_call_lead_mentions = CallLogRepository.get_call_lead_mentions
    get_lead_call_mentions = CallLogRepository.get_lead_call_mentions
    delete_call_lead_mention = CallLogRepository.delete_call_lead_mention
    unlink_internal_call_from_lead = CallLogRepository.unlink_internal_call_from_lead

    @staticmethod
    def get_or_create_lead_by_phone(phone: str, user_id: str = None, name: str = None):
        """Find existing lead by phone, or create a new lead if none exists."""
        if not phone:
            return None
        existing = Repository.get_lead_by_phone(phone)
        if existing:
            return existing
        
        norm_10 = Repository.normalize_phone(phone)
        clean_phone = f"+91{norm_10}" if (norm_10 and len(norm_10) == 10) else phone
        lead_name = name or (f"Prospect {clean_phone}" if clean_phone else "Unknown Prospect")
        lead_id = f"lead_{uuid.uuid4().hex[:8]}"
        now = Repository.now()
        
        Repository._execute("""
            INSERT INTO leads (
                id, name, business_name, phone, phone_normalized, source, status,
                call_stage, temperature, priority, assigned_to, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'mobile_calling_app', 'new', 'contacted', 'warm', 'unexplored', ?, ?, ?)
        """, (lead_id, lead_name, '', clean_phone, norm_10 or phone, user_id, now, now), commit=True)
        
        return Repository.get_lead(lead_id)

    get_all_calls = CallLogRepository.get_all_calls
    add_note = NoteRepository.add_note
    get_lead_activity = CallLogRepository.get_lead_activity
    get_lead_notes = NoteRepository.get_lead_notes
    get_lead_calls = CallLogRepository.get_lead_calls

    @staticmethod
    def get_lead_whatsapp_messages(lead_id: str):
        return Repository._execute("SELECT * FROM whatsapp_messages WHERE lead_id = ? ORDER BY timestamp ASC", (lead_id,), fetchall=True)

    get_whatsapp_messages = get_lead_whatsapp_messages

    @staticmethod
    def normalize_phone(phone):
        """Normalize phone to last 10 digits."""
        if not phone:
            return ''
        clean = phone.split('@')[0].split(':')[0]
        digits = ''.join(c for c in clean if c.isdigit())
        return digits[-10:] if len(digits) >= 10 else digits

    @staticmethod
    def get_all_lead_phones():
        """Return all normalized lead phone numbers with their IDs."""
        leads = Repository._execute("SELECT id, phone FROM leads WHERE phone IS NOT NULL AND phone != ''", fetchall=True)
        result = {}
        for l in leads:
            normalized = Repository.normalize_phone(l['phone'])
            if normalized:
                result[normalized] = l['id']
        return result

    @staticmethod
    def register_whatsapp_account(phone_number, label=''):
        acc_id = 'wa_' + uuid.uuid4().hex[:8]
        now = Repository.now()
        try:
            Repository._execute(
                "INSERT INTO whatsapp_accounts (id, phone_number, label, is_active, created_at) VALUES (?, ?, ?, 1, ?)",
                (acc_id, phone_number, label, now), commit=True
            )
        except Exception:
            # Already exists, update label
            Repository._execute(
                "UPDATE whatsapp_accounts SET label = ?, is_active = 1 WHERE phone_number = ?",
                (label, phone_number), commit=True
            )
        return Repository._execute("SELECT * FROM whatsapp_accounts WHERE phone_number = ?", (phone_number,), fetchone=True)

    @staticmethod
    def get_whatsapp_accounts():
        return Repository._execute("SELECT * FROM whatsapp_accounts WHERE is_active = 1 ORDER BY label", fetchall=True)

    @staticmethod
    def sync_whatsapp_messages(account_phone, messages):
        """Batch insert messages, skipping duplicates by wa_message_id."""
        phone_map = Repository.get_all_lead_phones()
        account = Repository._execute("SELECT id FROM whatsapp_accounts WHERE phone_number = ?", (account_phone,), fetchone=True)
        account_id = account['id'] if account else None
        now = Repository.now()
        inserted = 0
        norm_acc_phone = Repository.normalize_phone(account_phone)
        is_central = norm_acc_phone in ('9479007951', '919479007951') or str(account_phone) in ('central', '9479007951', '919479007951', '+919479007951')
        acc_id_val = 'central' if is_central else account_id

        for msg in messages:
            lead_phone_norm = Repository.normalize_phone(msg.get('lead_phone', ''))
            lead_id = phone_map.get(lead_phone_norm)
            if not lead_id and not is_central:
                continue  # Skip messages not matching any CRM lead for personal accounts; keep ALL for central inbox
            msg_id = 'wamsg_' + uuid.uuid4().hex[:8]
            target_phone = lead_phone_norm or msg.get('lead_phone', '')
            direction = msg.get('direction', 'incoming')
            if direction in ('out', 'outgoing'):
                direction = 'outgoing'
            else:
                direction = 'incoming'

            try:
                Repository._execute(
                    """INSERT OR IGNORE INTO whatsapp_messages 
                    (id, account_id, account_phone, lead_phone, lead_id, direction, message_text, message_type, media_caption, timestamp, wa_message_id, status, media_url, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (msg_id, acc_id_val, account_phone, target_phone, lead_id,
                     direction, msg.get('message_text', ''),
                     msg.get('message_type', 'text'), msg.get('media_caption'),
                     msg.get('timestamp', now), msg.get('wa_message_id'),
                     msg.get('status', 'delivered'), msg.get('media_url'), now),
                    commit=True
                )
                inserted += 1
            except Exception:
                pass  # Duplicate wa_message_id, skip
        # Update last_synced_at
        Repository._execute(
            "UPDATE whatsapp_accounts SET last_synced_at = ? WHERE phone_number = ?",
            (now, account_phone), commit=True
        )
        return inserted

    @staticmethod
    def get_whatsapp_conversation(lead_id, account_phone=None):
        """Get WhatsApp messages for a lead, optionally filtered by account. Matches by lead_id or normalized lead_phone."""
        lead = Repository.get_lead(lead_id)
        lead_phone_10 = Repository.normalize_phone(lead.get('phone', '')) if lead else ''

        lead_clauses = ["lead_id = ?"]
        lead_params = [lead_id]
        if lead_phone_10:
            lead_clauses.append("lead_phone = ?")
            lead_params.append(lead_phone_10)
            lead_clauses.append("lead_phone = ?")
            lead_params.append('91' + lead_phone_10)
            lead_clauses.append("lead_phone = ?")
            lead_params.append('+91' + lead_phone_10)
        lead_sql = " OR ".join(lead_clauses)

        if account_phone and account_phone != 'all':
            clean_phone = Repository.normalize_phone(account_phone)
            acc_params = [clean_phone, '91' + clean_phone, '+91' + clean_phone, account_phone]
            sql = f"SELECT * FROM whatsapp_messages WHERE ({lead_sql}) AND account_phone IN (?, ?, ?, ?) ORDER BY timestamp ASC"
            messages = Repository._execute(sql, tuple(lead_params + acc_params), fetchall=True)
        else:
            sql = f"SELECT * FROM whatsapp_messages WHERE ({lead_sql}) ORDER BY timestamp ASC"
            messages = Repository._execute(sql, tuple(lead_params), fetchall=True)
        return messages

    @staticmethod
    def get_whatsapp_accounts_for_lead(lead_id):
        """Get all WhatsApp accounts that have conversations with this lead."""
        lead = Repository.get_lead(lead_id)
        lead_phone_10 = Repository.normalize_phone(lead.get('phone', '')) if lead else ''

        lead_clauses = ["wm.lead_id = ?"]
        lead_params = [lead_id]
        if lead_phone_10:
            lead_clauses.append("wm.lead_phone = ?")
            lead_params.append(lead_phone_10)
            lead_clauses.append("wm.lead_phone = ?")
            lead_params.append('91' + lead_phone_10)
            lead_clauses.append("wm.lead_phone = ?")
            lead_params.append('+91' + lead_phone_10)
        lead_sql = " OR ".join(lead_clauses)

        rows = Repository._execute(f"""
            SELECT DISTINCT wm.account_phone
            FROM whatsapp_messages wm
            WHERE {lead_sql}
        """, tuple(lead_params), fetchall=True)
        all_accs = Repository.get_whatsapp_accounts()
        acc_map = {Repository.normalize_phone(a['phone_number']): a for a in all_accs}
        result = []
        seen = set()
        for r in rows:
            p10 = Repository.normalize_phone(r['account_phone'])
            if p10 and p10 not in seen:
                seen.add(p10)
                matched = acc_map.get(p10)
                label = matched['label'] if matched else ('Abhijeet Personal' if '9993202900' in p10 else 'Zero7 Central')
                result.append({"phone_number": p10, "label": label})
        return result

    @staticmethod
    def get_central_whatsapp_conversations():
        """Retrieve all active conversations for Zero7 Central (9479007951), joined with CRM leads."""
        central_variants = ('9479007951', '919479007951', '+919479007951')
        
        # 1. Fetch conversations from whatsapp_messages
        query = """
            SELECT 
                wm.lead_phone,
                wm.lead_id,
                MAX(wm.timestamp) as last_timestamp,
                COUNT(*) as total_messages
            FROM whatsapp_messages wm
            WHERE (wm.account_phone IN (?, ?, ?) OR wm.account_id = 'central')
            GROUP BY wm.lead_phone
            ORDER BY last_timestamp DESC
        """
        rows = Repository._execute(query, central_variants, fetchall=True)
        
        conversations = []
        seen_phones = set()
        for r in rows:
            lead_phone = r['lead_phone']
            norm_10 = Repository.normalize_phone(lead_phone)
            if norm_10 in seen_phones:
                continue
            if norm_10:
                seen_phones.add(norm_10)
            
            # Fetch latest message
            last_msg = Repository._execute("""
                SELECT message_text, direction, status, message_type, timestamp, wa_message_id
                FROM whatsapp_messages
                WHERE (account_phone IN (?, ?, ?) OR account_id = 'central') AND (lead_phone = ? OR lead_phone = ? OR lead_phone = ?)
                ORDER BY timestamp DESC LIMIT 1
            """, (*central_variants, lead_phone, norm_10, '91' + norm_10 if norm_10 else lead_phone), fetchone=True)
            
            # Match CRM lead
            lead = None
            if r['lead_id']:
                lead = Repository.get_lead(r['lead_id'])
            if not lead and norm_10:
                lead = Repository.get_lead_by_phone(norm_10)
                
            conv = {
                "phone": lead_phone,
                "phone_10": norm_10,
                "lead_id": lead['id'] if lead else r['lead_id'],
                "lead_name": lead['name'] if lead else None,
                "business_name": lead.get('business_name') if lead else None,
                "call_stage": lead.get('call_stage') if lead else None,
                "status": lead.get('status') if lead else None,
                "deal_value": lead.get('deal_value') if lead else None,
                "is_linked": bool(lead),
                "total_messages": r['total_messages'],
                "last_timestamp": last_msg['timestamp'] if last_msg else r['last_timestamp'],
                "last_message": last_msg['message_text'] if last_msg else '',
                "last_direction": last_msg['direction'] if last_msg else 'incoming',
                "last_status": last_msg['status'] if last_msg else 'delivered',
                "last_type": last_msg['message_type'] if last_msg else 'text'
            }
            conversations.append(conv)
            
        return conversations

    @staticmethod
    def get_central_conversation_messages(phone):
        """Retrieve all messages between Zero7 Central and a specific phone number."""
        central_variants = ('9479007951', '919479007951', '+919479007951')
        norm_10 = Repository.normalize_phone(phone)
        phone_variants = [phone, norm_10, '91' + norm_10, '+91' + norm_10]
        
        # Check if matched to a lead
        lead = Repository.get_lead_by_phone(norm_10)
        lead_id = lead['id'] if lead else None
        
        where_parts = ["lead_phone IN (?, ?, ?, ?)"]
        params = list(phone_variants)
        if lead_id:
            where_parts.append("lead_id = ?")
            params.append(lead_id)
            
        sql = f"""
            SELECT * FROM whatsapp_messages 
            WHERE (account_phone IN (?, ?, ?) OR account_id = 'central') AND ({' OR '.join(where_parts)})
            ORDER BY timestamp ASC
        """
        all_params = list(central_variants) + params
        messages = Repository._execute(sql, tuple(all_params), fetchall=True)
        return {
            "lead": dict(lead) if lead else None,
            "phone": phone,
            "phone_10": norm_10,
            "messages": [dict(m) for m in messages]
        }

    @staticmethod
    def save_outgoing_whatsapp_message(account_phone, lead_phone, message_text, wa_message_id=None, lead_id=None):
        """Save a successfully sent outgoing WhatsApp message into the database."""
        import uuid
        from datetime import datetime, timezone
        msg_id = f"wa_out_{uuid.uuid4().hex[:12]}"
        now_iso = datetime.now(timezone.utc).isoformat()
        norm_lead_phone = Repository.normalize_phone(lead_phone)
        
        if not lead_id and norm_lead_phone:
            lead = Repository.get_lead_by_phone(norm_lead_phone)
            if lead:
                lead_id = lead['id']
                
        wa_mid = wa_message_id or f"out_{uuid.uuid4().hex}"
        
        Repository._execute("""
            INSERT OR REPLACE INTO whatsapp_messages 
            (id, account_id, account_phone, lead_phone, lead_id, direction, message_text, message_type, timestamp, wa_message_id, status, created_at)
            VALUES (?, 'central', ?, ?, ?, 'outgoing', ?, 'text', ?, ?, 'delivered', ?)
        """, (msg_id, account_phone, norm_lead_phone or lead_phone, lead_id, message_text, now_iso, wa_mid, now_iso))
        
        return Repository._execute("SELECT * FROM whatsapp_messages WHERE id = ?", (msg_id,), fetchone=True)

    @staticmethod
    def link_phone_to_lead(phone, lead_id):
        """Link an unlinked phone number and all its messages to a CRM lead."""
        norm_10 = Repository.normalize_phone(phone)
        Repository._execute("""
            UPDATE whatsapp_messages 
            SET lead_id = ? 
            WHERE lead_phone = ? OR lead_phone = ? OR lead_phone = ?
        """, (lead_id, phone, norm_10, '91' + norm_10))
        return True

    @staticmethod
    def auto_link_whatsapp_messages():
        """Auto-links any unlinked whatsapp_messages to existing CRM leads by matching phone."""
        leads = Repository._execute("SELECT id, phone FROM leads WHERE phone IS NOT NULL AND phone != ''", fetchall=True) or []
        for l in leads:
            lid = l.get("id")
            p = l.get("phone")
            p10 = Repository.normalize_phone(p)
            if p10:
                Repository._execute("""
                    UPDATE whatsapp_messages 
                    SET lead_id = ? 
                    WHERE (lead_id IS NULL OR lead_id = '') 
                      AND (lead_phone = ? OR lead_phone = ? OR lead_phone = ? OR lead_phone LIKE '%' || ?)
                """, (lid, p, p10, '91' + p10, p10))
        return True

    @staticmethod
    def create_lead_from_whatsapp(phone, name, business_name=None, source='WhatsApp Central'):
        """Create a new CRM lead from an unlinked WhatsApp contact and attach all historical messages."""
        import uuid
        from datetime import datetime, timezone
        lead_id = f"lead_{uuid.uuid4().hex[:8]}"
        norm_10 = Repository.normalize_phone(phone)
        formatted_phone = f"+91{norm_10}" if norm_10 else phone
        now_iso = datetime.now(timezone.utc).isoformat()
        
        Repository._execute("""
            INSERT INTO leads (id, name, business_name, phone, source, status, call_stage, temperature, priority, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'new', 'uncontacted', 'warm', 'unexplored', ?, ?)
        """, (lead_id, name, business_name or '', formatted_phone, source, now_iso, now_iso))
        
        Repository.link_phone_to_lead(phone, lead_id)
        return Repository.get_lead(lead_id)



    @staticmethod
    def sync_sheet_priorities(sheet_id: str = "1hYCgiSy1upKN7BqsILAL5vSz1O-6wrLNyxK7XZldCxI", sheet_name: str = "Lead form - Higher intent"):
        """Sync lead priorities, team remarks, notes, and new Meta leads from Google Sheet 'Lead form - Higher intent' tab."""
        import urllib.request, urllib.parse, csv, io, json, uuid, re
        from datetime import datetime

        url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={urllib.parse.quote(sheet_name)}"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        content = urllib.request.urlopen(req, timeout=15).read().decode('utf-8')
        rows = list(csv.reader(io.StringIO(content)))

        if not rows or len(rows) < 2:
            return {"status": "success", "created": 0, "updated": 0, "message": "No data rows in sheet"}

        headers = [h.strip() for h in rows[0]]
        h_map = {h.lower(): i for i, h in enumerate(headers)}

        next_step_idx = h_map.get('next step', 16)
        priority_idx = h_map.get('priority', 17)
        phone_idx = h_map.get('phone_number', 18)
        company_idx = h_map.get('company_name', 19)
        name_idx = h_map.get('full_name', 15)
        email_idx = h_map.get('email', 20)
        city_idx = h_map.get('city', 21)
        updates_idx = h_map.get('updates', 22)
        meeting_idx = h_map.get('meeeting', h_map.get('meeting', 23))
        brief_idx = 24

        scale_idx = h_map.get('what_is_your_approximate_monthly_revenue?', 14)
        biz_idx = h_map.get('what_does_your_business_do?', 12)
        excel_idx = h_map.get('are_you_currently_managing_work_in_excel,_tally_or_paper_registers?', 13)

        leads = Repository._execute("SELECT id, name, phone, email, channel_data, priority, last_update_notes, next_action FROM leads", fetchall=True)
        phone_map = {}
        leadgen_map = {}
        name_map = {}
        crm_priority_map = {}
        for l in leads:
            crm_priority_map[l['id']] = (l.get('priority') or 'unexplored').lower()
            norm_p = Repository.normalize_phone(l['phone'])
            if norm_p:
                phone_map[norm_p] = l['id']
            cd = json.loads(l['channel_data']) if l['channel_data'] and isinstance(l['channel_data'], str) else (l['channel_data'] if isinstance(l['channel_data'], dict) else {})
            if cd.get('leadgen_id'):
                leadgen_map[str(cd['leadgen_id'])] = l['id']
            if l['name']:
                name_map[l['name'].strip().lower()] = l['id']

        updated_count = 0
        created_count = 0
        notes_count = 0
        now = Repository.now()
        breakdown = {}
        admin_user = Repository._execute("SELECT id FROM users WHERE email = 'shailesh@zero7.space' OR email = 'abhijeet@zero7.space' LIMIT 1", fetchone=True) or Repository._execute("SELECT id FROM users LIMIT 1", fetchone=True)
        system_user_id = admin_user['id'] if admin_user else None

        for r in rows[1:]:
            raw_leadgen_id = r[0].replace('l:', '').strip() if len(r) > 0 else ''
            created_time = r[1].strip() if len(r) > 1 else now
            ad_id = r[2].replace('ag:', '').strip() if len(r) > 2 else ''
            ad_name = r[3].strip() if len(r) > 3 else ''
            adset_id = r[4].replace('as:', '').strip() if len(r) > 4 else ''
            adset_name = r[5].strip() if len(r) > 5 else ''
            campaign_id = r[6].replace('c:', '').strip() if len(r) > 6 else ''
            campaign_name = r[7].strip() if len(r) > 7 else ''
            form_id = r[8].replace('f:', '').strip() if len(r) > 8 else ''
            form_name = r[9].strip() if len(r) > 9 else ''
            platform_val = r[11].strip().lower() if len(r) > 11 else 'instagram'
            platform = 'instagram' if 'ig' in platform_val or 'instagram' in platform_val else ('facebook' if 'fb' in platform_val else 'Meta Ads')

            q1_ans = r[biz_idx].strip() if len(r) > biz_idx else ''
            q2_ans = r[excel_idx].strip() if len(r) > excel_idx else ''
            q3_ans = r[scale_idx].strip() if len(r) > scale_idx else ''

            name = r[name_idx].strip() if len(r) > name_idx else ''
            phone = r[phone_idx].replace('p:', '').strip() if len(r) > phone_idx else ''
            company = r[company_idx].strip() if len(r) > company_idx else ''
            email = r[email_idx].strip() if len(r) > email_idx else ''
            city = r[city_idx].strip() if len(r) > city_idx else ''

            # Strict Invariant: Skip completely empty rows from the spreadsheet
            if not name and not phone:
                continue

            raw_next_step = r[next_step_idx].strip() if len(r) > next_step_idx else ''
            raw_priority = r[priority_idx].strip().lower() if len(r) > priority_idx else ''
            sheet_update = r[updates_idx].strip() if len(r) > updates_idx else ''
            meeting_flag = r[meeting_idx].strip().upper() if len(r) > meeting_idx else ''
            call_brief = r[brief_idx].strip() if len(r) > brief_idx else ''

            # Intelligent Column Shift Detection (Meta Ingestion Misalignment Guard):
            # When Meta leads are inserted into the sheet, fields are sometimes shifted into manual columns (Col 16 & 17)
            # Col 16 (Next Step) has phone number ('p:+' or 'p:'), Col 18 (Phone) has email ('@').
            if ('p:' in raw_next_step or 'p:+' in raw_next_step) and ('@' in phone):
                real_phone = raw_next_step.replace('p:', '').strip()
                real_company = r[priority_idx].strip() if len(r) > priority_idx else ''
                real_email = phone
                real_city = company
                phone = real_phone
                company = real_company
                email = real_email
                city = real_city
                raw_next_step = ''
                raw_priority = 'unexplored'

            # Normalize Priority
            p = raw_priority
            if p not in ('low', 'medium', 'high', 'unexplored', 'won', 'lost'):
                if 'high priority' in raw_next_step.lower() or 'close' in raw_next_step.lower() or 'advance' in raw_next_step.lower():
                    p = 'high'
                elif 'low priority' in raw_next_step.lower() or 'lowest' in raw_next_step.lower():
                    p = 'low'
                elif 'lost' in raw_next_step.lower():
                    p = 'lost'
                else:
                    p = 'unexplored'

            norm_p = Repository.normalize_phone(phone)
            lead_id = phone_map.get(norm_p) or leadgen_map.get(raw_leadgen_id) or (name_map.get(name.lower()) if name else None)

            if lead_id:
                # Existing lead: enrich channel_data and ground truth notes without clobbering CRM edits
                curr_lead = Repository.get_lead(lead_id)
                curr_priority = crm_priority_map.get(lead_id) or 'unexplored'

                cd = {}
                if curr_lead and curr_lead.get('channel_data'):
                    try:
                        cd = json.loads(curr_lead['channel_data']) if isinstance(curr_lead['channel_data'], str) else dict(curr_lead['channel_data'])
                    except Exception:
                        cd = {}

                locks = cd.get('crm_locked_fields') if isinstance(cd.get('crm_locked_fields'), dict) else {}
                prev_sheet_priority = (cd.get('sheet_priority') or '').lower()
                prev_sheet_updates = cd.get('sheet_updates')
                prev_sheet_next_step = cd.get('sheet_next_step')

                if 'priority' in locks and (not prev_sheet_priority or p == prev_sheet_priority or p == 'unexplored'):
                    effective_p = curr_priority
                else:
                    effective_p = p if p != 'unexplored' else curr_priority

                cd['sheet_priority'] = p
                cd['sheet_next_step'] = raw_next_step
                cd['sheet_updates'] = sheet_update
                cd['meeting_flag'] = meeting_flag
                cd['call_brief'] = call_brief
                if ad_name and not cd.get('ad_name'):
                    cd['ad_name'] = ad_name
                if ad_id and not cd.get('ad_id'):
                    cd['ad_id'] = ad_id
                if adset_name and not cd.get('adset_name'):
                    cd['adset_name'] = adset_name
                if adset_id and not cd.get('adset_id'):
                    cd['adset_id'] = adset_id
                if campaign_name and not cd.get('campaign_name'):
                    cd['campaign_name'] = campaign_name
                if campaign_id and not cd.get('campaign_id'):
                    cd['campaign_id'] = campaign_id
                if platform and not cd.get('platform'):
                    cd['platform'] = platform
                if q3_ans:
                    if any(c.isdigit() for c in q3_ans) and '-' in q3_ans:
                        cd['employee_count'] = q3_ans
                    elif '₹' in q3_ans or 'l' in q3_ans.lower():
                        cd['monthly_revenue'] = q3_ans

                effective_next_action = curr_lead.get('next_action')
                next_action_locked = 'next_action' in locks and (prev_sheet_next_step is None or raw_next_step == prev_sheet_next_step)
                if not next_action_locked and raw_next_step and (not effective_next_action or effective_next_action.lower().startswith('review note') or effective_next_action.lower().startswith('speed to lead')):
                    effective_next_action = raw_next_step[:80]

                note_locked = 'last_update_notes' in locks and (prev_sheet_updates is None or sheet_update == prev_sheet_updates)
                if note_locked:
                    effective_last_note = curr_lead.get('last_update_notes')
                else:
                    effective_last_note = sheet_update or curr_lead.get('last_update_notes') or call_brief

                Repository._execute("""
                    UPDATE leads SET 
                        phone = CASE WHEN (length(phone) < 10 OR phone LIKE '%@%') AND length(?) >= 10 THEN ? ELSE phone END,
                        business_name = CASE WHEN (business_name IS NULL OR business_name = '' OR business_name = 'Mumbai') AND ? != '' THEN ? ELSE business_name END,
                        email = CASE WHEN (email IS NULL OR email = '') AND ? != '' THEN ? ELSE email END,
                        city = CASE WHEN (city IS NULL OR city = '') AND ? != '' THEN ? ELSE city END,
                        meta_ad_name = CASE WHEN (meta_ad_name IS NULL OR meta_ad_name = '' OR meta_ad_name LIKE 'Ad on %') AND ? != '' THEN ? ELSE meta_ad_name END,
                        priority = ?,
                        next_action = CASE WHEN next_action LIKE 'p:+%' OR next_action LIKE 'p:%' THEN 'Speed to lead call (< 5 mins)' ELSE COALESCE(?, next_action) END,
                        last_update_notes = COALESCE(?, last_update_notes),
                        channel_data = ?,
                        updated_at = ?
                    WHERE id = ?
                """, (
                    norm_p or phone, norm_p or phone,
                    company, company,
                    email, email,
                    city, city,
                    ad_name, ad_name,
                    effective_p, effective_next_action, effective_last_note, json.dumps(cd), now, lead_id
                ), commit=True)

                crm_priority_map[lead_id] = effective_p
                updated_count += 1
                breakdown[effective_p] = breakdown.get(effective_p, 0) + 1

                combined_note = ""
                if sheet_update and not sheet_update.lower().startswith("created"):
                    combined_note += f"[Sheet Update]: {sheet_update}\n"
                if call_brief:
                    combined_note += f"[Call Brief]: {call_brief}\n"

                if combined_note:
                    existing_notes = Repository._execute("SELECT content FROM notes WHERE lead_id = ? ORDER BY created_at DESC LIMIT 3", (lead_id,), fetchall=True)
                    has_note = any((sheet_update in (n.get('content') or '')) for n in existing_notes)
                    if not has_note:
                        note_id = 'note_' + uuid.uuid4().hex[:8]
                        Repository._execute("INSERT INTO notes (id, lead_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
                                            (note_id, lead_id, system_user_id, combined_note.strip(), now), commit=True)
                        notes_count += 1
            else:
                # Strict Invariant: Never create empty lead without name or phone
                if not name and not phone:
                    continue
                # New lead: create
                new_lead_id = 'lead_' + uuid.uuid4().hex[:8]
                form_answers = []
                if q1_ans:
                    form_answers.append({"question": "What does your business do?", "answer": q1_ans})
                if q3_ans:
                    form_answers.append({"question": "How many employees work in your company?", "answer": q3_ans})
                if q2_ans:
                    form_answers.append({"question": "Managing work in Excel/Tally/Paper registers?", "answer": q2_ans})

                channel_data = {
                    "campaign_name": campaign_name or "Lead Campaign - September (Quality)",
                    "ad_name": ad_name or "Ad 5:  Thinking of making Software, let it built by IITians",
                    "ad_id": ad_id,
                    "adset_name": adset_name,
                    "adset_id": adset_id,
                    "campaign_id": campaign_id,
                    "form_id": form_id or "3136433653220686",
                    "form_name": form_name or "Lead form - Higher intent",
                    "leadgen_id": raw_leadgen_id,
                    "platform": platform,
                    "sheet_priority": p,
                    "sheet_next_step": raw_next_step,
                    "sheet_updates": sheet_update,
                    "meeting_flag": meeting_flag,
                    "call_brief": call_brief,
                    "form_answers": form_answers
                }
                if q3_ans:
                    if any(c.isdigit() for c in q3_ans) and '-' in q3_ans:
                        channel_data['employee_count'] = q3_ans
                    elif '₹' in q3_ans or 'l' in q3_ans.lower():
                        channel_data['monthly_revenue'] = q3_ans

                up_low = (sheet_update + " " + raw_next_step).lower()
                effective_note = sheet_update if sheet_update and not sheet_update.lower().startswith("created") else None

                if "dnp" in up_low:
                    call_stage = "dnp"
                    next_action = "Retry call (Did Not Pick)"
                elif "busy" in up_low:
                    call_stage = "dnp"
                    next_action = "Follow-up call (prospect was busy)"
                elif "callback" in up_low or "call karna" in up_low:
                    call_stage = "follow_up"
                    next_action = raw_next_step[:80] if raw_next_step else f"Scheduled follow-up: {sheet_update[:40]}"
                elif raw_next_step:
                    call_stage = "connected"
                    next_action = raw_next_step[:80]
                elif effective_note:
                    call_stage = "connected"
                    next_action = f"Review note: {effective_note[:40]}"
                else:
                    call_stage = "uncontacted"
                    next_action = "Speed to lead call (< 5 mins)"

                temp = "hot" if p == "high" else ("warm" if p == "medium" else "cold")

                Repository._execute(
                    """INSERT INTO leads (id, name, business_name, phone, email, city, temperature, call_stage, source, status, assigned_to, 
                    meta_form_id, meta_ad_name, priority, deal_value, next_action, next_action_date, last_update_notes, 
                    channel_data, last_contacted_at, created_at, updated_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        new_lead_id, name, company, norm_p or phone, email, city,
                        temp, call_stage, "meta_ads", "new", system_user_id,
                        form_id, ad_name, p, None, next_action, None,
                        effective_note,
                        json.dumps(channel_data), None, created_time or now, now
                    ),
                    commit=True
                )

                if effective_note:
                    note_id = 'note_' + uuid.uuid4().hex[:8]
                    Repository._execute("INSERT INTO notes (id, lead_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
                                        (note_id, new_lead_id, system_user_id, effective_note, now), commit=True)

                if norm_p:
                    phone_map[norm_p] = new_lead_id
                if raw_leadgen_id:
                    leadgen_map[raw_leadgen_id] = new_lead_id
                if name:
                    name_map[name.lower()] = new_lead_id

                created_count += 1
                try:
                    Repository.generate_lead_task(new_lead_id)
                except Exception:
                    pass

        msg_parts = [f"Synced {updated_count} lead priorities"]
        if created_count > 0:
            msg_parts.append(f"created {created_count} new Meta leads")
        if notes_count > 0:
            msg_parts.append(f"added {notes_count} updates")

        return {
            "status": "success",
            "updated": updated_count,
            "created": created_count,
            "notes": notes_count,
            "total_sheet_rows": len(rows) - 1,
            "breakdown": breakdown,
            "message": ", ".join(msg_parts) + " from Google Sheet"
        }

    @staticmethod
    def generate_lead_task(lead_id: str):
        from backend.ai_scheduler import generate_lead_task as ai_gen_task
        lead = Repository.get_lead(lead_id)
        if not lead:
            return None
        notes = Repository._execute("SELECT content, created_at FROM notes WHERE lead_id = ? ORDER BY created_at DESC LIMIT 5", (lead_id,), fetchall=True)
        calls = Repository._execute("SELECT notes, outcome, called_at FROM call_logs WHERE lead_id = ? ORDER BY called_at DESC LIMIT 5", (lead_id,), fetchall=True)
        wa_messages = Repository._execute("SELECT message_text, direction, timestamp FROM whatsapp_messages WHERE lead_id = ? ORDER BY timestamp DESC LIMIT 8", (lead_id,), fetchall=True)
        
        task_info = ai_gen_task(lead, notes=notes, calls=calls, wa_messages=wa_messages)
        Repository.update_lead(lead_id, {
            "next_action": task_info.get("task"),
            "next_action_date": task_info.get("deadline"),
            "next_action_priority": task_info.get("priority", "medium")
        })
        return Repository.get_lead(lead_id)

    @staticmethod
    def generate_all_lead_tasks():
        leads = Repository._execute("SELECT id FROM leads", fetchall=True)
        updated = 0
        for l in leads:
            Repository.generate_lead_task(l["id"])
            updated += 1
        return {"status": "success", "updated": updated, "message": f"Generated AI next tasks for {updated} leads"}

    @staticmethod
    def get_daily_battle_plan(max_daily_capacity: int = 50):
        """Generate capital-per-unit-time daily battle plan via SchedulingEngine."""
        from backend.services.scheduling_engine import SchedulingEngine
        leads = Repository.list_leads({})
        
        notes_by_lead = {}
        for n in Repository._execute("SELECT lead_id, content, created_at FROM notes ORDER BY created_at DESC", fetchall=True):
            notes_by_lead.setdefault(n["lead_id"], []).append(n)
            
        calls_by_lead = {}
        for c in Repository._execute("SELECT lead_id, notes, outcome, called_at FROM call_logs ORDER BY called_at DESC", fetchall=True):
            calls_by_lead.setdefault(c["lead_id"], []).append(c)
            
        group_msgs_by_lead = {}
        try:
            for g in Repository._execute("SELECT linked_lead_id, message_text, sender_name, timestamp FROM zero7_group_messages WHERE linked_lead_id IS NOT NULL ORDER BY timestamp DESC", fetchall=True):
                group_msgs_by_lead.setdefault(g["linked_lead_id"], []).append(g)
        except Exception:
            pass

        return SchedulingEngine.generate_daily_battle_plan(
            leads,
            notes_by_lead=notes_by_lead,
            calls_by_lead=calls_by_lead,
            group_msgs_by_lead=group_msgs_by_lead,
            max_daily_capacity=max_daily_capacity
        )

    # --- Google Tasks Methods ---
    @staticmethod
    def get_google_tasks_config():
        return Repository._execute("SELECT * FROM google_tasks_config WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1", fetchone=True)

    @staticmethod
    def save_google_tasks_config(data: dict):
        now = Repository.now()
        cfg = Repository.get_google_tasks_config()
        if cfg:
            Repository._execute("""
                UPDATE google_tasks_config SET
                    client_id = COALESCE(?, client_id),
                    client_secret = COALESCE(?, client_secret),
                    access_token = COALESCE(?, access_token),
                    refresh_token = COALESCE(?, refresh_token),
                    token_expiry = COALESCE(?, token_expiry),
                    task_list_id = COALESCE(?, task_list_id),
                    task_list_title = COALESCE(?, task_list_title),
                    is_active = COALESCE(?, is_active),
                    auto_sync = COALESCE(?, auto_sync),
                    updated_at = ?
                WHERE id = ?
            """, (
                data.get('client_id'), data.get('client_secret'), data.get('access_token'),
                data.get('refresh_token'), data.get('token_expiry'), data.get('task_list_id'),
                data.get('task_list_title'), data.get('is_active'), data.get('auto_sync'),
                now, cfg['id']
            ), commit=True)
            return Repository._execute("SELECT * FROM google_tasks_config WHERE id = ?", (cfg['id'],), fetchone=True)
        else:
            cfg_id = 'gtasks_' + uuid.uuid4().hex[:8]
            Repository._execute("""
                INSERT INTO google_tasks_config (id, user_id, client_id, client_secret, access_token, refresh_token, token_expiry, task_list_id, task_list_title, is_active, auto_sync, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                cfg_id, data.get('user_id', 'global'), data.get('client_id'), data.get('client_secret'),
                data.get('access_token'), data.get('refresh_token'), data.get('token_expiry'),
                data.get('task_list_id'), data.get('task_list_title', 'Zero7 CRM Leads'),
                data.get('is_active', 1), data.get('auto_sync', 1), now, now
            ), commit=True)
            return Repository._execute("SELECT * FROM google_tasks_config WHERE id = ?", (cfg_id,), fetchone=True)

    @staticmethod
    def update_lead_google_task_id(lead_id: str, google_task_id: str):
        Repository._execute("UPDATE leads SET google_task_id = ? WHERE id = ?", (google_task_id, lead_id), commit=True)

    @staticmethod
    def disconnect_google_tasks():
        Repository._execute("UPDATE google_tasks_config SET is_active = 0, access_token = NULL, refresh_token = NULL", commit=True)
        return {"status": "success", "message": "Google Tasks disconnected"}

    # --- AI Company Briefs ---
    @staticmethod
    def get_company_brief(lead_id: str):
        brief = Repository._execute("SELECT * FROM company_briefs WHERE lead_id = ?", (lead_id,), fetchone=True)
        if brief and brief.get('industry_tags'):
            try:
                brief['industry_tags'] = json.loads(brief['industry_tags'])
            except Exception:
                brief['industry_tags'] = [brief['industry_tags']]
        return brief

    @staticmethod
    def save_company_brief(lead_id: str, data: dict):
        now = Repository.now()
        existing = Repository.get_company_brief(lead_id)
        industry_tags_str = json.dumps(data.get('industry_tags', [])) if isinstance(data.get('industry_tags'), list) else data.get('industry_tags', '[]')
        
        if existing:
            Repository._execute("""
                UPDATE company_briefs SET
                    executive_summary = ?,
                    operational_bottlenecks = ?,
                    zero7_opportunity = ?,
                    recommended_tech = ?,
                    estimated_budget = ?,
                    pitch_hook = ?,
                    industry_tags = ?,
                    raw_json = ?,
                    status = ?,
                    updated_at = ?
                WHERE lead_id = ?
            """, (
                data.get('executive_summary'),
                data.get('operational_bottlenecks'),
                data.get('zero7_opportunity'),
                data.get('recommended_tech'),
                data.get('estimated_budget'),
                data.get('pitch_hook'),
                industry_tags_str,
                data.get('raw_json'),
                data.get('status', 'completed'),
                now, lead_id
            ), commit=True)
            return Repository.get_company_brief(lead_id)
        else:
            brief_id = 'brief_' + uuid.uuid4().hex[:8]
            Repository._execute("""
                INSERT INTO company_briefs (
                    id, lead_id, executive_summary, operational_bottlenecks, zero7_opportunity,
                    recommended_tech, estimated_budget, pitch_hook, industry_tags, raw_json, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                brief_id, lead_id,
                data.get('executive_summary'),
                data.get('operational_bottlenecks'),
                data.get('zero7_opportunity'),
                data.get('recommended_tech'),
                data.get('estimated_budget'),
                data.get('pitch_hook'),
                industry_tags_str,
                data.get('raw_json'),
                data.get('status', 'completed'),
                now, now
            ), commit=True)
            return Repository.get_company_brief(lead_id)

    # Prototype delegations
    get_lead_prototypes = PrototypeRepository.get_lead_prototypes
    get_prototype_by_id = PrototypeRepository.get_prototype_by_id
    get_prototype_by_token = PrototypeRepository.get_prototype_by_token
    save_prototype = PrototypeRepository.save_prototype
    increment_prototype_views = PrototypeRepository.increment_prototype_views

    # ==================== ANTIGRAVITY AGENT JOBS ====================

    @staticmethod
    def create_agent_job(data: dict):
        job_id = 'job_' + uuid.uuid4().hex[:10]
        now = Repository.now()
        rep_ctx = data.get('rep_context', '{}')
        if isinstance(rep_ctx, (dict, list)):
            rep_ctx = json.dumps(rep_ctx)

        Repository._execute("""
            INSERT INTO agent_jobs (
                id, lead_id, client_id, project_name, project_path, project_id, prompt, status, conversation_id, model, role, agent_slug, stream_output, thoughts, artifacts, error_message, rep_context, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            job_id,
            data.get('lead_id'),
            data.get('client_id'),
            data.get('project_name'),
            data.get('project_path'),
            data.get('project_id'),
            data.get('prompt'),
            'pending',
            data.get('conversation_id'),
            data.get('model', 'flash'),
            data.get('role', 'engineer'),
            data.get('agent_slug', 'prototype_maker'),
            '',
            '',
            '[]',
            '',
            rep_ctx,
            now, now
        ), commit=True)
        return Repository.get_agent_job(job_id)

    @staticmethod
    def get_agent_job(job_id: str):
        job = Repository._execute("SELECT * FROM agent_jobs WHERE id = ?", (job_id,), fetchone=True)
        if job:
            if job.get('artifacts'):
                try:
                    job['artifacts'] = json.loads(job['artifacts'])
                except Exception:
                    job['artifacts'] = []
            if job.get('rep_context'):
                try:
                    job['rep_context'] = json.loads(job['rep_context'])
                except Exception:
                    job['rep_context'] = {}
        return job

    @staticmethod
    def get_lead_agent_jobs(lead_id: str):
        jobs = Repository._execute("SELECT * FROM agent_jobs WHERE lead_id = ? ORDER BY created_at ASC", (lead_id,), fetchall=True)
        for job in jobs:
            if job.get('artifacts'):
                try:
                    job['artifacts'] = json.loads(job['artifacts'])
                except Exception:
                    job['artifacts'] = []
            if job.get('rep_context'):
                try:
                    job['rep_context'] = json.loads(job['rep_context'])
                except Exception:
                    job['rep_context'] = {}
        return jobs

    @staticmethod
    def get_prototype_rep_context(lead_id: str) -> dict:
        row = Repository._execute("SELECT prototype_rep_context FROM leads WHERE id = ?", (lead_id,), fetchone=True)
        if row and row.get("prototype_rep_context"):
            raw = row["prototype_rep_context"]
            if isinstance(raw, dict):
                return raw
            try:
                return json.loads(raw)
            except Exception:
                return {}
        return {}

    @staticmethod
    def save_prototype_rep_context(lead_id: str, context: dict) -> dict:
        ctx_str = json.dumps(context) if isinstance(context, dict) else str(context)
        Repository._execute("UPDATE leads SET prototype_rep_context = ?, updated_at = ? WHERE id = ?", (ctx_str, Repository.now(), lead_id), commit=True)
        return context

    @staticmethod
    def get_agent_runs(agent_slug: Optional[str] = None, limit: int = 50):
        if agent_slug:
            query = """
                SELECT j.*, l.name as lead_name, l.business_name as business_name, l.business_name as lead_business_name, l.phone as lead_phone, l.city as lead_city
                FROM agent_jobs j
                LEFT JOIN leads l ON j.lead_id = l.id
                WHERE j.agent_slug = ? OR j.role = ?
                ORDER BY j.created_at DESC
                LIMIT ?
            """
            jobs = Repository._execute(query, (agent_slug, agent_slug, limit), fetchall=True)
        else:
            query = """
                SELECT j.*, l.name as lead_name, l.business_name as business_name, l.business_name as lead_business_name, l.phone as lead_phone, l.city as lead_city
                FROM agent_jobs j
                LEFT JOIN leads l ON j.lead_id = l.id
                ORDER BY j.created_at DESC
                LIMIT ?
            """
            jobs = Repository._execute(query, (limit,), fetchall=True)

        for job in jobs:
            if job.get('artifacts'):
                try:
                    job['artifacts'] = json.loads(job['artifacts'])
                except Exception:
                    job['artifacts'] = []
        return jobs

    @staticmethod
    def get_lead_latest_conversation_id(lead_id: str):
        row = Repository._execute(
            "SELECT conversation_id FROM agent_jobs WHERE lead_id = ? AND conversation_id IS NOT NULL AND conversation_id != '' ORDER BY created_at DESC LIMIT 1",
            (lead_id,),
            fetchone=True
        )
        return row['conversation_id'] if row else None

    @staticmethod
    def claim_pending_agent_job():
        job = Repository._execute("SELECT * FROM agent_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1", fetchone=True)
        if not job:
            return None
        now = Repository.now()
        Repository._execute("UPDATE agent_jobs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'", (now, job['id']), commit=True)
        return Repository.get_agent_job(job['id'])

    @staticmethod
    def update_agent_job_stream(job_id: str, stream_output: str = None, thoughts: str = None, conversation_id: str = None):
        now = Repository.now()
        updates = ["updated_at = ?", "status = CASE WHEN status = 'pending' THEN 'running' ELSE status END"]
        params = [now]
        if stream_output is not None:
            updates.append("stream_output = ?")
            params.append(stream_output)
        if thoughts is not None:
            updates.append("thoughts = ?")
            params.append(thoughts)
        if conversation_id is not None:
            updates.append("conversation_id = ?")
            params.append(conversation_id)
        params.append(job_id)
        sql = f"UPDATE agent_jobs SET {', '.join(updates)} WHERE id = ?"
        Repository._execute(sql, tuple(params), commit=True)

    @staticmethod
    def complete_agent_job(job_id: str, status: str, stream_output: str = None, thoughts: str = None, error_message: str = None, conversation_id: str = None, artifacts: list = None):
        now = Repository.now()
        artifacts_str = json.dumps(artifacts or [])
        Repository._execute("""
            UPDATE agent_jobs SET
                status = ?,
                stream_output = COALESCE(?, stream_output),
                thoughts = COALESCE(?, thoughts),
                error_message = COALESCE(?, error_message),
                conversation_id = COALESCE(?, conversation_id),
                artifacts = ?,
                updated_at = ?,
                completed_at = ?
            WHERE id = ?
        """, (
            status, stream_output, thoughts, error_message, conversation_id, artifacts_str, now, now, job_id
        ), commit=True)
        return Repository.get_agent_job(job_id)

    @staticmethod
    def record_worker_heartbeat(
        worker_id: str = 'local_host',
        metadata: dict = None,
        machine_name: str = None,
        user_email: str = None,
        user_name: str = None,
        os_info: str = None,
        ip_address: str = None,
        install_path: str = None,
        projects_root: str = None,
        device_token: str = None
    ):
        now = Repository.now()
        meta_str = json.dumps(metadata or {})

        # 1. STRICT AUTHENTICATED USER CHECK:
        # A device can ONLY be attached if user_email is a genuine registered Zero7 CRM user.
        # Rejects fabricated OS usernames (e.g. m_hit@zero7.space) or unassigned dummy entries.
        if not user_email or user_email.lower() in ('unassigned', 'm_hit@zero7.space', 'unknown@zero7.space'):
            return False

        user = Repository.get_user_by_email(user_email)
        if not user:
            return False

        real_user_name = user.get('name') or user_name or 'Zero7 Team'
        real_user_email = user['email']

        Repository._execute("""
            INSERT INTO agent_worker_heartbeats (
                worker_id, last_seen, status, metadata, machine_name, user_email, user_name, os_info, ip_address,
                install_path, projects_root, device_token, is_paired
            )
            VALUES (?, ?, 'online', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(worker_id) DO UPDATE SET
                last_seen = excluded.last_seen,
                status = 'online',
                metadata = excluded.metadata,
                machine_name = COALESCE(excluded.machine_name, agent_worker_heartbeats.machine_name),
                user_email = excluded.user_email,
                user_name = excluded.user_name,
                os_info = COALESCE(excluded.os_info, agent_worker_heartbeats.os_info),
                ip_address = COALESCE(excluded.ip_address, agent_worker_heartbeats.ip_address),
                install_path = COALESCE(excluded.install_path, agent_worker_heartbeats.install_path),
                projects_root = COALESCE(excluded.projects_root, agent_worker_heartbeats.projects_root),
                device_token = COALESCE(excluded.device_token, agent_worker_heartbeats.device_token),
                is_paired = 1
        """, (worker_id, now, meta_str, machine_name, real_user_email, real_user_name, os_info, ip_address,
              install_path, projects_root, device_token), commit=True)

        # 2. Machine deduplication: purge superseded worker registrations with the same machine_name
        if machine_name and machine_name.lower() != 'local_host':
            Repository._execute(
                "DELETE FROM agent_worker_heartbeats WHERE LOWER(machine_name) = LOWER(?) AND worker_id != ?",
                (machine_name, worker_id),
                commit=True
            )
            # Purge mock/unassigned local_host and phantom unlinked accounts
            Repository._execute(
                "DELETE FROM agent_worker_heartbeats WHERE worker_id = 'local_host' OR user_email = 'unassigned' OR user_email = 'm_hit@zero7.space'",
                commit=True
            )
        return True

    @staticmethod
    def delete_worker_heartbeat(worker_id: str):
        """Deletes a worker record by worker_id."""
        Repository._execute("DELETE FROM agent_worker_heartbeats WHERE worker_id = ?", (worker_id,), commit=True)
        return {"status": "success", "deleted_worker_id": worker_id}

    @staticmethod
    def prune_stale_workers(max_age_hours: int = 48):
        """Prunes worker records older than max_age_hours, unlinked ghost accounts, or duplicate machine registrations."""
        import datetime
        now_dt = datetime.datetime.now(datetime.timezone.utc)
        
        # Purge unauthenticated or phantom user accounts
        Repository._execute("""
            DELETE FROM agent_worker_heartbeats 
            WHERE worker_id = 'local_host' 
               OR user_email IS NULL 
               OR user_email = 'unassigned' 
               OR user_email = 'm_hit@zero7.space'
               OR LOWER(user_email) NOT IN (SELECT LOWER(email) FROM users)
        """, commit=True)

        rows = Repository._execute("SELECT worker_id, machine_name, last_seen FROM agent_worker_heartbeats ORDER BY last_seen DESC", fetchall=True)
        pruned = []
        seen_machines = set()

        for r in (rows or []):
            wid = r['worker_id']
            mname = (r.get('machine_name') or wid).strip().lower()
            should_delete = False

            if mname in seen_machines:
                should_delete = True
            else:
                try:
                    last_dt = datetime.datetime.fromisoformat(r['last_seen'].replace('Z', '+00:00'))
                    if (now_dt - last_dt).total_seconds() > (max_age_hours * 3600):
                        should_delete = True
                except Exception:
                    pass

            if should_delete:
                Repository._execute("DELETE FROM agent_worker_heartbeats WHERE worker_id = ?", (wid,), commit=True)
                pruned.append(wid)
            else:
                seen_machines.add(mname)

        return {"status": "success", "pruned_workers": pruned, "pruned_count": len(pruned)}

    @staticmethod
    def list_all_workers():
        # Clean up phantom unauthenticated records on every listing
        Repository._execute("""
            DELETE FROM agent_worker_heartbeats 
            WHERE worker_id = 'local_host' 
               OR user_email IS NULL 
               OR user_email = 'unassigned' 
               OR user_email = 'm_hit@zero7.space'
               OR LOWER(user_email) NOT IN (SELECT LOWER(email) FROM users)
        """, commit=True)

        rows = Repository._execute("SELECT * FROM agent_worker_heartbeats ORDER BY last_seen DESC", fetchall=True)
        import datetime
        workers = []
        seen_machines = set()

        for r in (rows or []):
            wid = r['worker_id']
            mname_raw = r.get('machine_name') or wid
            mname_key = mname_raw.strip().lower()

            # Deduplicate by physical machine name (keep newest by last_seen)
            if mname_key in seen_machines:
                continue
            seen_machines.add(mname_key)

            try:
                last_dt = datetime.datetime.fromisoformat(r['last_seen'].replace('Z', '+00:00'))
                now_dt = datetime.datetime.now(datetime.timezone.utc) if last_dt.tzinfo else datetime.datetime.utcnow()
                diff_secs = (now_dt - last_dt).total_seconds()
                is_online = diff_secs < 60
            except Exception:
                is_online = False
                diff_secs = None
            meta = {}
            if r.get('metadata'):
                try:
                    meta = json.loads(r['metadata'])
                except Exception:
                    pass
            workers.append({
                "worker_id": r['worker_id'],
                "machine_name": mname_raw,
                "user_email": r.get('user_email') or "unassigned",
                "user_name": r.get('user_name') or "Zero7 Team",
                "os_info": r.get('os_info') or "Windows",
                "ip_address": r.get('ip_address'),
                "install_path": r.get('install_path'),
                "projects_root": r.get('projects_root'),
                "status": "online" if is_online else "offline",
                "last_seen": r['last_seen'],
                "diff_seconds": int(diff_secs) if diff_secs is not None else None,
                "metadata": meta
            })
        return workers

    @staticmethod
    def get_worker_status(worker_id: str = 'local_host'):
        row = None
        if worker_id and worker_id != 'local_host':
            row = Repository._execute("SELECT * FROM agent_worker_heartbeats WHERE worker_id = ?", (worker_id,), fetchone=True)
        if not row:
            row = Repository._execute("SELECT * FROM agent_worker_heartbeats ORDER BY last_seen DESC LIMIT 1", fetchone=True)
        if not row:
            return {"online": False, "last_seen": None, "metadata": {}}
        import datetime
        try:
            last_dt = datetime.datetime.fromisoformat(row['last_seen'].replace('Z', '+00:00'))
            now_dt = datetime.datetime.now(datetime.timezone.utc) if last_dt.tzinfo else datetime.datetime.utcnow()
            diff_secs = (now_dt - last_dt).total_seconds()
            is_online = diff_secs < 75
        except Exception:
            is_online = False
            diff_secs = None

        meta = {}
        if row.get('metadata'):
            try:
                meta = json.loads(row['metadata'])
            except Exception:
                pass
        return {
            "online": is_online,
            "worker_id": row.get('worker_id'),
            "last_seen": row['last_seen'],
            "diff_seconds": diff_secs,
            "metadata": meta,
            "machine_name": row.get('machine_name'),
            "user_email": row.get('user_email'),
            "user_name": row.get('user_name')
        }

    @staticmethod
    def save_conversation_transcript(conv_id: str, project_id: str, messages: list):
        now = Repository.now()
        msgs_str = json.dumps(messages)
        Repository._execute("""
            INSERT INTO agent_conversation_transcripts (conversation_id, project_id, messages, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(conversation_id) DO UPDATE SET
                project_id = CASE WHEN excluded.project_id IS NOT NULL AND excluded.project_id != '' THEN excluded.project_id ELSE agent_conversation_transcripts.project_id END,
                messages = excluded.messages,
                updated_at = excluded.updated_at
        """, (conv_id, project_id or '', msgs_str, now), commit=True)

    @staticmethod
    def get_conversation_transcript(conv_id: str):
        row = Repository._execute("SELECT * FROM agent_conversation_transcripts WHERE conversation_id = ?", (conv_id,), fetchone=True)
        if not row:
            return None
        msgs = []
        if row.get('messages'):
            try:
                msgs = json.loads(row['messages'])
            except Exception:
                msgs = []
        return {
            "conversation_id": conv_id,
            "project_id": row.get('project_id'),
            "updated_at": row.get('updated_at'),
            "messages": msgs
        }

    @staticmethod
    def queue_worker_command(command_type: str, payload: dict):
        cmd_id = 'cmd_' + uuid.uuid4().hex[:8]
        now = Repository.now()
        Repository._execute(
            "INSERT INTO agent_worker_commands (id, command_type, payload, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
            (cmd_id, command_type, json.dumps(payload), now), commit=True
        )
        return cmd_id

    @staticmethod
    def pop_pending_worker_command():
        row = Repository._execute("SELECT * FROM agent_worker_commands WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1", fetchone=True)
        if not row:
            return None
        Repository._execute("UPDATE agent_worker_commands SET status = 'claimed' WHERE id = ?", (row['id'],), commit=True)
        try:
            payload = json.loads(row['payload'])
        except Exception:
            payload = {}
        payload['command_id'] = row['id']
        payload['type'] = row['command_type']
        return payload

    # ── Agent Studio & Governance Registry ──

    @staticmethod
    def list_agents():
        rows = Repository._execute("SELECT * FROM agent_definitions ORDER BY name ASC", fetchall=True) or []
        res = []
        for r in rows:
            item = dict(r)
            for f in ['default_pills', 'assigned_skills', 'mcp_servers']:
                if item.get(f):
                    try:
                        item[f] = json.loads(item[f])
                    except Exception:
                        item[f] = []
                else:
                    item[f] = []
            res.append(item)
        return res

    @staticmethod
    def get_agent(slug_or_id: str):
        row = Repository._execute(
            "SELECT * FROM agent_definitions WHERE id = ? OR slug = ?",
            (slug_or_id, slug_or_id), fetchone=True
        )
        if not row:
            return None
        item = dict(row)
        for f in ['default_pills', 'assigned_skills', 'mcp_servers']:
            if item.get(f):
                try:
                    item[f] = json.loads(item[f])
                except Exception:
                    item[f] = []
            else:
                item[f] = []
        return item

    @staticmethod
    def save_agent(data: dict):
        slug = data.get('slug')
        if not slug:
            slug = re.sub(r'[^a-z0-9]+', '_', data.get('name', 'agent').lower()).strip('_')
        
        existing = Repository.get_agent(slug)
        now = Repository.now()
        
        default_pills = json.dumps(data.get('default_pills') or [])
        assigned_skills = json.dumps(data.get('assigned_skills') or [])
        mcp_servers = json.dumps(data.get('mcp_servers') or [])
        fallback_model = data.get('fallback_model', 'none')
        role = data.get('role', 'engineer')
        
        if existing:
            Repository._execute("""
                UPDATE agent_definitions SET
                    name = ?, role = ?, description = ?, model = ?, fallback_model = ?,
                    system_prompt = ?, default_pills = ?, assigned_skills = ?, mcp_servers = ?,
                    autonomy_level = ?, is_active = ?, updated_at = ?
                WHERE id = ?
            """, (
                data.get('name', existing['name']),
                role,
                data.get('description', existing['description']),
                data.get('model', existing['model']),
                fallback_model,
                data.get('system_prompt', existing['system_prompt']),
                default_pills, assigned_skills, mcp_servers,
                data.get('autonomy_level', existing['autonomy_level']),
                int(data.get('is_active', existing['is_active'])),
                now, existing['id']
            ), commit=True)
            return Repository.get_agent(existing['id'])
        else:
            agent_id = 'agent_' + uuid.uuid4().hex[:8]
            Repository._execute("""
                INSERT INTO agent_definitions (
                    id, name, slug, role, description, model, fallback_model, system_prompt,
                    default_pills, assigned_skills, mcp_servers, autonomy_level,
                    is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                agent_id, data.get('name', 'New Agent'), slug, role,
                data.get('description', ''), data.get('model', 'pro'),
                fallback_model,
                data.get('system_prompt', ''), default_pills,
                assigned_skills, mcp_servers,
                data.get('autonomy_level', 'approval_required'),
                int(data.get('is_active', 1)), now, now
            ), commit=True)
            return Repository.get_agent(agent_id)

    @staticmethod
    def list_skills():
        rows = Repository._execute("SELECT * FROM skills_registry ORDER BY name ASC", fetchall=True) or []
        res = []
        for r in rows:
            item = dict(r)
            if item.get('scripts'):
                try:
                    item['scripts'] = json.loads(item['scripts'])
                except Exception:
                    item['scripts'] = {}
            else:
                item['scripts'] = {}
            res.append(item)
        return res

    @staticmethod
    def get_skill(slug_or_id: str):
        row = Repository._execute(
            "SELECT * FROM skills_registry WHERE id = ? OR slug = ?",
            (slug_or_id, slug_or_id), fetchone=True
        )
        if not row:
            return None
        item = dict(row)
        if item.get('scripts'):
            try:
                item['scripts'] = json.loads(item['scripts'])
            except Exception:
                item['scripts'] = {}
        else:
            item['scripts'] = {}
        return item

    @staticmethod
    def save_skill(data: dict):
        slug = data.get('slug')
        if not slug:
            slug = re.sub(r'[^a-z0-9_\-]+', '-', data.get('name', 'skill').lower()).strip('-')
        
        existing = Repository.get_skill(slug)
        now = Repository.now()
        scripts = json.dumps(data.get('scripts') or {})
        
        if existing:
            Repository._execute("""
                UPDATE skills_registry SET
                    name = ?, description = ?, skill_md_content = ?, scripts = ?
                WHERE id = ?
            """, (
                data.get('name', existing['name']),
                data.get('description', existing['description']),
                data.get('skill_md_content', existing['skill_md_content']),
                scripts, existing['id']
            ), commit=True)
            return Repository.get_skill(existing['id'])
        else:
            skill_id = 'skill_' + uuid.uuid4().hex[:8]
            Repository._execute("""
                INSERT INTO skills_registry (id, slug, name, description, skill_md_content, scripts, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                skill_id, slug, data.get('name', 'New Skill'),
                data.get('description', ''), data.get('skill_md_content', ''),
                scripts, now
            ), commit=True)
            return Repository.get_skill(skill_id)

    @staticmethod
    def delete_skill(slug_or_id: str):
        Repository._execute("DELETE FROM skills_registry WHERE id = ? OR slug = ?", (slug_or_id, slug_or_id), commit=True)
        return True

    # ── Custom Data Pills Registry ──

    @staticmethod
    def list_custom_data_pills():
        rows = Repository._execute("SELECT * FROM custom_data_pills ORDER BY tag ASC", fetchall=True) or []
        return [dict(r) for r in rows]

    @staticmethod
    def save_custom_data_pill(data: dict):
        tag = (data.get('tag') or '').strip()
        if not tag.startswith('@'):
            tag = '@' + tag
        tag = re.sub(r'[^a-zA-Z0-9_.-]+', '_', tag)
        
        now = Repository.now()
        existing = Repository._execute("SELECT * FROM custom_data_pills WHERE tag = ?", (tag,), fetchone=True)
        
        if existing:
            Repository._execute("""
                UPDATE custom_data_pills SET
                    label = ?, category = ?, description = ?, source_type = ?, resolver_payload = ?
                WHERE id = ?
            """, (
                data.get('label', existing['label']),
                data.get('category', existing['category']),
                data.get('description', existing['description']),
                data.get('source_type', existing['source_type']),
                data.get('resolver_payload', existing['resolver_payload']),
                existing['id']
            ), commit=True)
            row = Repository._execute("SELECT * FROM custom_data_pills WHERE id = ?", (existing['id'],), fetchone=True)
            return dict(row) if row else None
        else:
            pill_id = 'pill_' + uuid.uuid4().hex[:8]
            Repository._execute("""
                INSERT INTO custom_data_pills (
                    id, tag, label, category, description, source_type, resolver_payload, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                pill_id, tag,
                data.get('label', tag),
                data.get('category', 'Custom Context'),
                data.get('description', ''),
                data.get('source_type', 'vault'),
                data.get('resolver_payload', ''),
                now
            ), commit=True)
            row = Repository._execute("SELECT * FROM custom_data_pills WHERE id = ?", (pill_id,), fetchone=True)
            return dict(row) if row else None

    @staticmethod
    def delete_custom_data_pill(pill_id: str):
        Repository._execute("DELETE FROM custom_data_pills WHERE id = ? OR tag = ?", (pill_id, pill_id), commit=True)
        return True

    @staticmethod
    def list_mcp_servers():
        rows = Repository._execute("SELECT * FROM mcp_servers ORDER BY name ASC", fetchall=True) or []
        res = []
        for r in rows:
            item = dict(r)
            if item.get('config'):
                try:
                    item['config'] = json.loads(item['config'])
                except Exception:
                    item['config'] = {}
            else:
                item['config'] = {}
            res.append(item)
        return res

    @staticmethod
    def save_mcp_server(data: dict):
        srv_id = data.get('id')
        now = Repository.now()
        config = json.dumps(data.get('config') or {})
        
        if srv_id:
            Repository._execute("""
                UPDATE mcp_servers SET name = ?, server_type = ?, config = ?, is_active = ?
                WHERE id = ?
            """, (
                data.get('name'), data.get('server_type', 'sse'), config,
                int(data.get('is_active', 1)), srv_id
            ), commit=True)
            row = Repository._execute("SELECT * FROM mcp_servers WHERE id = ?", (srv_id,), fetchone=True)
        else:
            new_id = 'mcp_' + uuid.uuid4().hex[:8]
            Repository._execute("""
                INSERT INTO mcp_servers (id, name, server_type, config, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                new_id, data.get('name', 'New MCP Server'), data.get('server_type', 'sse'),
                config, int(data.get('is_active', 1)), now
            ), commit=True)
            row = Repository._execute("SELECT * FROM mcp_servers WHERE id = ?", (new_id,), fetchone=True)
        
        if row:
            d = dict(row)
            d['config'] = json.loads(d['config']) if d.get('config') else {}
            return d
        return None

    # ── Action Queue (Human-in-the-Loop) ──

    @staticmethod
    def stage_action(lead_id=None, agent_slug=None, action_type=None, payload=None, **kwargs):
        if isinstance(lead_id, dict):
            d = lead_id
            lead_id = d.get('lead_id')
            agent_slug = d.get('agent_slug') or 'master_orchestrator'
            action_type = d.get('action_type')
            payload = d.get('payload')
        else:
            agent_slug = agent_slug or 'master_orchestrator'
        act_id = 'act_' + uuid.uuid4().hex[:8]
        now = Repository.now()
        Repository._execute("""
            INSERT INTO agent_actions (id, lead_id, agent_slug, action_type, payload, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'pending_approval', ?)
        """, (act_id, lead_id, agent_slug, action_type, json.dumps(payload or {}), now), commit=True)
        return Repository.get_action(act_id)

    @staticmethod
    def get_action(action_id: str):
        row = Repository._execute("SELECT * FROM agent_actions WHERE id = ?", (action_id,), fetchone=True)
        if not row:
            return None
        d = dict(row)
        if d.get('payload'):
            try:
                d['payload'] = json.loads(d['payload'])
            except Exception:
                pass
        return d

    @staticmethod
    def list_actions(lead_id: str = None, status: str = None):
        q = "SELECT a.*, l.name as lead_name, l.business_name as lead_business FROM agent_actions a LEFT JOIN leads l ON a.lead_id = l.id WHERE 1=1"
        params = []
        if lead_id:
            q += " AND a.lead_id = ?"
            params.append(lead_id)
        if status:
            q += " AND a.status = ?"
            params.append(status)
        q += " ORDER BY a.created_at DESC"
        rows = Repository._execute(q, tuple(params), fetchall=True) or []
        res = []
        for r in rows:
            d = dict(r)
            if d.get('payload'):
                try:
                    d['payload'] = json.loads(d['payload'])
                except Exception:
                    pass
            res.append(d)
        return res

    @staticmethod
    def transition_action_status_if_not_final(
        action_id: str,
        new_status: str,
        reviewed_by: str = None,
        result: str = None,
        final_statuses=("approved", "rejected"),
    ):
        """
        Atomically transition an action only if it is not already finalized.
        Prevents double-approvals, double-rejections, and race conditions.
        """
        action = Repository.get_action(action_id)
        if not action:
            return {"state": "not_found", "action": None}

        current_status = str(action.get("status") or "pending").strip().lower()
        norm_final_statuses = tuple(str(s).strip().lower() for s in final_statuses)

        if current_status in norm_final_statuses:
            return {"state": "already_finalized", "action": action}

        now = Repository.now()
        set_parts = ["status = ?"]
        params = [new_status]

        if reviewed_by is not None:
            set_parts.append("reviewed_by = ?")
            params.append(reviewed_by)

        set_parts.append("reviewed_at = ?")
        params.append(now)

        if result is not None:
            set_parts.append("result = ?")
            params.append(result)

        final_placeholders = ", ".join(["?"] * len(norm_final_statuses))
        sql = f"""
            UPDATE agent_actions
            SET {", ".join(set_parts)}
            WHERE id = ?
              AND LOWER(COALESCE(status, 'pending')) NOT IN ({final_placeholders})
        """
        params.append(action_id)
        params.extend(norm_final_statuses)

        rowcount = Repository._execute(
            sql,
            tuple(params),
            commit=True,
            return_rowcount=True,
        )

        updated = Repository.get_action(action_id)
        if rowcount == 1:
            return {"state": "updated", "action": updated}

        return {"state": "already_finalized", "action": updated or action}

    @staticmethod
    def update_action_status(action_id: str, status: str, reviewed_by: str = None, result: str = None):
        now = Repository.now()
        Repository._execute("""
            UPDATE agent_actions SET status = ?, reviewed_by = ?, reviewed_at = ?, result = COALESCE(?, result) WHERE id = ?
        """, (status, reviewed_by or 'founder', now, result, action_id), commit=True)
        return Repository.get_action(action_id)

    @staticmethod
    def seed_default_agents_and_skills():
        # 1. Seed Subdomain Provisioner Skill
        subdomain_skill = Repository.get_skill('subdomain-provisioner')
        if not subdomain_skill:
            Repository.save_skill({
                "slug": "subdomain-provisioner",
                "name": "Subdomain Provisioner",
                "description": "Provisions, registers, and verifies live prototype subdomains (e.g. proto-{client}.zero7.space) via Cloudflare DNS and Droplet Nginx.",
                "skill_md_content": """---
name: subdomain-provisioner
description: Provisions and binds custom live subdomains for prototypes on zero7.space.
---

# Subdomain Provisioning Skill
1. Normalize client business name to a clean URL slug: `proto-{slug}.zero7.space`.
2. Register DNS record via Cloudflare API or Droplet Nginx.
3. Call `POST /api/leads/{id}/verify-subdomain` to activate the subdomain in CRM.
4. Verify HTTP 200 reachability.
5. Format WhatsApp pitch copy with the live URL.
"""
            })

        # 2. Seed Prototype Maker Agent
        proto_agent = Repository.get_agent('prototype_maker')
        if not proto_agent:
            Repository.save_agent({
                "name": "Prototype Maker",
                "slug": "prototype_maker",
                "description": "Generates interactive single-file Tailwind HTML mockups, provisions live subdomains, and drafts WhatsApp pitches.",
                "model": "antigravity/gemini-3.7-flash-tiered",
                "system_prompt": """You are Zero7's Principal Prototype Architect.
Transform client bottlenecks, transcripts, and spreadsheets into working, responsive Tailwind HTML prototypes.
Always allocate a live subdomain via the subdomain-provisioner skill and output a clean WhatsApp pitch hook.""",
                "default_pills": ["@lead.profile", "@transcripts.all", "@files.all"],
                "assigned_skills": ["subdomain-provisioner"],
                "mcp_servers": ["zero7-crm"],
                "autonomy_level": "approval_required"
            })
        elif proto_agent.get("model") in ("pro", "flash", "local"):
            Repository._execute("UPDATE agent_definitions SET model = ? WHERE slug = ?", ("antigravity/gemini-3.7-flash-tiered", "prototype_maker"), commit=True)

        # 3. Seed Lead Intelligence Researcher Agent
        research_agent = Repository.get_agent('lead_researcher')
        if not research_agent:
            Repository.save_agent({
                "name": "Lead Researcher",
                "slug": "lead_researcher",
                "description": "Analyzes inbound questionnaires, web presence, and calling notes to produce structured company briefs and pricing tiers.",
                "model": "antigravity/gemini-3.7-flash-tiered",
                "system_prompt": """You are the Senior Enterprise Solutions Strategist for Zero7.
Conduct rigorous operational bottleneck mapping, recommend custom software architecture, estimate budget in INR, and draft compelling outreach hooks.""",
                "default_pills": ["@lead.profile", "@meta.form_answers", "@whatsapp.all"],
                "assigned_skills": [],
                "mcp_servers": ["zero7-crm"],
                "autonomy_level": "autonomous"
            })
        elif research_agent.get("model") in ("pro", "flash", "local"):
            Repository._execute("UPDATE agent_definitions SET model = ? WHERE slug = ?", ("antigravity/gemini-3.7-flash-tiered", "lead_researcher"), commit=True)

        # 4. Seed WhatsApp Nudge Agent
        nudge_agent = Repository.get_agent('whatsapp_nudge')
        if not nudge_agent:
            Repository.save_agent({
                "name": "WhatsApp Nudge & Follow-up",
                "slug": "whatsapp_nudge",
                "description": "Analyzes conversation dormancy and crafts polite, contextual WhatsApp re-engagement hooks referencing past discussions.",
                "model": "antigravity/gemini-3.7-flash-tiered",
                "system_prompt": """You are Zero7's Lead Account Consultant.
Read past WhatsApp messages and call transcripts. Craft a crisp, respectful 2-sentence WhatsApp nudge addressing the prospect's exact stated problem.""",
                "default_pills": ["@lead.profile", "@whatsapp.all", "@transcripts.all"],
                "assigned_skills": [],
                "mcp_servers": ["zero7-crm"],
                "autonomy_level": "approval_required"
            })
        elif nudge_agent.get("model") in ("pro", "flash", "local"):
            Repository._execute("UPDATE agent_definitions SET model = ? WHERE slug = ?", ("antigravity/gemini-3.7-flash-tiered", "whatsapp_nudge"), commit=True)

        # 5. Seed SOW Architect Agent
        sow_agent = Repository.get_agent('sow_architect')
        if not sow_agent:
            Repository.save_agent({
                "name": "SOW Architect",
                "slug": "sow_architect",
                "description": "Generates comprehensive Scope of Work agreements, Phase 1 MVP sprint deliverables, timelines, and commercial terms from client discovery calls.",
                "model": "antigravity/gemini-3.7-flash-tiered",
                "system_prompt": """You are Zero7's Principal Solutions Architect. Analyze client call transcripts and vault documents to draft a detailed Scope of Work (SOW) agreement with sprint milestones, technical architecture, and commercial pricing.""",
                "default_pills": ["@lead.profile", "@transcripts.all", "@files.all"],
                "assigned_skills": ["drive_file_reader"],
                "mcp_servers": ["zero7-crm"],
                "autonomy_level": "approval_required"
            })
        elif sow_agent.get("model") in ("pro", "flash", "local"):
            Repository._execute("UPDATE agent_definitions SET model = ? WHERE slug = ?", ("antigravity/gemini-3.7-flash-tiered", "sow_architect"), commit=True)

        # 6. Seed Chief Agency Orchestrator Agent
        chief_agent = Repository.get_agent('chief')
        if not chief_agent:
            Repository.save_agent({
                "name": "Chief",
                "slug": "chief",
                "description": "Autonomous Agency Orchestrator & Workflow Director. Coordinates multi-agent tasks, reviews deliverables, and audits client pipelines.",
                "model": "antigravity/gemini-3.7-flash-tiered",
                "system_prompt": """You are Chief, the Lead AI Operations Orchestrator at Zero7. You oversee all client workflows, prioritize pipeline tasks, and ensure high deliverable quality.""",
                "default_pills": ["@lead.profile", "@transcripts.all", "@whatsapp.all"],
                "assigned_skills": ["web_search"],
                "mcp_servers": ["zero7-crm"],
                "autonomy_level": "autonomous"
            })
        elif chief_agent.get("model") in ("pro", "flash", "local"):
            Repository._execute("UPDATE agent_definitions SET model = ? WHERE slug = ?", ("antigravity/gemini-3.7-flash-tiered", "chief"), commit=True)

        # 7. Seed default zero7-crm MCP Server entry
        mcp_servers = Repository.list_mcp_servers()
        if not any(s['name'] == 'zero7-crm' for s in mcp_servers):
            Repository.save_mcp_server({
                "name": "zero7-crm",
                "server_type": "sse",
                "config": {
                    "serverUrl": "https://cos.zero7.space/mcp/sse"
                },
                "is_active": 1
            })

        # 8. Seed Pipeline Sentinel / Nagger Agent
        sentinel_agent = Repository.get_agent('pipeline_sentinel')
        if not sentinel_agent:
            Repository.save_agent({
                "name": "Zero7 Pipeline Sentinel & Nagger",
                "slug": "pipeline_sentinel",
                "description": "Autonomous 24/7 Pipeline Nagger & Accountability Sentinel. Continuously audits all CRM leads, detects stalls, unmade calls, and dormant proposals, proactively questioning the team on the Zero7 WhatsApp group.",
                "model": "antigravity/gemini-3.7-flash-tiered",
                "system_prompt": """You are the Zero7 CRM Pipeline Sentinel & Relentless Team Accountability Agent.
You have complete 360-degree context on all CRM leads, deals, proposals, calls, and WhatsApp messages.
Your sole mission is to be hyper-proactive—uncovering pipeline bottlenecks, unanswered proposals, uncalled leads, and broken follow-ups.
You ask sharp, direct questions and nag the team on WhatsApp (Zero7 group) to ensure zero lead slips through the cracks.""",
                "default_pills": ["@lead.profile", "@deals.all", "@calls.all", "@whatsapp.all", "@notes.all"],
                "assigned_skills": ["whatsapp-group-zero7"],
                "mcp_servers": ["zero7-crm"],
                "autonomy_level": "autonomous",
                "role": "sentinel"
            })
        elif sentinel_agent.get("model") in ("pro", "flash", "local"):
            Repository._execute("UPDATE agent_definitions SET model = ? WHERE slug = ?", ("antigravity/gemini-3.7-flash-tiered", "pipeline_sentinel"), commit=True)

    # ── Zero7 Group Messages & Sentinel Lead Memory ──
    @staticmethod
    def save_zero7_group_message(
        wa_message_id: str,
        sender_phone: str,
        sender_name: str,
        message_text: str,
        is_audio: int = 0,
        media_url: str = "",
        linked_lead_id: Optional[str] = None,
        matched_lead_name: Optional[str] = None,
        timestamp: Optional[str] = None
    ) -> Dict[str, Any]:
        msg_id = f"z7m_{uuid.uuid4().hex[:10]}"
        now = Repository.now()
        ts = timestamp or now
        Repository._execute("""
            INSERT OR REPLACE INTO zero7_group_messages (
                id, wa_message_id, sender_phone, sender_name, message_text, is_audio, media_url,
                linked_lead_id, matched_lead_name, timestamp, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (msg_id, wa_message_id, sender_phone, sender_name, message_text, is_audio, media_url,
              linked_lead_id, matched_lead_name, ts, now), commit=True)
        return Repository.get_zero7_group_message(wa_message_id)

    @staticmethod
    def get_zero7_group_message(wa_message_id: str) -> Optional[Dict[str, Any]]:
        row = Repository._execute("SELECT * FROM zero7_group_messages WHERE wa_message_id = ?", (wa_message_id,), fetchone=True)
        return dict(row) if row else None

    @staticmethod
    def list_zero7_group_messages(limit: int = 100, linked_lead_id: Optional[str] = None) -> List[Dict[str, Any]]:
        if linked_lead_id:
            rows = Repository._execute("""
                SELECT * FROM zero7_group_messages
                WHERE linked_lead_id = ?
                ORDER BY timestamp DESC LIMIT ?
            """, (linked_lead_id, limit), fetchall=True)
        else:
            rows = Repository._execute("""
                SELECT * FROM zero7_group_messages
                ORDER BY timestamp DESC LIMIT ?
            """, (limit,), fetchall=True)
        return [dict(r) for r in rows] if rows else []

    @staticmethod
    def save_sentinel_lead_context(lead_id: str, context_data: Dict[str, Any]) -> Dict[str, Any]:
        now = Repository.now()
        lead = Repository.get_lead(lead_id) or {}
        name = lead.get("name") or context_data.get("lead_name") or ""
        biz = lead.get("business_name") or context_data.get("business_name") or ""
        commitments = context_data.get("commitments_made") or []
        commitments_json = json.dumps(commitments) if isinstance(commitments, list) else str(commitments)
        unresolved = context_data.get("unresolved_questions") or []
        unresolved_json = json.dumps(unresolved) if isinstance(unresolved, list) else str(unresolved)

        Repository._execute("""
            INSERT OR REPLACE INTO sentinel_lead_context (
                lead_id, lead_name, business_name, synthesized_context, group_mentions_summary,
                call_insights_summary, commitments_made, unresolved_questions, last_context_update, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            lead_id, name, biz,
            context_data.get("synthesized_context", ""),
            context_data.get("group_mentions_summary", ""),
            context_data.get("call_insights_summary", ""),
            commitments_json,
            unresolved_json,
            now,
            now
        ), commit=True)
        return Repository.get_sentinel_lead_context(lead_id)

    @staticmethod
    def get_sentinel_lead_context(lead_id: str) -> Optional[Dict[str, Any]]:
        row = Repository._execute("SELECT * FROM sentinel_lead_context WHERE lead_id = ?", (lead_id,), fetchone=True)
        if not row:
            return None
        res = dict(row)
        for col in ("commitments_made", "unresolved_questions"):
            if res.get(col):
                try:
                    res[col] = json.loads(res[col])
                except Exception:
                    res[col] = []
        return res

    # ── Sentinel Agent Alerts ──
    @staticmethod
    def log_sentinel_alert(
        lead_id: Optional[str],
        aberration_type: str,
        severity: str,
        nag_message: str,
        wa_message_id: Optional[str] = None,
        status: str = "sent",
        group_target: str = "Zero7"
    ) -> Dict[str, Any]:
        alert_id = f"sal_{uuid.uuid4().hex[:10]}"
        now = Repository.now()
        Repository._execute("""
            INSERT INTO sentinel_alerts_log (
                id, lead_id, aberration_type, severity, nag_message, group_target, wa_message_id, status, dispatched_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (alert_id, lead_id, aberration_type, severity, nag_message, group_target, wa_message_id, status, now, now), commit=True)
        return Repository.get_sentinel_alert(alert_id)

    @staticmethod
    def get_sentinel_alert(alert_id: str) -> Optional[Dict[str, Any]]:
        row = Repository._execute("SELECT * FROM sentinel_alerts_log WHERE id = ?", (alert_id,), fetchone=True)
        return dict(row) if row else None

    @staticmethod
    def get_last_sentinel_alert(lead_id: str, aberration_type: str) -> Optional[Dict[str, Any]]:
        row = Repository._execute("""
            SELECT * FROM sentinel_alerts_log
            WHERE lead_id = ? AND aberration_type = ?
            ORDER BY created_at DESC LIMIT 1
        """, (lead_id, aberration_type), fetchone=True)
        return dict(row) if row else None

    @staticmethod
    def get_last_sentinel_alert_for_lead(lead_id: str) -> Optional[Dict[str, Any]]:
        row = Repository._execute("""
            SELECT * FROM sentinel_alerts_log
            WHERE lead_id = ? AND status = 'sent'
            ORDER BY created_at DESC LIMIT 1
        """, (lead_id,), fetchone=True)
        return dict(row) if row else None

    @staticmethod
    def list_sentinel_alerts(limit: int = 50, lead_id: Optional[str] = None) -> List[Dict[str, Any]]:
        if lead_id:
            rows = Repository._execute("""
                SELECT sa.*, l.name as lead_name, l.business_name as business_name
                FROM sentinel_alerts_log sa
                LEFT JOIN leads l ON sa.lead_id = l.id
                WHERE sa.lead_id = ?
                ORDER BY sa.created_at DESC LIMIT ?
            """, (lead_id, limit), fetchall=True)
        else:
            rows = Repository._execute("""
                SELECT sa.*, l.name as lead_name, l.business_name as business_name
                FROM sentinel_alerts_log sa
                LEFT JOIN leads l ON sa.lead_id = l.id
                ORDER BY sa.created_at DESC LIMIT ?
            """, (limit,), fetchall=True)
        return [dict(r) for r in rows] if rows else []

    @staticmethod
    def resolve_sentinel_alerts_for_lead(lead_id: str, resolved_by: str = "Team", notes: str = "") -> int:
        cur = Repository._execute("""
            UPDATE sentinel_alerts_log
            SET status = 'resolved'
            WHERE lead_id = ? AND status = 'sent'
        """, (lead_id,), commit=True)
        return getattr(cur, "rowcount", 0)

    @staticmethod
    def count_sentinel_alerts_today(today_start_iso: str) -> int:
        row = Repository._execute("""
            SELECT COUNT(*) as cnt FROM sentinel_alerts_log
            WHERE status = 'sent' AND created_at >= ?
        """, (today_start_iso,), fetchone=True)
        return int(row["cnt"]) if row and "cnt" in row else 0

    # ── Universal Activity Feed Delegations ──
    log_activity = ActivityRepository.log_activity
    get_activity = ActivityRepository.get_activity
    get_lead_activities = ActivityRepository.get_lead_activities

    # ── Deal Milestones, Payments, Deliverables, Environments Delegations ──
    create_deal_milestone = DealRepository.create_deal_milestone
    get_deal_milestone = DealRepository.get_deal_milestone
    update_deal_milestone = DealRepository.update_deal_milestone
    delete_deal_milestone = DealRepository.delete_deal_milestone
    list_deal_milestones = DealRepository.list_deal_milestones
    _sync_deal_milestones_json = DealRepository._sync_deal_milestones_json
    record_deal_payment = DealRepository.record_deal_payment
    get_deal_payment = DealRepository.get_deal_payment
    list_deal_payments = DealRepository.list_deal_payments
    create_deal_deliverable = DealRepository.create_deal_deliverable
    get_deal_deliverable = DealRepository.get_deal_deliverable
    update_deal_deliverable = DealRepository.update_deal_deliverable
    delete_deal_deliverable = DealRepository.delete_deal_deliverable
    list_deal_deliverables = DealRepository.list_deal_deliverables
    _sync_deal_deliverables_json = DealRepository._sync_deal_deliverables_json
    set_deal_environment = DealRepository.set_deal_environment
    list_deal_environments = DealRepository.list_deal_environments

    # ── Subdomain Routing & Attributions Delegations ──
    register_subdomain_route = SubdomainRepository.register_subdomain_route
    get_subdomain_route = SubdomainRepository.get_subdomain_route
    save_lead_attribution = AttributionRepository.save_lead_attribution
    get_lead_attribution = AttributionRepository.get_lead_attribution

    # ── Zoho Mail Metadata & Labels ──
    @staticmethod
    def get_mail_labels():
        defaults = [
            {"id": "primary", "name": "Primary", "color": "#00b69b", "bg": "rgba(0, 182, 155, 0.14)"},
            {"id": "social", "name": "Social", "color": "#5a8cff", "bg": "rgba(90, 140, 255, 0.14)"},
            {"id": "work", "name": "Work", "color": "#fd9a56", "bg": "rgba(253, 154, 86, 0.16)"},
            {"id": "friends", "name": "Friends", "color": "#d456fd", "bg": "rgba(212, 86, 253, 0.14)"},
        ]
        custom = Repository._execute("SELECT id, name, color, bg FROM zoho_mail_labels ORDER BY created_at ASC", fetchall=True) or []
        seen = {d["id"] for d in defaults}
        for c in custom:
            if c["id"] not in seen:
                defaults.append(dict(c))
                seen.add(c["id"])
        return defaults

    @staticmethod
    def create_mail_label(name: str, color: str = "#4880ff"):
        clean_name = (name or "").strip()
        if not clean_name:
            return None
        label_id = re.sub(r"[^a-z0-9_]", "_", clean_name.lower()).strip("_") or ("lbl_" + uuid.uuid4().hex[:6])
        # Convert hex color to soft rgba
        c_hex = color.lstrip("#")
        if len(c_hex) == 6:
            r, g, b = int(c_hex[0:2], 16), int(c_hex[2:4], 16), int(c_hex[4:6], 16)
            bg = f"rgba({r}, {g}, {b}, 0.15)"
        else:
            bg = "rgba(72, 128, 255, 0.15)"
        now = Repository.now()
        Repository._execute(
            "INSERT OR REPLACE INTO zoho_mail_labels (id, name, color, bg, created_at) VALUES (?, ?, ?, ?, ?)",
            (label_id, clean_name, color, bg, now),
            commit=True,
        )
        return {"id": label_id, "name": clean_name, "color": color, "bg": bg}

    @staticmethod
    def get_mail_metadata_maps():
        rows = Repository._execute("SELECT * FROM zoho_mail_metadata", fetchall=True) or []
        custom_labels_map = {}
        local_flags_map = {}
        for r in rows:
            mid = str(r["message_id"])
            if r.get("label_id"):
                custom_labels_map[mid] = r["label_id"]
            meta = {}
            if r.get("starred") is not None:
                meta["starred"] = bool(r["starred"])
            if r.get("unread") is not None:
                meta["unread"] = bool(r["unread"])
            if r.get("folder_override"):
                meta["folder_override"] = r["folder_override"]
            if meta:
                local_flags_map[mid] = meta
        return custom_labels_map, local_flags_map

    @staticmethod
    def expand_thread_message_ids(message_ids: list) -> list:
        if not message_ids:
            return []
        expanded = set()
        for mid in message_ids:
            if not mid:
                continue
            mid_str = str(mid)
            expanded.add(mid_str)
            try:
                row = Repository._execute("SELECT thread_key FROM zoho_emails_cache WHERE message_id = ?", (mid_str,), fetchone=True)
                if row and row["thread_key"]:
                    t_rows = Repository._execute("SELECT message_id FROM zoho_emails_cache WHERE thread_key = ?", (row["thread_key"],), fetchall=True) or []
                    for tr in t_rows:
                        expanded.add(str(tr["message_id"]))
            except Exception:
                pass
        return list(expanded)

    @staticmethod
    def update_mail_metadata(message_ids: list, action: str, label_id: str = None, retries: int = 5):
        if not message_ids:
            return
        import time
        now = Repository.now()
        act = (action or "").lower()
        target_ids = Repository.expand_thread_message_ids(message_ids)
        for attempt in range(retries):
            conn = None
            try:
                conn = get_connection()
                with conn:
                    c = conn.cursor()
                    for mid in target_ids:
                        mid_str = str(mid)
                        c.execute("SELECT * FROM zoho_mail_metadata WHERE message_id = ?", (mid_str,))
                        row = c.fetchone()
                        existing = dict(row) if row else {}
                        lbl = label_id if act == "assign_label" else existing.get("label_id")
                        starred = existing.get("starred")
                        unread = existing.get("unread")
                        folder_ov = existing.get("folder_override")

                        if act == "star":
                            starred = 1
                        elif act == "unstar":
                            starred = 0
                        elif act == "read":
                            unread = 0
                        elif act == "unread":
                            unread = 1
                        elif act in ("trash", "bin", "delete"):
                            folder_ov = "bin"
                        elif act == "spam":
                            folder_ov = "spam"
                        elif act == "archive":
                            folder_ov = "archive"
                        elif act == "inbox":
                            folder_ov = "inbox"

                        c.execute(
                            """
                            INSERT OR REPLACE INTO zoho_mail_metadata (message_id, label_id, starred, unread, folder_override, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                            """,
                            (mid_str, lbl, starred, unread, folder_ov, now),
                        )
                return
            except sqlite3.OperationalError as e:
                err_msg = str(e).lower()
                if ("locked" in err_msg or "busy" in err_msg) and attempt < retries - 1:
                    time.sleep(0.15 * (2 ** attempt))
                    continue
                raise
            finally:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        pass

    # ── Zoho Mail Persistent Email & Attachment Cache ──
    @staticmethod
    def get_cached_emails_count() -> int:
        row = Repository._execute("SELECT COUNT(*) as cnt FROM zoho_emails_cache", fetchone=True)
        return int(row["cnt"]) if row else 0

    @staticmethod
    def save_cached_emails(emails: list, retries: int = 5):
        if not emails:
            return
        import time
        now = Repository.now()
        for attempt in range(retries):
            conn = None
            try:
                conn = get_connection()
                with conn:
                    c = conn.cursor()
                    for m in emails:
                        mid = str(m.get("messageId") or "")
                        if not mid:
                            continue

                        c.execute(
                            "SELECT html_content, attachments_json, inline_images_json, is_starred, is_unread FROM zoho_emails_cache WHERE message_id = ?",
                            (mid,)
                        )
                        existing_row = c.fetchone()
                        existing = dict(existing_row) if existing_row else None

                        html_body = m.get("htmlContent") or (existing.get("html_content") if existing else None)
                        atts_json = json.dumps(m.get("attachments") or []) if m.get("attachments") is not None else (existing.get("attachments_json") if existing else "[]")
                        inline_json = json.dumps(m.get("inlineImages") or []) if m.get("inlineImages") is not None else (existing.get("inline_images_json") if existing else "[]")

                        is_starred = 1 if m.get("isStarred") else 0
                        is_unread = 1 if m.get("isUnread") else 0
                        is_important = 1 if m.get("isImportant") else 0

                        c.execute(
                            """
                            INSERT INTO zoho_emails_cache (
                                message_id, folder_id, folder_key, thread_id, thread_key, thread_count,
                                subject, summary, sender_name, recipient_name, from_email, from_display,
                                to_display, cc_display, to_emails_json, cc_emails_json, matched_aliases_json,
                                alias_email, alias_name, timestamp, is_unread, is_starred, is_important,
                                has_attachment, has_inline, label, size, html_content, attachments_json,
                                inline_images_json, raw_json, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(message_id) DO UPDATE SET
                                folder_id=excluded.folder_id,
                                folder_key=excluded.folder_key,
                                thread_id=excluded.thread_id,
                                thread_key=excluded.thread_key,
                                thread_count=excluded.thread_count,
                                subject=excluded.subject,
                                summary=excluded.summary,
                                sender_name=excluded.sender_name,
                                recipient_name=excluded.recipient_name,
                                from_email=excluded.from_email,
                                from_display=excluded.from_display,
                                to_display=excluded.to_display,
                                cc_display=excluded.cc_display,
                                to_emails_json=excluded.to_emails_json,
                                cc_emails_json=excluded.cc_emails_json,
                                matched_aliases_json=excluded.matched_aliases_json,
                                alias_email=excluded.alias_email,
                                alias_name=excluded.alias_name,
                                timestamp=excluded.timestamp,
                                is_unread=excluded.is_unread,
                                is_starred=excluded.is_starred,
                                is_important=excluded.is_important,
                                has_attachment=excluded.has_attachment,
                                has_inline=excluded.has_inline,
                                label=excluded.label,
                                size=excluded.size,
                                html_content=COALESCE(excluded.html_content, zoho_emails_cache.html_content),
                                attachments_json=CASE WHEN excluded.attachments_json != '[]' THEN excluded.attachments_json ELSE zoho_emails_cache.attachments_json END,
                                inline_images_json=CASE WHEN excluded.inline_images_json != '[]' THEN excluded.inline_images_json ELSE zoho_emails_cache.inline_images_json END,
                                updated_at=excluded.updated_at
                            """,
                            (
                                mid,
                                str(m.get("folderId") or ""),
                                str(m.get("folderKey") or "inbox"),
                                str(m.get("threadId") or ""),
                                str(m.get("threadKey") or mid),
                                int(m.get("threadCount") or 1),
                                m.get("subject") or "",
                                m.get("summary") or "",
                                m.get("senderName") or "",
                                m.get("recipientName") or "",
                                m.get("fromEmail") or "",
                                m.get("fromDisplay") or "",
                                m.get("toDisplay") or "",
                                m.get("ccDisplay") or "",
                                json.dumps(m.get("toEmails") or []),
                                json.dumps(m.get("ccEmails") or []),
                                json.dumps(m.get("matchedAliases") or []),
                                m.get("aliasEmail") or "admin@zero7.space",
                                m.get("aliasName") or "Zero7",
                                int(m.get("timestamp") or 0),
                                is_unread,
                                is_starred,
                                is_important,
                                1 if m.get("hasAttachment") else 0,
                                1 if m.get("hasInline") else 0,
                                m.get("label") or "primary",
                                int(m.get("size") or 0),
                                html_body,
                                atts_json,
                                inline_json,
                                json.dumps(m.get("rawJson") or {}),
                                now,
                                now,
                            )
                        )
                return
            except sqlite3.OperationalError as e:
                err_msg = str(e).lower()
                if ("locked" in err_msg or "busy" in err_msg) and attempt < retries - 1:
                    time.sleep(0.15 * (2 ** attempt))
                    continue
                raise
            finally:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        pass

    @staticmethod
    def update_cached_email_content(message_id: str, html_content: str, attachments: list = None, inline_images: list = None):
        now = Repository.now()
        fields = ["html_content = ?", "updated_at = ?"]
        params = [html_content, now]
        if attachments is not None:
            fields.append("attachments_json = ?")
            params.append(json.dumps(attachments))
            if len(attachments) > 0:
                fields.append("has_attachment = 1")
        if inline_images is not None:
            fields.append("inline_images_json = ?")
            params.append(json.dumps(inline_images))
            if len(inline_images) > 0:
                fields.append("has_inline = 1")
        params.append(str(message_id))
        Repository._execute(
            f"UPDATE zoho_emails_cache SET {', '.join(fields)} WHERE message_id = ?",
            tuple(params),
            commit=True
        )

    @staticmethod
    def _format_cached_email(r: Any) -> Optional[dict]:
        if not r:
            return None
        d = dict(r)
        d["messageId"] = d.get("message_id")
        d["folderId"] = d.get("folder_id")
        d["folderKey"] = d.get("folder_key")
        d["threadId"] = d.get("thread_id")
        d["threadKey"] = d.get("thread_key")
        d["threadCount"] = int(d.get("thread_count") or 1)
        d["senderName"] = d.get("sender_name") or ""
        d["recipientName"] = d.get("recipient_name") or ""
        d["fromEmail"] = d.get("from_email") or ""
        d["fromDisplay"] = d.get("from_display") or d.get("from_email") or ""
        d["toDisplay"] = d.get("to_display") or ""
        d["ccDisplay"] = d.get("cc_display") or ""
        d["toEmails"] = json.loads(d.get("to_emails_json") or "[]") if isinstance(d.get("to_emails_json"), str) else (d.get("to_emails_json") or [])
        d["ccEmails"] = json.loads(d.get("cc_emails_json") or "[]") if isinstance(d.get("cc_emails_json"), str) else (d.get("cc_emails_json") or [])
        d["matchedAliases"] = json.loads(d.get("matched_aliases_json") or "[]") if isinstance(d.get("matched_aliases_json"), str) else (d.get("matched_aliases_json") or [])
        d["aliasEmail"] = d.get("alias_email") or "admin@zero7.space"
        d["aliasName"] = d.get("alias_name") or "Zero7"
        d["isUnread"] = bool(d.get("is_unread"))
        d["isStarred"] = bool(d.get("is_starred"))
        d["isImportant"] = bool(d.get("is_important"))
        d["hasAttachment"] = bool(d.get("has_attachment"))
        d["hasInline"] = bool(d.get("has_inline"))
        d["htmlContent"] = d.get("html_content")
        d["attachments"] = json.loads(d.get("attachments_json") or "[]") if isinstance(d.get("attachments_json"), str) else (d.get("attachments_json") or [])
        d["inlineImages"] = json.loads(d.get("inline_images_json") or "[]") if isinstance(d.get("inline_images_json"), str) else (d.get("inline_images_json") or [])
        return d

    @staticmethod
    def get_cached_email_by_id(message_id: str) -> Optional[dict]:
        row = Repository._execute("SELECT * FROM zoho_emails_cache WHERE message_id = ?", (str(message_id),), fetchone=True)
        return Repository._format_cached_email(row)

    @staticmethod
    def get_cached_thread_messages(thread_key: str) -> list:
        rows = Repository._execute(
            "SELECT * FROM zoho_emails_cache WHERE thread_key = ? ORDER BY timestamp ASC",
            (str(thread_key),),
            fetchall=True
        ) or []
        return [Repository._format_cached_email(r) for r in rows if r]

    @staticmethod
    def _group_cached_threads(messages: list) -> list:
        """
        Groups raw cached messages into conversation threads matching Zoho Mail / Gmail conversation view.
        Each thread is represented by its latest message, with aggregated participants,
        cumulative unread/starred/important flags, combined aliases, and accurate threadCount.
        """
        from collections import OrderedDict
        threads_map = OrderedDict()
        for m in messages:
            t_key = m.get("threadKey") or m.get("thread_key") or m["messageId"]
            if t_key not in threads_map:
                threads_map[t_key] = []
            threads_map[t_key].append(m)

        known_internal = {"admin@zero7.space", "abhijeet@zero7.space", "shailesh@zero7.space", "aakash@zero7.space", "lishant@zero7.space"}
        try:
            for u in (Repository.list_users() or []):
                if u.get("email"):
                    known_internal.add(u["email"].lower().strip())
        except Exception:
            pass

        thread_items = []
        for t_key, msgs in threads_map.items():
            latest = msgs[0]
            all_aliases = set(latest.get("matchedAliases") or [])
            all_emails = set()
            for m in msgs:
                for a in (m.get("matchedAliases") or []):
                    all_aliases.add(a.lower())
                if m.get("fromEmail"):
                    all_aliases.add(m["fromEmail"].lower())
                    all_emails.add(m["fromEmail"].lower())
                for e in (m.get("toEmails") or []):
                    all_aliases.add(e.lower())
                    all_emails.add(e.lower())
                for e in (m.get("ccEmails") or []):
                    all_aliases.add(e.lower())
                    all_emails.add(e.lower())

            unread_count = sum(1 for m in msgs if m.get("isUnread"))
            is_unread = unread_count > 0
            is_starred = any(m.get("isStarred") for m in msgs)
            is_important = any(m.get("isImportant") for m in msgs)
            has_attachment = any(m.get("hasAttachment") for m in msgs)
            has_inline = any(m.get("hasInline") for m in msgs)
            thread_cnt = max(len(msgs), max((m.get("threadCount") or 1) for m in msgs))

            external_senders = []
            user_participated = False
            for m in reversed(msgs):
                from_addr_clean = (m.get("fromEmail") or "").lower().strip()
                is_out = (m.get("folderKey") == "sent") or (from_addr_clean in known_internal) or from_addr_clean.endswith("@zero7.space")
                if is_out:
                    user_participated = True
                else:
                    s = (m.get("senderName") or m.get("fromDisplay") or m.get("fromEmail") or "").strip()
                    if s and s not in external_senders:
                        external_senders.append(s)

            clean_externals = [s.rstrip('.').strip() for s in external_senders if s.strip()]
            if not clean_externals:
                display_sender = "Me"
            elif not user_participated:
                if len(clean_externals) == 1:
                    display_sender = clean_externals[0]
                elif len(clean_externals) == 2:
                    display_sender = f"{clean_externals[0]}, {clean_externals[1]}"
                else:
                    display_sender = f"{clean_externals[0]}... {clean_externals[-1]}"
            else:
                display_sender = f"{clean_externals[0]}... Me"

            thread_folders = set(m.get("folderKey") for m in msgs)

            t_rep = dict(latest)
            t_rep["threadKey"] = t_key
            t_rep["threadCount"] = thread_cnt
            t_rep["isUnread"] = is_unread
            t_rep["unreadCount"] = unread_count
            t_rep["isStarred"] = is_starred
            t_rep["isImportant"] = is_important
            t_rep["hasAttachment"] = has_attachment
            t_rep["hasInline"] = has_inline
            t_rep["senderName"] = display_sender
            t_rep["matchedAliases"] = list(all_aliases)
            t_rep["_allEmails"] = list(all_emails)
            t_rep["_threadFolders"] = thread_folders
            t_rep["allMessageIds"] = [m["messageId"] for m in msgs]
            thread_items.append(t_rep)

        return thread_items

    @staticmethod
    def get_cached_emails_unified(
        folder: str = "inbox",
        alias: str = "all",
        label: str = "",
        search: str = "",
        page: int = 1,
        limit: int = 12,
    ) -> dict:
        # Load all from cache and apply metadata
        rows = Repository._execute("SELECT * FROM zoho_emails_cache ORDER BY timestamp DESC", fetchall=True) or []
        raw_pool = [Repository._format_cached_email(r) for r in rows if r]

        custom_labels_map, local_flags_map = Repository.get_mail_metadata_maps()
        for m in raw_pool:
            mid = m["messageId"]
            if mid in local_flags_map:
                meta = local_flags_map[mid]
                if "starred" in meta: m["isStarred"] = bool(meta["starred"])
                if "unread" in meta: m["isUnread"] = bool(meta["unread"])
                if meta.get("folder_override"): m["folderKey"] = meta["folder_override"]
            if mid in custom_labels_map:
                m["label"] = custom_labels_map[mid]

        thread_items = Repository._group_cached_threads(raw_pool)

        alias_norm = (alias or "all").strip().lower()
        if alias_norm and alias_norm != "all":
            alias_pool = [
                t for t in thread_items
                if alias_norm in t["matchedAliases"] or alias_norm in t.get("_allEmails", [])
            ]
        else:
            alias_pool = thread_items

        counts = {
            "inbox": sum(1 for t in alias_pool if any(f in ("inbox", "notification", "newsletter") for f in t["_threadFolders"]) and not all(f == "bin" for f in t["_threadFolders"]) and not all(f == "spam" for f in t["_threadFolders"])),
            "starred": sum(1 for t in alias_pool if t["isStarred"] and not all(f == "bin" for f in t["_threadFolders"])),
            "sent": sum(1 for t in alias_pool if "sent" in t["_threadFolders"]),
            "drafts": sum(1 for t in alias_pool if "drafts" in t["_threadFolders"]),
            "spam": sum(1 for t in alias_pool if "spam" in t["_threadFolders"]),
            "important": sum(1 for t in alias_pool if t["isImportant"] and "spam" not in t["_threadFolders"] and not all(f == "bin" for f in t["_threadFolders"])),
            "bin": sum(1 for t in alias_pool if "bin" in t["_threadFolders"]),
        }

        known_aliases = ["admin@zero7.space", "abhijeet@zero7.space", "shailesh@zero7.space", "aakash@zero7.space", "lishant@zero7.space"]
        alias_counts = {"all": sum(1 for t in thread_items if not all(f == "bin" for f in t["_threadFolders"]))}
        for ae in known_aliases:
            alias_counts[ae] = sum(
                1 for t in thread_items
                if not all(f == "bin" for f in t["_threadFolders"]) and (ae in t["matchedAliases"] or ae in t.get("_allEmails", []))
            )

        f_norm = (folder or "inbox").strip().lower()
        if f_norm == "inbox":
            filtered = [t for t in alias_pool if any(f in ("inbox", "notification", "newsletter") for f in t["_threadFolders"]) and not all(f == "bin" for f in t["_threadFolders"]) and not all(f == "spam" for f in t["_threadFolders"])]
        elif f_norm == "starred":
            filtered = [t for t in alias_pool if t["isStarred"] and not all(f == "bin" for f in t["_threadFolders"])]
        elif f_norm == "sent":
            filtered = [t for t in alias_pool if "sent" in t["_threadFolders"]]
        elif f_norm in ("draft", "drafts"):
            filtered = [t for t in alias_pool if "drafts" in t["_threadFolders"]]
        elif f_norm == "spam":
            filtered = [t for t in alias_pool if "spam" in t["_threadFolders"]]
        elif f_norm == "important":
            filtered = [t for t in alias_pool if t["isImportant"] and "spam" not in t["_threadFolders"] and not all(f == "bin" for f in t["_threadFolders"])]
        elif f_norm in ("bin", "trash"):
            filtered = [t for t in alias_pool if "bin" in t["_threadFolders"]]
        else:
            filtered = [t for t in alias_pool if not all(f == "bin" for f in t["_threadFolders"])]

        label_norm = (label or "").strip().lower()
        if label_norm:
            filtered = [t for t in filtered if (t.get("label") or "").lower() == label_norm]

        q = (search or "").strip().lower()
        if q:
            filtered = [
                t for t in filtered
                if q in t["subject"].lower()
                or q in t["summary"].lower()
                or q in t["senderName"].lower()
                or any(q in em.lower() for em in t.get("_allEmails", []))
            ]

        total = len(filtered)
        page = max(1, page)
        limit = max(1, min(limit, 50))
        start_idx = (page - 1) * limit
        end_idx = start_idx + limit
        paginated = filtered[start_idx:end_idx]

        return {
            "messages": paginated,
            "counts": counts,
            "aliasCounts": alias_counts,
            "total": total,
            "page": page,
            "limit": limit,
            "start": (start_idx + 1) if total > 0 else 0,
            "end": min(end_idx, total),
            "totalPages": max(1, (total + limit - 1) // limit),
        }

    @staticmethod
    def get_cached_attachment(folder_id: str, message_id: str, attachment_id: str = None, cid: str = None) -> Optional[dict]:
        if attachment_id:
            row = Repository._execute(
                "SELECT * FROM zoho_attachments_cache WHERE message_id = ? AND attachment_id = ?",
                (str(message_id), str(attachment_id)),
                fetchone=True
            )
            if row:
                return dict(row)
        if cid:
            clean_cid = str(cid).strip().strip("<>").strip("&")
            row = Repository._execute(
                "SELECT * FROM zoho_attachments_cache WHERE message_id = ? AND (cid = ? OR cid LIKE ? OR filename = ?)",
                (str(message_id), clean_cid, f"%{clean_cid}%", clean_cid),
                fetchone=True
            )
            if row:
                return dict(row)
        return None

    @staticmethod
    def save_cached_attachment(
        folder_id: str,
        message_id: str,
        attachment_id: str,
        cid: Optional[str],
        filename: str,
        content_type: str,
        blob_data: bytes,
    ):
        cache_id = f"{message_id}_{attachment_id or cid or uuid.uuid4().hex[:8]}"
        now = Repository.now()
        Repository._execute(
            """
            INSERT OR REPLACE INTO zoho_attachments_cache (
                id, folder_id, message_id, attachment_id, cid, filename, content_type, file_size, blob_data, cached_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                cache_id,
                str(folder_id or ""),
                str(message_id),
                str(attachment_id or ""),
                str(cid or "") if cid else None,
                filename,
                content_type,
                len(blob_data),
                sqlite3.Binary(blob_data),
                now,
            ),
            commit=True
        )

init_db()
Repository.seed_default_agents_and_skills()


