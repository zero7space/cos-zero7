import json
import uuid
from backend.repositories.base import BaseRepository


class PrototypeRepository(BaseRepository):
    @staticmethod
    def get_lead_prototypes(lead_id: str):
        protos = PrototypeRepository._execute("""
            SELECT id, lead_id, title, description, share_token, view_count, created_at, updated_at
            FROM lead_prototypes
            WHERE lead_id = ?
            ORDER BY created_at DESC
        """, (lead_id,), fetchall=True)
        return protos

    @staticmethod
    def get_prototype_by_id(proto_id: str):
        proto = PrototypeRepository._execute("SELECT * FROM lead_prototypes WHERE id = ?", (proto_id,), fetchone=True)
        if proto and proto.get('conversation_history'):
            try:
                proto['conversation_history'] = json.loads(proto['conversation_history'])
            except Exception:
                proto['conversation_history'] = []
        return proto

    @staticmethod
    def get_prototype_by_token(token: str):
        return PrototypeRepository._execute("SELECT * FROM lead_prototypes WHERE share_token = ?", (token,), fetchone=True)

    @staticmethod
    def save_prototype(lead_id: str, data: dict, proto_id: str = None):
        now = PrototypeRepository.now()
        conv_str = json.dumps(data.get('conversation_history', [])) if isinstance(data.get('conversation_history'), list) else data.get('conversation_history', '[]')

        if proto_id:
            PrototypeRepository._execute("""
                UPDATE lead_prototypes SET
                    title = COALESCE(?, title),
                    description = COALESCE(?, description),
                    html_content = COALESCE(?, html_content),
                    conversation_history = COALESCE(?, conversation_history),
                    updated_at = ?
                WHERE id = ?
            """, (
                data.get('title'),
                data.get('description'),
                data.get('html_content'),
                conv_str,
                now, proto_id
            ), commit=True)
            return PrototypeRepository.get_prototype_by_id(proto_id)
        else:
            new_id = 'proto_' + uuid.uuid4().hex[:8]
            token = uuid.uuid4().hex[:12]
            PrototypeRepository._execute("""
                INSERT INTO lead_prototypes (
                    id, lead_id, title, description, html_content, conversation_history, share_token, view_count, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """, (
                new_id, lead_id,
                data.get('title', 'Interactive Prototype'),
                data.get('description', ''),
                data.get('html_content', ''),
                conv_str,
                token,
                now, now
            ), commit=True)
            return PrototypeRepository.get_prototype_by_id(new_id)

    @staticmethod
    def increment_prototype_views(token: str):
        PrototypeRepository._execute("UPDATE lead_prototypes SET view_count = view_count + 1 WHERE share_token = ?", (token,), commit=True)
