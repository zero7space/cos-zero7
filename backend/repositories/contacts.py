import uuid
from backend.repositories.base import BaseRepository


class NoteRepository(BaseRepository):
    @staticmethod
    def add_note(data: dict):
        note_id = 'note_' + uuid.uuid4().hex[:8]
        now = NoteRepository.now()
        NoteRepository._execute(
            "INSERT INTO notes (id, lead_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
            (note_id, data.get('lead_id'), data.get('user_id'), data.get('content'), now),
            commit=True,
        )
        return NoteRepository._execute("SELECT * FROM notes WHERE id = ?", (note_id,), fetchone=True)

    @staticmethod
    def get_lead_notes(lead_id: str):
        return NoteRepository._execute("SELECT * FROM notes WHERE lead_id = ? ORDER BY created_at DESC", (lead_id,), fetchall=True)


class CallLogRepository(BaseRepository):
    @staticmethod
    def log_call(data: dict):
        call_id = data.get('id') or ('call_' + uuid.uuid4().hex[:8])
        now = CallLogRepository.now()
        called_at = (data.get('called_at') or '').strip() or now
        mime = (data.get('recording_mime_type') or '').lower()
        fname = (data.get('recording_file_name') or '').lower()
        is_video = 1 if (data.get('is_video') or mime.startswith('video/') or fname.endswith(('.mp4', '.webm', '.mov', '.mkv', '.avi'))) else 0
        is_internal = int(data.get('is_internal') or 0)
        teammate_user_id = data.get('teammate_user_id')
        call_type = data.get('call_type') or ('internal' if is_internal else 'client')
        # An internal call must NEVER be bound to a single lead directly
        effective_lead_id = None if is_internal else data.get('lead_id')

        CallLogRepository._execute(
            """INSERT INTO call_logs (
                id, lead_id, user_id, outcome, notes, duration_minutes, called_at,
                recording_file_name, recording_mime_type, recording_size_bytes, recording_duration_secs,
                recording_drive_file_id, recording_drive_url, transcription_text, transcription_drive_file_id,
                transcription_confidence, transcription_language, is_video, is_internal, teammate_user_id, call_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (call_id, effective_lead_id, data.get('user_id'), data.get('outcome'), data.get('notes'), data.get('duration_minutes'), called_at,
             data.get('recording_file_name'), data.get('recording_mime_type'), data.get('recording_size_bytes'), data.get('recording_duration_secs'),
             data.get('recording_drive_file_id'), data.get('recording_drive_url'),
             data.get('transcription_text'), data.get('transcription_drive_file_id'), data.get('transcription_confidence'), data.get('transcription_language'),
             is_video, is_internal, teammate_user_id, call_type),
            commit=True,
        )

        # If an internal call mentioned a lead at ingestion, record it as a lead mention
        if is_internal and data.get('lead_id'):
            CallLogRepository.add_call_lead_mention(
                call_id=call_id,
                lead_id=data.get('lead_id'),
                topic=data.get('outcome') or 'Internal Sync',
                notes=data.get('notes') or '',
                transcript_excerpt=data.get('transcription_text') or ''
            )

        # Update lead last_contacted_at, call_stage, and status if direct client call
        if not is_internal and data.get('lead_id'):
            lead_row = CallLogRepository._execute("SELECT call_stage, status FROM leads WHERE id = ?", (data.get('lead_id'),), fetchone=True)
            if lead_row:
                curr_stage = (lead_row.get('call_stage') or '').lower()
                curr_status = (lead_row.get('status') or '').lower()
                next_stage = 'first_call' if curr_stage in ('', 'uncontacted', 'not_called') else curr_stage
                next_status = 'contacted' if curr_status == 'new' else curr_status
                CallLogRepository._execute(
                    "UPDATE leads SET last_contacted_at = ?, call_stage = ?, status = ?, updated_at = ? WHERE id = ?",
                    (called_at, next_stage, next_status, now, data.get('lead_id')),
                    commit=True,
                )
            else:
                CallLogRepository._execute("UPDATE leads SET last_contacted_at = ?, updated_at = ? WHERE id = ?", (called_at, now, data.get('lead_id')), commit=True)
        return CallLogRepository._execute("SELECT * FROM call_logs WHERE id = ?", (call_id,), fetchone=True)

    @staticmethod
    def add_call_lead_mention(
        call_id: str,
        lead_id: str,
        topic: str = "Internal Sync",
        notes: str = "",
        transcript_excerpt: str = "",
        action_items: str = "",
        time_offset_start: int = 0,
        time_offset_end: int = 0
    ) -> dict:
        """
        Associates an internal discussion with a mentioned lead, capturing specific
        topic, notes, excerpt, and action items without assigning the entire call to the lead.
        """
        mention_id = f"clm_{uuid.uuid4().hex[:10]}"
        now = CallLogRepository.now()

        # Check if already mentioned; if so, update
        existing = CallLogRepository._execute(
            "SELECT id FROM call_lead_mentions WHERE call_id = ? AND lead_id = ?",
            (call_id, lead_id),
            fetchone=True
        )
        if existing:
            CallLogRepository._execute("""
                UPDATE call_lead_mentions
                SET topic = COALESCE(?, topic),
                    notes = COALESCE(?, notes),
                    transcript_excerpt = COALESCE(?, transcript_excerpt),
                    action_items = COALESCE(?, action_items),
                    time_offset_start = ?,
                    time_offset_end = ?,
                    updated_at = ?
                WHERE id = ?
            """, (topic, notes, transcript_excerpt, action_items, time_offset_start, time_offset_end, now, existing["id"]), commit=True)
            return CallLogRepository._execute("SELECT * FROM call_lead_mentions WHERE id = ?", (existing["id"],), fetchone=True)

        CallLogRepository._execute("""
            INSERT INTO call_lead_mentions (
                id, call_id, lead_id, topic, notes, transcript_excerpt, action_items,
                time_offset_start, time_offset_end, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            mention_id, call_id, lead_id, topic, notes, transcript_excerpt, action_items,
            time_offset_start, time_offset_end, now, now
        ), commit=True)

        return CallLogRepository._execute("SELECT * FROM call_lead_mentions WHERE id = ?", (mention_id,), fetchone=True)

    @staticmethod
    def get_call_lead_mentions(call_id: str):
        """Returns all leads mentioned in an internal discussion with their metadata."""
        query = """
            SELECT m.*, l.name as lead_name, l.business_name, l.phone as lead_phone, l.status as lead_status
            FROM call_lead_mentions m
            JOIN leads l ON m.lead_id = l.id
            WHERE m.call_id = ?
            ORDER BY m.created_at ASC
        """
        return CallLogRepository._execute(query, (call_id,), fetchall=True) or []

    @staticmethod
    def get_lead_call_mentions(lead_id: str):
        """Returns all internal discussions mentioning a specific lead with timestamps and excerpts."""
        query = """
            SELECT m.*, 
                   c.outcome as call_outcome, c.called_at, c.user_id, c.teammate_user_id,
                   c.recording_file_name, c.recording_drive_file_id, c.recording_drive_url,
                   c.recording_duration_secs, c.duration_minutes,
                   u1.name as caller_name, u2.name as teammate_name
            FROM call_lead_mentions m
            JOIN call_logs c ON m.call_id = c.id
            LEFT JOIN users u1 ON c.user_id = u1.id
            LEFT JOIN users u2 ON c.teammate_user_id = u2.id
            WHERE m.lead_id = ?
            ORDER BY c.called_at DESC
        """
        return CallLogRepository._execute(query, (lead_id,), fetchall=True) or []

    @staticmethod
    def delete_call_lead_mention(mention_id: str):
        """Removes a lead mention from an internal discussion."""
        CallLogRepository._execute("DELETE FROM call_lead_mentions WHERE id = ?", (mention_id,), commit=True)
        return {"deleted": True, "id": mention_id}

    @staticmethod
    def unlink_internal_call_from_lead(call_id: str, lead_id: str):
        """Removes the link between an internal call and a specific lead."""
        CallLogRepository._execute("DELETE FROM call_lead_mentions WHERE call_id = ? AND lead_id = ?", (call_id, lead_id), commit=True)
        return {"unlinked": True, "call_id": call_id, "lead_id": lead_id}

    @staticmethod
    def get_internal_calls(teammate_user_id: str = None, limit: int = 100):
        query = """
            SELECT c.*, 
                   u1.name as caller_name, u1.email as caller_email, u1.phone as caller_phone,
                   u2.name as teammate_name, u2.email as teammate_email, u2.phone as teammate_phone
            FROM call_logs c
            LEFT JOIN users u1 ON c.user_id = u1.id
            LEFT JOIN users u2 ON c.teammate_user_id = u2.id
            WHERE c.is_internal = 1
        """
        params = []
        if teammate_user_id:
            query += " AND (c.teammate_user_id = ? OR c.user_id = ?)"
            params.extend([teammate_user_id, teammate_user_id])
        query += " ORDER BY c.called_at DESC LIMIT ?"
        params.append(limit)
        calls = CallLogRepository._execute(query, tuple(params), fetchall=True) or []

        # Attach all lead mentions to each call for rich multi-lead representation
        for c in calls:
            mentions = CallLogRepository.get_call_lead_mentions(c["id"])
            c["lead_mentions"] = mentions
            # Backward compatibility aliases
            if mentions:
                c["linked_lead_name"] = mentions[0]["lead_name"]
                c["linked_business_name"] = mentions[0]["business_name"]
                c["lead_id"] = mentions[0]["lead_id"]
            else:
                c["linked_lead_name"] = None
                c["linked_business_name"] = None
                c["lead_id"] = None
        return calls

    @staticmethod
    def link_internal_call_to_lead(
        call_id: str,
        lead_id: str = None,
        topic: str = "Internal Sync",
        notes: str = "",
        transcript_excerpt: str = "",
        action_items: str = ""
    ):
        """
        Links an internal call to a lead via the call_lead_mentions junction table.
        Ensures call_logs.lead_id remains NULL so the call is not hard-bound to one lead.
        """
        # Ensure call_logs.lead_id remains NULL
        CallLogRepository._execute("UPDATE call_logs SET lead_id = NULL WHERE id = ?", (call_id,), commit=True)

        if lead_id:
            CallLogRepository.add_call_lead_mention(
                call_id=call_id,
                lead_id=lead_id,
                topic=topic,
                notes=notes,
                transcript_excerpt=transcript_excerpt,
                action_items=action_items
            )

        call = CallLogRepository._execute("SELECT * FROM call_logs WHERE id = ?", (call_id,), fetchone=True)
        if call:
            call["lead_mentions"] = CallLogRepository.get_call_lead_mentions(call_id)
        return call

    @staticmethod
    def update_call_transcription(call_id: str, transcription_text: str, drive_file_id: str = None, confidence: float = None, language: str = None):
        CallLogRepository._execute(
            "UPDATE call_logs SET transcription_text = ?, transcription_drive_file_id = ?, transcription_confidence = ?, transcription_language = ? WHERE id = ?",
            (transcription_text, drive_file_id, confidence, language, call_id),
            commit=True,
        )
        return CallLogRepository._execute("SELECT * FROM call_logs WHERE id = ?", (call_id,), fetchone=True)

    @staticmethod
    def get_all_calls(limit: int = 100, offset: int = 0, user_id: str = None):
        query = """
            SELECT c.*, l.name as lead_name, l.business_name, l.phone as lead_phone, u.name as user_name
            FROM call_logs c
            LEFT JOIN leads l ON c.lead_id = l.id
            LEFT JOIN users u ON c.user_id = u.id
        """
        params = []
        if user_id:
            query += " WHERE c.user_id = ?"
            params.append(user_id)
        query += " ORDER BY c.called_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        return CallLogRepository._execute(query, tuple(params), fetchall=True)

    @staticmethod
    def get_lead_calls(lead_id: str):
        """
        Returns all direct client calls for this lead plus any internal discussion
        mentions converted to call view objects so clients get a comprehensive history.
        """
        direct_calls = CallLogRepository._execute(
            "SELECT * FROM call_logs WHERE lead_id = ? AND is_internal = 0 ORDER BY called_at DESC",
            (lead_id,),
            fetchall=True
        ) or []

        # Also load internal discussion mentions for this lead (graceful fallback)
        mentions = []
        try:
            mentions = CallLogRepository.get_lead_call_mentions(lead_id) or []
        except Exception:
            mentions = []
        converted_mentions = []
        for m in mentions:
            converted_mentions.append({
                "id": f"mention_{m['id']}",
                "call_id": m["call_id"],
                "lead_id": lead_id,
                "outcome": m.get("topic") or "Internal Sync Mention",
                "notes": m.get("notes") or "",
                "duration_minutes": m.get("duration_minutes") or 0,
                "called_at": m.get("called_at"),
                "recording_file_name": m.get("recording_file_name"),
                "recording_drive_file_id": m.get("recording_drive_file_id"),
                "recording_drive_url": m.get("recording_drive_url"),
                "recording_duration_secs": m.get("recording_duration_secs"),
                "transcription_text": m.get("transcript_excerpt") or "",
                "is_internal": 1,
                "is_video": 0,
                "call_type": "internal_mention",
                "caller_name": m.get("caller_name"),
                "teammate_name": m.get("teammate_name"),
                "action_items": m.get("action_items"),
                "time_offset_start": m.get("time_offset_start", 0),
                "time_offset_end": m.get("time_offset_end", 0),
            })

        all_calls = direct_calls + converted_mentions
        all_calls.sort(key=lambda x: str(x.get("called_at") or ""), reverse=True)
        return all_calls

    @staticmethod
    def get_lead_activity(lead_id: str):
        # 1. Direct client calls
        calls = CallLogRepository._execute("""
            SELECT c.id, 'call' as type, c.outcome, c.notes, c.duration_minutes, c.called_at as date, c.user_id, u.name as user_name,
                   c.recording_file_name, c.recording_mime_type, c.recording_size_bytes, c.recording_duration_secs,
                   c.recording_drive_file_id, c.recording_drive_url,
                   c.transcription_text, c.transcription_confidence, c.transcription_language,
                   c.is_video, 0 as is_internal
            FROM call_logs c 
            LEFT JOIN users u ON c.user_id = u.id 
            WHERE c.lead_id = ? AND c.is_internal = 0
        """, (lead_id,), fetchall=True) or []

        # 2. Internal sync mentions (graceful fallback)
        mentions = []
        try:
            mentions = CallLogRepository.get_lead_call_mentions(lead_id) or []
        except Exception:
            mentions = []
        mention_acts = []
        for m in mentions:
            mention_acts.append({
                "id": f"mention_{m['id']}",
                "type": "internal_sync_mention",
                "outcome": m.get("topic") or "Internal Strategy Sync Mention",
                "notes": m.get("notes") or m.get("transcript_excerpt") or "",
                "duration_minutes": m.get("duration_minutes") or 0,
                "date": m.get("called_at"),
                "user_id": m.get("user_id"),
                "user_name": f"{m.get('caller_name', 'Founder')} & {m.get('teammate_name', 'Teammate')}",
                "recording_file_name": m.get("recording_file_name"),
                "recording_mime_type": "audio/ogg",
                "recording_size_bytes": 0,
                "recording_duration_secs": m.get("recording_duration_secs"),
                "recording_drive_file_id": m.get("recording_drive_file_id"),
                "recording_drive_url": m.get("recording_drive_url"),
                "transcription_text": m.get("transcript_excerpt") or "",
                "transcription_confidence": 1.0,
                "transcription_language": "hi",
                "is_video": 0,
                "is_internal": 1,
                "action_items": m.get("action_items"),
                "time_offset_start": m.get("time_offset_start", 0),
                "time_offset_end": m.get("time_offset_end", 0),
            })

        # 3. CRM Notes
        notes = NoteRepository._execute("""
            SELECT n.id, 'note' as type, null as outcome, n.content as notes, null as duration_minutes, n.created_at as date, n.user_id, u.name as user_name,
                   null as recording_file_name, null as recording_mime_type, null as recording_size_bytes, null as recording_duration_secs,
                   null as recording_drive_file_id, null as recording_drive_url,
                   null as transcription_text, null as transcription_confidence, null as transcription_language,
                   0 as is_video, 0 as is_internal
            FROM notes n 
            LEFT JOIN users u ON n.user_id = u.id 
            WHERE n.lead_id = ?
        """, (lead_id,), fetchall=True) or []

        activities = calls + mention_acts + notes
        activities.sort(key=lambda x: str(x.get('date') or ''), reverse=True)
        return activities
