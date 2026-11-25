import json
import uuid
from backend.repositories.base import BaseRepository


class DealRepository(BaseRepository):
    @staticmethod
    def _format_deal(deal):
        if not deal:
            return None
        from backend.database import Repository
        d = dict(deal)
        # Parse JSON fields safely
        for jfield in ['payment_milestones', 'deliverables']:
            val = d.get(jfield)
            if val and isinstance(val, str):
                try:
                    d[jfield] = json.loads(val)
                except Exception:
                    d[jfield] = []
            elif not val:
                d[jfield] = []

        d['value'] = float(d.get('value') or 0.0)
        d['amount_received'] = float(d.get('amount_received') or 0.0)
        d['pending_amount'] = max(0.0, d['value'] - d['amount_received'])
        d['payment_percentage'] = round((d['amount_received'] / d['value'] * 100) if d['value'] > 0 else 0, 1)

        # Standardize delivery_stage
        if not d.get('delivery_stage') or d.get('delivery_stage') in ['discovery', 'proposal', 'negotiation', 'won']:
            d['delivery_stage'] = 'in_development'

        # Auto-compute payment_status if unset or pending
        if d['value'] > 0 and d['amount_received'] >= d['value']:
            d['payment_status'] = 'paid'
        elif d['amount_received'] > 0 and d['amount_received'] < d['value']:
            d['payment_status'] = 'partially_paid'
        elif not d.get('payment_status'):
            d['payment_status'] = 'pending'

        # Count deliverables
        del_list = d.get('deliverables') or []
        d['deliverables_total'] = len(del_list)
        d['deliverables_completed'] = sum(1 for item in del_list if isinstance(item, dict) and (item.get('status') == 'completed' or item.get('completed') is True))
        d['deliverables_percentage'] = round((d['deliverables_completed'] / d['deliverables_total'] * 100) if d['deliverables_total'] > 0 else 0)

        # Attach associated lead info if available
        lead_id = d.get('lead_id')
        if lead_id:
            lead = Repository.get_lead(lead_id)
            if lead:
                d['lead_name'] = lead.get('name')
                d['lead_business_name'] = lead.get('business_name')
                d['lead_phone'] = lead.get('phone')
                d['lead_email'] = lead.get('email')
                d['lead_source'] = lead.get('source')
                d['lead_city'] = lead.get('city')
                d['project_path'] = d.get('project_path') or lead.get('project_path')
                d['project_id'] = d.get('project_id') or lead.get('project_id')
                d['project_name'] = d.get('project_name') or lead.get('project_name')
                if not d.get('demo_url'):
                    d['demo_url'] = lead.get('prototype_url') or lead.get('demo_video_url') or ''
                if not d.get('production_url') and lead.get('subdomain'):
                    d['production_url'] = f"https://{lead.get('subdomain')}"
        return d

    @staticmethod
    def create_deal(data: dict):
        deal_id = 'deal_' + uuid.uuid4().hex[:8]
        now = DealRepository.now()

        # Format JSON fields
        milestones = data.get('payment_milestones') or []
        if isinstance(milestones, (list, dict)):
            milestones = json.dumps(milestones)

        deliverables = data.get('deliverables') or []
        if isinstance(deliverables, (list, dict)):
            deliverables = json.dumps(deliverables)

        val = float(data.get('value') or 0.0)
        rec = float(data.get('amount_received') or 0.0)
        pstatus = data.get('payment_status') or ('paid' if (val > 0 and rec >= val) else ('partially_paid' if rec > 0 else 'pending'))
        dstage = data.get('delivery_stage') or 'in_development'

        DealRepository._execute(
            """INSERT INTO deals (
                id, lead_id, title, value, stage, city, assigned_to, expected_close, notes,
                delivery_stage, amount_received, payment_status, payment_milestones,
                github_repo_url, production_url, demo_url, proposal_url, proposal_title,
                deliverables, target_delivery_date, actual_delivery_date,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                deal_id, data.get('lead_id'), data.get('title'), val,
                data.get('stage', 'won'), data.get('city'), data.get('assigned_to'),
                data.get('expected_close') or data.get('target_delivery_date'), data.get('notes'),
                dstage, rec, pstatus, milestones,
                data.get('github_repo_url') or '', data.get('production_url') or '',
                data.get('demo_url') or '', data.get('proposal_url') or '', data.get('proposal_title') or '',
                deliverables, data.get('target_delivery_date') or data.get('expected_close') or '',
                data.get('actual_delivery_date') or '', now, now
            ),
            commit=True,
        )
        return DealRepository.get_deal(deal_id)

    @staticmethod
    def get_deal(deal_id: str):
        row = DealRepository._execute("SELECT * FROM deals WHERE id = ?", (deal_id,), fetchone=True)
        return DealRepository._format_deal(row)

    @staticmethod
    def update_deal(deal_id: str, data: dict):
        updates = []
        params = []
        for key, val in data.items():
            if val is not None:
                if key in ['payment_milestones', 'deliverables'] and isinstance(val, (list, dict)):
                    val = json.dumps(val)
                updates.append(f"{key} = ?")
                params.append(val)
        if updates:
            updates.append("updated_at = ?")
            params.append(DealRepository.now())
            query = f"UPDATE deals SET {', '.join(updates)} WHERE id = ?"
            params.append(deal_id)
            DealRepository._execute(query, tuple(params), commit=True)
        return DealRepository.get_deal(deal_id)

    @staticmethod
    def list_deals(filters: dict = None):
        query = "SELECT * FROM deals"
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
        rows = DealRepository._execute(query, tuple(params), fetchall=True)
        return [DealRepository._format_deal(r) for r in rows]

    @staticmethod
    def delete_deal(deal_id: str):
        from backend.database import Repository
        deal = DealRepository.get_deal(deal_id)
        if not deal:
            return None
        lead_id = deal.get('lead_id')
        if lead_id:
            lead = Repository.get_lead(lead_id)
            if lead and lead.get('status') == 'proposal':
                new_status = 'contacted' if lead.get('last_contacted_at') else 'new'
                Repository.update_lead(lead_id, {'status': new_status})
        DealRepository._execute("DELETE FROM deals WHERE id = ?", (deal_id,), commit=True)
        return {"status": "success", "deleted_deal_id": deal_id, "lead_id": lead_id}

    # ── Deal Milestones ──
    @staticmethod
    def create_deal_milestone(data: dict):
        mls_id = 'mls_' + uuid.uuid4().hex[:8]
        now = DealRepository.now()
        DealRepository._execute("""
            INSERT INTO deal_milestones (id, deal_id, milestone_name, target_amount, status, due_date, paid_date, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (mls_id, data.get('deal_id'), data.get('milestone_name', 'Milestone'),
              float(data.get('target_amount') or 0.0), data.get('status', 'pending'),
              data.get('due_date'), data.get('paid_date'), int(data.get('sort_order', 0)), now), commit=True)
        DealRepository._sync_deal_milestones_json(data.get('deal_id'))
        return DealRepository.get_deal_milestone(mls_id)

    @staticmethod
    def get_deal_milestone(mls_id: str):
        row = DealRepository._execute("SELECT * FROM deal_milestones WHERE id = ?", (mls_id,), fetchone=True)
        return dict(row) if row else None

    @staticmethod
    def update_deal_milestone(mls_id: str, data: dict):
        current = DealRepository.get_deal_milestone(mls_id)
        if not current:
            return None
        updates, params = [], []
        for k in ['milestone_name', 'target_amount', 'status', 'due_date', 'paid_date', 'sort_order']:
            if k in data and data[k] is not None:
                updates.append(f"{k} = ?")
                params.append(data[k])
        if updates:
            params.append(mls_id)
            DealRepository._execute(f"UPDATE deal_milestones SET {', '.join(updates)} WHERE id = ?", tuple(params), commit=True)
            DealRepository._sync_deal_milestones_json(current['deal_id'])
        return DealRepository.get_deal_milestone(mls_id)

    @staticmethod
    def delete_deal_milestone(mls_id: str):
        current = DealRepository.get_deal_milestone(mls_id)
        if current:
            DealRepository._execute("DELETE FROM deal_milestones WHERE id = ?", (mls_id,), commit=True)
            DealRepository._sync_deal_milestones_json(current['deal_id'])
            return True
        return False

    @staticmethod
    def list_deal_milestones(deal_id: str):
        rows = DealRepository._execute("SELECT * FROM deal_milestones WHERE deal_id = ? ORDER BY sort_order ASC, created_at ASC", (deal_id,), fetchall=True)
        return [dict(r) for r in rows]

    @staticmethod
    def _sync_deal_milestones_json(deal_id: str):
        milestones = DealRepository.list_deal_milestones(deal_id)
        json_data = json.dumps([{"name": m['milestone_name'], "amount": m['target_amount'], "status": m['status'], "due_date": m.get('due_date'), "paid_date": m.get('paid_date')} for m in milestones])
        DealRepository._execute("UPDATE deals SET payment_milestones = ? WHERE id = ?", (json_data, deal_id), commit=True)

    # ── Deal Payments (Cash Ledger) ──
    @staticmethod
    def record_deal_payment(data: dict):
        from backend.database import Repository
        pay_id = 'pay_' + uuid.uuid4().hex[:8]
        now = DealRepository.now()
        deal_id = data.get('deal_id')
        amount = float(data.get('amount') or 0.0)
        DealRepository._execute("""
            INSERT INTO deal_payments (id, deal_id, milestone_id, amount, payment_method, transaction_ref, notes, paid_at, recorded_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (pay_id, deal_id, data.get('milestone_id'), amount, data.get('payment_method', 'bank_transfer'),
              data.get('transaction_ref'), data.get('notes'), data.get('paid_at', now), data.get('recorded_by'), now), commit=True)

        total_res = DealRepository._execute("SELECT COALESCE(SUM(amount), 0.0) as total FROM deal_payments WHERE deal_id = ?", (deal_id,), fetchone=True)
        total_paid = float(total_res['total']) if total_res and 'total' in total_res else 0.0
        deal = DealRepository._execute("SELECT value FROM deals WHERE id = ?", (deal_id,), fetchone=True)
        val = float(deal['value'] or 0.0) if deal else 0.0
        p_status = 'paid' if (val > 0 and total_paid >= val) else ('partially_paid' if total_paid > 0 else 'pending')

        DealRepository._execute("UPDATE deals SET amount_received = ?, payment_status = ? WHERE id = ?", (total_paid, p_status, deal_id), commit=True)

        deal_row = DealRepository.get_deal(deal_id)
        lead_id = deal_row.get('lead_id') if deal_row else None
        if lead_id:
            Repository.log_activity(
                lead_id=lead_id,
                deal_id=deal_id,
                activity_type='payment_logged',
                title=f"Payment Received: ₹{amount:,.0f}",
                content=f"Recorded via {data.get('payment_method', 'bank_transfer')}. Ref: {data.get('transaction_ref') or 'N/A'}",
                metadata={'amount': amount, 'payment_id': pay_id, 'payment_method': data.get('payment_method')}
            )

        return DealRepository.get_deal_payment(pay_id)

    @staticmethod
    def get_deal_payment(pay_id: str):
        row = DealRepository._execute("SELECT * FROM deal_payments WHERE id = ?", (pay_id,), fetchone=True)
        return dict(row) if row else None

    @staticmethod
    def list_deal_payments(deal_id: str):
        rows = DealRepository._execute("SELECT p.*, u.name as recorded_by_name FROM deal_payments p LEFT JOIN users u ON p.recorded_by = u.id WHERE p.deal_id = ? ORDER BY p.paid_at DESC", (deal_id,), fetchall=True)
        return [dict(r) for r in rows]

    # ── Deal Deliverables (Scope Checklist) ──
    @staticmethod
    def create_deal_deliverable(data: dict):
        del_id = 'del_' + uuid.uuid4().hex[:8]
        now = DealRepository.now()
        DealRepository._execute("""
            INSERT INTO deal_deliverables (id, deal_id, title, description, status, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (del_id, data.get('deal_id'), data.get('title', 'Deliverable'), data.get('description', ''),
              data.get('status', 'pending'), int(data.get('sort_order', 0)), now), commit=True)
        DealRepository._sync_deal_deliverables_json(data.get('deal_id'))
        return DealRepository.get_deal_deliverable(del_id)

    @staticmethod
    def get_deal_deliverable(del_id: str):
        row = DealRepository._execute("SELECT * FROM deal_deliverables WHERE id = ?", (del_id,), fetchone=True)
        return dict(row) if row else None

    @staticmethod
    def update_deal_deliverable(del_id: str, data: dict):
        current = DealRepository.get_deal_deliverable(del_id)
        if not current:
            return None
        updates, params = [], []
        for k in ['title', 'description', 'status', 'completed_at', 'sort_order']:
            if k in data and data[k] is not None:
                updates.append(f"{k} = ?")
                params.append(data[k])
        if 'status' in data and data['status'] == 'completed' and not data.get('completed_at'):
            updates.append("completed_at = ?")
            params.append(DealRepository.now())
        if updates:
            params.append(del_id)
            DealRepository._execute(f"UPDATE deal_deliverables SET {', '.join(updates)} WHERE id = ?", tuple(params), commit=True)
            DealRepository._sync_deal_deliverables_json(current['deal_id'])
        return DealRepository.get_deal_deliverable(del_id)

    @staticmethod
    def delete_deal_deliverable(del_id: str):
        current = DealRepository.get_deal_deliverable(del_id)
        if current:
            DealRepository._execute("DELETE FROM deal_deliverables WHERE id = ?", (del_id,), commit=True)
            DealRepository._sync_deal_deliverables_json(current['deal_id'])
            return True
        return False

    @staticmethod
    def list_deal_deliverables(deal_id: str):
        rows = DealRepository._execute("SELECT * FROM deal_deliverables WHERE deal_id = ? ORDER BY sort_order ASC, created_at ASC", (deal_id,), fetchall=True)
        return [dict(r) for r in rows]

    @staticmethod
    def _sync_deal_deliverables_json(deal_id: str):
        deliverables = DealRepository.list_deal_deliverables(deal_id)
        json_data = json.dumps([{"title": d['title'], "description": d.get('description'), "status": d['status']} for d in deliverables])
        DealRepository._execute("UPDATE deals SET deliverables = ? WHERE id = ?", (json_data, deal_id), commit=True)

    # ── Deal Environments & Repositories ──
    @staticmethod
    def set_deal_environment(deal_id: str = None, env_type: str = 'github', label: str = 'Link', url: str = '', is_primary: int = 0, **kwargs):
        if isinstance(deal_id, dict):
            d = deal_id
            deal_id = d.get('deal_id')
            env_type = d.get('env_type', d.get('env_name', 'github'))
            label = d.get('label', 'Link')
            url = d.get('url', '')
            is_primary = int(d.get('is_primary', 0))
        now = DealRepository.now()
        existing = DealRepository._execute("SELECT id FROM deal_environments WHERE deal_id = ? AND env_type = ?", (deal_id, env_type), fetchone=True)
        if existing:
            DealRepository._execute("""
                UPDATE deal_environments SET label = ?, url = ?, is_primary = ? WHERE id = ?
            """, (label, url, is_primary, existing['id']), commit=True)
            return DealRepository._execute("SELECT * FROM deal_environments WHERE id = ?", (existing['id'],), fetchone=True)
        else:
            env_id = 'env_' + uuid.uuid4().hex[:8]
            DealRepository._execute("""
                INSERT INTO deal_environments (id, deal_id, env_type, label, url, is_primary, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (env_id, deal_id, env_type, label, url, is_primary, now), commit=True)
            return DealRepository._execute("SELECT * FROM deal_environments WHERE id = ?", (env_id,), fetchone=True)

    @staticmethod
    def list_deal_environments(deal_id: str):
        rows = DealRepository._execute("SELECT * FROM deal_environments WHERE deal_id = ? ORDER BY is_primary DESC, env_type ASC", (deal_id,), fetchall=True)
        return [dict(r) for r in rows]
