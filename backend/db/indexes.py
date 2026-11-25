"""
COS Theta — Database Index Definitions
Indexes for high-performance querying on leads, messages, deals, and emails.
"""

INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_wa_messages_lead ON whatsapp_messages(lead_id)",
    "CREATE INDEX IF NOT EXISTS idx_wa_messages_phone ON whatsapp_messages(lead_phone)",
    "CREATE INDEX IF NOT EXISTS idx_wa_messages_ts ON whatsapp_messages(timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_wa_messages_account ON whatsapp_messages(account_phone)",
    "CREATE INDEX IF NOT EXISTS idx_agent_jobs_lead ON agent_jobs(lead_id)",
    "CREATE INDEX IF NOT EXISTS idx_agent_jobs_status ON agent_jobs(status)",
    "CREATE INDEX IF NOT EXISTS idx_leads_phone_norm ON leads(phone_normalized)",
    "CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(pipeline_stage)",
    "CREATE INDEX IF NOT EXISTS idx_activities_lead ON activities(lead_id)",
    "CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_deal_milestones_deal ON deal_milestones(deal_id)",
    "CREATE INDEX IF NOT EXISTS idx_deal_payments_deal ON deal_payments(deal_id)",
    "CREATE INDEX IF NOT EXISTS idx_deal_deliverables_deal ON deal_deliverables(deal_id)",
    "CREATE INDEX IF NOT EXISTS idx_deal_environments_deal ON deal_environments(deal_id)",
    "CREATE INDEX IF NOT EXISTS idx_subdomain_routes_lead ON subdomain_routes(lead_id)",
    "CREATE INDEX IF NOT EXISTS idx_subdomain_routes_sub ON subdomain_routes(subdomain)",
    "CREATE INDEX IF NOT EXISTS idx_zoho_emails_folder ON zoho_emails_cache(folder_key)",
    "CREATE INDEX IF NOT EXISTS idx_zoho_emails_ts ON zoho_emails_cache(timestamp DESC)",
    "CREATE INDEX IF NOT EXISTS idx_zoho_emails_thread ON zoho_emails_cache(thread_key)",
    "CREATE INDEX IF NOT EXISTS idx_zoho_emails_alias ON zoho_emails_cache(alias_email)",
    "CREATE INDEX IF NOT EXISTS idx_zoho_attachments_msg ON zoho_attachments_cache(message_id)",
    "CREATE INDEX IF NOT EXISTS idx_lead_facts_lead ON lead_facts(lead_id)",
    "CREATE INDEX IF NOT EXISTS idx_lead_facts_status ON lead_facts(status)",
    "CREATE INDEX IF NOT EXISTS idx_sentinel_lead_aberration ON sentinel_alerts_log(lead_id, aberration_type, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_sentinel_created ON sentinel_alerts_log(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_zero7_group_msgs_ts ON zero7_group_messages(timestamp DESC)",
    "CREATE INDEX IF NOT EXISTS idx_zero7_group_msgs_lead ON zero7_group_messages(linked_lead_id)",
    "CREATE INDEX IF NOT EXISTS idx_sentinel_lead_ctx_upd ON sentinel_lead_context(last_context_update DESC)",
    "CREATE INDEX IF NOT EXISTS idx_users_phone_norm ON users(phone_normalized)",
    "CREATE INDEX IF NOT EXISTS idx_call_logs_internal ON call_logs(is_internal, teammate_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_call_lead_mentions_call ON call_lead_mentions(call_id)",
    "CREATE INDEX IF NOT EXISTS idx_call_lead_mentions_lead ON call_lead_mentions(lead_id)",
]


def create_indexes(cursor):
    for idx_sql in INDEXES:
        try:
            cursor.execute(idx_sql)
        except Exception:
            pass
