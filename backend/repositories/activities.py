import json
import uuid
from backend.repositories.base import BaseRepository


class ActivityRepository(BaseRepository):
    @staticmethod
    def log_activity(lead_id=None, activity_type='note', title='Activity', content='', deal_id=None, actor_id=None, metadata=None, **kwargs):
        from backend.database import Repository
        if isinstance(lead_id, dict):
            d = lead_id
            lead_id = d.get('lead_id')
            activity_type = d.get('activity_type', 'note')
            title = d.get('title', d.get('summary', 'Activity'))
            content = d.get('content', d.get('summary', ''))
            deal_id = d.get('deal_id')
            actor_id = d.get('actor_id')
            metadata = d.get('metadata')
        if not lead_id and deal_id:
            deal_row = Repository.get_deal(deal_id)
            if deal_row:
                lead_id = deal_row.get('lead_id')
        act_id = 'actv_' + uuid.uuid4().hex[:8]
        now = ActivityRepository.now()
        meta_str = json.dumps(metadata or {})
        ActivityRepository._execute("""
            INSERT INTO activities (id, lead_id, deal_id, actor_id, activity_type, title, content, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (act_id, lead_id, deal_id, actor_id, activity_type, title, content, meta_str, now), commit=True)
        return ActivityRepository.get_activity(act_id)

    create_activity = log_activity

    @staticmethod
    def get_activity(activity_id: str):
        row = ActivityRepository._execute("SELECT * FROM activities WHERE id = ?", (activity_id,), fetchone=True)
        if not row:
            return None
        d = dict(row)
        try:
            d['metadata'] = json.loads(d['metadata']) if d.get('metadata') else {}
        except Exception:
            d['metadata'] = {}
        return d

    @staticmethod
    def get_lead_activities(lead_id: str, limit: int = 50):
        from backend.database import Repository
        rows = ActivityRepository._execute("""
            SELECT a.*, u.name as actor_name
            FROM activities a
            LEFT JOIN users u ON a.actor_id = u.id
            WHERE a.lead_id = ?
            ORDER BY a.created_at DESC
            LIMIT ?
        """, (lead_id, limit), fetchall=True)

        if rows and len(rows) > 0:
            res = []
            for r in rows:
                d = dict(r)
                try:
                    d['metadata'] = json.loads(d['metadata']) if d.get('metadata') else {}
                except Exception:
                    d['metadata'] = {}
                res.append(d)
            return res

        # Fallback to legacy activities if activities table has not been populated
        return Repository.get_lead_activity(lead_id)
