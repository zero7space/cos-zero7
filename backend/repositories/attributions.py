import json
import uuid
from backend.repositories.base import BaseRepository


class AttributionRepository(BaseRepository):
    @staticmethod
    def save_lead_attribution(lead_id: str, data: dict):
        now = AttributionRepository.now()
        existing = AttributionRepository._execute("SELECT id FROM lead_attributions WHERE lead_id = ?", (lead_id,), fetchone=True)
        answers_str = json.dumps(data.get('form_answers', [])) if isinstance(data.get('form_answers'), (list, dict)) else str(data.get('form_answers') or '[]')
        payload_str = json.dumps(data.get('raw_payload', {})) if isinstance(data.get('raw_payload'), (list, dict)) else str(data.get('raw_payload') or '{}')

        if existing:
            AttributionRepository._execute("""
                UPDATE lead_attributions SET platform = ?, campaign_id = ?, campaign_name = ?, ad_set_id = ?, ad_set_name = ?,
                                             ad_id = ?, ad_name = ?, creative_type = ?, creative_thumb_url = ?, form_id = ?,
                                             form_answers = ?, raw_payload = ?
                WHERE id = ?
            """, (
                data.get('platform', 'meta_ads'), data.get('campaign_id'), data.get('campaign_name'),
                data.get('ad_set_id'), data.get('ad_set_name'), data.get('ad_id'), data.get('ad_name'),
                data.get('creative_type'), data.get('creative_thumb_url'), data.get('form_id'),
                answers_str, payload_str, existing['id']
            ), commit=True)
            return AttributionRepository._execute("SELECT * FROM lead_attributions WHERE id = ?", (existing['id'],), fetchone=True)
        else:
            attr_id = 'attr_' + uuid.uuid4().hex[:8]
            AttributionRepository._execute("""
                INSERT INTO lead_attributions (id, lead_id, platform, campaign_id, campaign_name, ad_set_id, ad_set_name,
                                               ad_id, ad_name, creative_type, creative_thumb_url, form_id, form_answers,
                                               raw_payload, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                attr_id, lead_id, data.get('platform', 'meta_ads'), data.get('campaign_id'), data.get('campaign_name'),
                data.get('ad_set_id'), data.get('ad_set_name'), data.get('ad_id'), data.get('ad_name'),
                data.get('creative_type'), data.get('creative_thumb_url'), data.get('form_id'),
                answers_str, payload_str, now
            ), commit=True)
            return AttributionRepository._execute("SELECT * FROM lead_attributions WHERE id = ?", (attr_id,), fetchone=True)

    @staticmethod
    def get_lead_attribution(lead_id: str):
        row = AttributionRepository._execute("SELECT * FROM lead_attributions WHERE lead_id = ?", (lead_id,), fetchone=True)
        if not row:
            return None
        d = dict(row)
        try:
            d['form_answers'] = json.loads(d['form_answers']) if d.get('form_answers') else []
            d['raw_payload'] = json.loads(d['raw_payload']) if d.get('raw_payload') else {}
        except Exception:
            pass
        return d
