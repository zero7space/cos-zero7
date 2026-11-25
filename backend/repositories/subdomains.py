import uuid
from backend.repositories.base import BaseRepository


class SubdomainRepository(BaseRepository):
    @staticmethod
    def register_subdomain_route(lead_id=None, subdomain: str = '', target_ip: str = '68.183.92.215', cf_record_id: str = None, **kwargs):
        from backend.database import Repository
        deal_id = None
        if isinstance(lead_id, dict):
            d = lead_id
            lead_id = d.get('lead_id')
            deal_id = d.get('deal_id')
            subdomain = d.get('subdomain', '')
            target_ip = d.get('target_ip', '68.183.92.215')
            cf_record_id = d.get('cf_record_id')
        else:
            deal_id = kwargs.get('deal_id')

        if not lead_id and deal_id:
            deal_row = Repository.get_deal(deal_id)
            if deal_row:
                lead_id = deal_row.get('lead_id')

        now = SubdomainRepository.now()
        clean_sub = subdomain.lower().strip()
        existing = SubdomainRepository._execute(
            "SELECT id FROM subdomain_routes WHERE subdomain = ? OR (lead_id IS NOT NULL AND lead_id = ?)",
            (clean_sub, lead_id),
            fetchone=True,
        )
        if existing:
            SubdomainRepository._execute("""
                UPDATE subdomain_routes SET subdomain = ?, target_ip = ?, cloudflare_record_id = COALESCE(?, cloudflare_record_id), deal_id = COALESCE(?, deal_id), updated_at = ?
                WHERE id = ?
            """, (clean_sub, target_ip, cf_record_id, deal_id, now, existing['id']), commit=True)
            return SubdomainRepository._execute("SELECT * FROM subdomain_routes WHERE id = ?", (existing['id'],), fetchone=True)
        else:
            sbd_id = 'sbd_' + uuid.uuid4().hex[:8]
            SubdomainRepository._execute("""
                INSERT INTO subdomain_routes (id, lead_id, deal_id, subdomain, target_ip, cloudflare_record_id, status, ssl_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)
            """, (sbd_id, lead_id, deal_id, clean_sub, target_ip, cf_record_id, now, now), commit=True)
            return SubdomainRepository._execute("SELECT * FROM subdomain_routes WHERE id = ?", (sbd_id,), fetchone=True)

    @staticmethod
    def get_subdomain_route(subdomain_or_lead_id: str):
        clean = subdomain_or_lead_id.lower().strip()
        row = SubdomainRepository._execute("SELECT * FROM subdomain_routes WHERE subdomain = ? OR lead_id = ?", (clean, clean), fetchone=True)
        return dict(row) if row else None
