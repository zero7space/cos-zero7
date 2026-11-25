"""
COS Theta — PostgreSQL Database Schema Definitions
Native PostgreSQL schema with proper data types and indexing.
"""

from backend.db.indexes import INDEXES

POSTGRES_SCHEMA_SQL = """
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        password_hash TEXT,
        role TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        business_name TEXT,
        phone TEXT,
        phone_normalized TEXT,
        email TEXT,
        website TEXT,
        city TEXT,
        temperature TEXT DEFAULT 'warm',
        call_stage TEXT DEFAULT 'uncontacted',
        source TEXT,
        status TEXT,
        pipeline_stage TEXT DEFAULT 'new',
        assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
        meta_form_id TEXT,
        meta_ad_name TEXT,
        priority TEXT DEFAULT 'unexplored',
        deal_value DOUBLE PRECISION,
        next_action TEXT,
        next_action_date TEXT,
        next_action_priority TEXT DEFAULT 'medium',
        last_update_notes TEXT,
        channel_data TEXT DEFAULT '{}',
        project_path TEXT,
        project_id TEXT,
        project_name TEXT,
        subdomain TEXT,
        subdomain_status TEXT DEFAULT 'pending',
        dns_record_id TEXT,
        demo_video_url TEXT,
        demo_video_title TEXT,
        demo_video_status TEXT DEFAULT 'pending',
        prototype_status TEXT DEFAULT 'pending',
        prototype_url TEXT,
        prototype_rep_context TEXT DEFAULT '{}',
        google_task_id TEXT,
        github_repo_url TEXT DEFAULT '',
        github_repo_status TEXT DEFAULT 'pending',
        cached_file_tree TEXT DEFAULT '[]',
        drive_folder_id TEXT DEFAULT '',
        drive_folder_url TEXT DEFAULT '',
        last_contacted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS deals (
        id TEXT PRIMARY KEY,
        lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
        title TEXT,
        value DOUBLE PRECISION,
        stage TEXT,
        delivery_stage TEXT DEFAULT 'in_development',
        amount_received DOUBLE PRECISION DEFAULT 0.0,
        payment_status TEXT DEFAULT 'pending',
        payment_milestones TEXT DEFAULT '[]',
        github_repo_url TEXT DEFAULT '',
        production_url TEXT DEFAULT '',
        demo_url TEXT DEFAULT '',
        proposal_url TEXT DEFAULT '',
        proposal_title TEXT DEFAULT '',
        deliverables TEXT DEFAULT '[]',
        city TEXT,
        assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
        expected_close TEXT,
        target_delivery_date TEXT DEFAULT '',
        actual_delivery_date TEXT DEFAULT '',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS call_logs (
        id TEXT PRIMARY KEY,
        lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        outcome TEXT,
        notes TEXT,
        duration_minutes INTEGER,
        is_video INTEGER DEFAULT 0,
        recording_file_name TEXT,
        recording_mime_type TEXT,
        recording_size_bytes BIGINT,
        recording_duration_secs INTEGER,
        recording_drive_file_id TEXT,
        recording_drive_url TEXT,
        transcription_text TEXT,
        transcription_drive_file_id TEXT,
        transcription_confidence DOUBLE PRECISION,
        transcription_language TEXT,
        called_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS whatsapp_accounts (
        id TEXT PRIMARY KEY,
        phone_number TEXT UNIQUE NOT NULL,
        label TEXT,
        is_active INTEGER DEFAULT 1,
        last_synced_at TEXT,
        created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id TEXT PRIMARY KEY,
        account_id TEXT,
        account_phone TEXT NOT NULL,
        lead_phone TEXT NOT NULL,
        lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
        direction TEXT NOT NULL,
        message_text TEXT,
        message_type TEXT DEFAULT 'text',
        media_caption TEXT,
        media_url TEXT,
        timestamp TEXT NOT NULL,
        wa_message_id TEXT UNIQUE,
        status TEXT DEFAULT 'delivered',
        created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS company_briefs (
        id TEXT PRIMARY KEY,
        lead_id TEXT UNIQUE NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        executive_summary TEXT,
        operational_bottlenecks TEXT,
        zero7_opportunity TEXT,
        recommended_tech TEXT,
        estimated_budget TEXT,
        pitch_hook TEXT,
        industry_tags TEXT,
        raw_json TEXT,
        status TEXT DEFAULT 'completed',
        created_at TEXT,
        updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS lead_prototypes (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        html_content TEXT NOT NULL,
        conversation_history TEXT,
        share_token TEXT UNIQUE NOT NULL,
        view_count INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_jobs (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        client_id TEXT,
        project_id TEXT,
        project_name TEXT,
        project_path TEXT,
        prompt TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        role TEXT DEFAULT 'engineer',
        agent_slug TEXT DEFAULT 'prototype_maker',
        conversation_id TEXT,
        model TEXT DEFAULT 'pro',
        stream_output TEXT DEFAULT '',
        thoughts TEXT DEFAULT '',
        artifacts TEXT DEFAULT '[]',
        rep_context TEXT DEFAULT '{}',
        error_message TEXT DEFAULT '',
        created_at TEXT,
        updated_at TEXT,
        completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_worker_heartbeats (
        worker_id TEXT PRIMARY KEY,
        machine_name TEXT,
        user_email TEXT,
        user_name TEXT,
        os_info TEXT,
        ip_address TEXT,
        install_path TEXT,
        projects_root TEXT,
        device_token TEXT,
        is_paired INTEGER DEFAULT 1,
        last_seen TEXT NOT NULL,
        status TEXT DEFAULT 'online',
        metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS google_tasks_config (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        client_id TEXT,
        client_secret TEXT,
        access_token TEXT,
        refresh_token TEXT,
        token_expiry TEXT,
        task_list_id TEXT,
        task_list_title TEXT,
        is_active INTEGER DEFAULT 1,
        auto_sync INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS agent_conversation_transcripts (
        conversation_id TEXT PRIMARY KEY,
        project_id TEXT,
        messages TEXT,
        updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_worker_commands (
        id TEXT PRIMARY KEY,
        command_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'assistant',
        description TEXT,
        model TEXT DEFAULT 'pro',
        fallback_model TEXT DEFAULT 'none',
        system_prompt TEXT,
        default_pills TEXT DEFAULT '[]',
        assigned_skills TEXT DEFAULT '[]',
        mcp_servers TEXT DEFAULT '[]',
        autonomy_level TEXT DEFAULT 'approval_required',
        is_active INTEGER DEFAULT 1,
        created_at TEXT,
        updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS skills_registry (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        skill_md_content TEXT,
        scripts TEXT DEFAULT '{}',
        created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS custom_data_pills (
        id TEXT PRIMARY KEY,
        tag TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL,
        category TEXT DEFAULT 'Custom Context',
        description TEXT,
        source_type TEXT DEFAULT 'vault',
        resolver_payload TEXT,
        created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        server_type TEXT DEFAULT 'sse',
        config TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_actions (
        id TEXT PRIMARY KEY,
        lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
        agent_slug TEXT NOT NULL,
        action_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        result TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TEXT,
        created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS lead_attributions (
        id TEXT PRIMARY KEY,
        lead_id TEXT UNIQUE NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        campaign_id TEXT,
        campaign_name TEXT,
        ad_set_id TEXT,
        ad_set_name TEXT,
        ad_id TEXT,
        ad_name TEXT,
        creative_type TEXT,
        creative_thumb_url TEXT,
        form_id TEXT,
        form_answers TEXT,
        raw_payload TEXT,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deal_milestones (
        id TEXT PRIMARY KEY,
        deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
        milestone_name TEXT NOT NULL,
        target_amount DOUBLE PRECISION NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        due_date TEXT,
        paid_date TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deal_payments (
        id TEXT PRIMARY KEY,
        deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
        milestone_id TEXT REFERENCES deal_milestones(id) ON DELETE SET NULL,
        amount DOUBLE PRECISION NOT NULL,
        payment_method TEXT DEFAULT 'bank_transfer',
        transaction_ref TEXT,
        notes TEXT,
        paid_at TEXT NOT NULL,
        recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deal_deliverables (
        id TEXT PRIMARY KEY,
        deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        completed_at TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deal_environments (
        id TEXT PRIMARY KEY,
        deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
        env_type TEXT NOT NULL,
        label TEXT NOT NULL,
        url TEXT NOT NULL,
        is_primary INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subdomain_routes (
        id TEXT PRIMARY KEY,
        lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
        deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
        subdomain TEXT UNIQUE NOT NULL,
        target_ip TEXT NOT NULL DEFAULT '68.183.92.215',
        cloudflare_record_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        ssl_active INTEGER NOT NULL DEFAULT 1,
        verified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
        deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        activity_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS zoho_mail_metadata (
        message_id TEXT PRIMARY KEY,
        label_id TEXT,
        starred INTEGER,
        unread INTEGER,
        folder_override TEXT,
        updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS zoho_mail_labels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        bg TEXT NOT NULL,
        created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS zoho_emails_cache (
        message_id TEXT PRIMARY KEY,
        folder_id TEXT,
        folder_key TEXT NOT NULL DEFAULT 'inbox',
        thread_id TEXT,
        thread_key TEXT,
        thread_count INTEGER DEFAULT 1,
        subject TEXT,
        summary TEXT,
        sender_name TEXT,
        recipient_name TEXT,
        from_email TEXT,
        from_display TEXT,
        to_display TEXT,
        cc_display TEXT,
        to_emails_json TEXT DEFAULT '[]',
        cc_emails_json TEXT DEFAULT '[]',
        matched_aliases_json TEXT DEFAULT '[]',
        alias_email TEXT,
        alias_name TEXT,
        timestamp BIGINT DEFAULT 0,
        is_unread INTEGER DEFAULT 0,
        is_starred INTEGER DEFAULT 0,
        is_important INTEGER DEFAULT 0,
        has_attachment INTEGER DEFAULT 0,
        has_inline INTEGER DEFAULT 0,
        label TEXT DEFAULT 'primary',
        size BIGINT DEFAULT 0,
        html_content TEXT,
        attachments_json TEXT DEFAULT '[]',
        inline_images_json TEXT DEFAULT '[]',
        raw_json TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS zoho_attachments_cache (
        id TEXT PRIMARY KEY,
        folder_id TEXT,
        message_id TEXT,
        attachment_id TEXT,
        cid TEXT,
        filename TEXT NOT NULL,
        content_type TEXT NOT NULL,
        file_size BIGINT DEFAULT 0,
        blob_data BYTEA,
        cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lead_facts (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        field_name TEXT NOT NULL,
        proposed_value TEXT,
        current_value TEXT,
        source TEXT NOT NULL,
        quote_evidence TEXT,
        confidence DOUBLE PRECISION DEFAULT 1.0,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        applied_at TIMESTAMPTZ,
        applied_by TEXT REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sentinel_alerts_log (
        id TEXT PRIMARY KEY,
        lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
        aberration_type TEXT NOT NULL,
        severity TEXT DEFAULT 'medium',
        nag_message TEXT NOT NULL,
        group_target TEXT DEFAULT 'Zero7',
        wa_message_id TEXT,
        status TEXT DEFAULT 'sent',
        dispatched_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS zero7_group_messages (
        id TEXT PRIMARY KEY,
        wa_message_id TEXT UNIQUE,
        sender_phone TEXT,
        sender_name TEXT,
        message_text TEXT,
        is_audio INTEGER DEFAULT 0,
        media_url TEXT,
        linked_lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
        matched_lead_name TEXT,
        timestamp TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sentinel_lead_context (
        lead_id TEXT PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
        lead_name TEXT,
        business_name TEXT,
        synthesized_context TEXT,
        group_mentions_summary TEXT DEFAULT '',
        call_insights_summary TEXT DEFAULT '',
        commitments_made TEXT DEFAULT '[]',
        unresolved_questions TEXT DEFAULT '[]',
        last_context_update TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS call_lead_mentions (
        id TEXT PRIMARY KEY,
        call_id TEXT NOT NULL REFERENCES call_logs(id) ON DELETE CASCADE,
        lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        topic TEXT,
        notes TEXT,
        transcript_excerpt TEXT,
        action_items TEXT,
        time_offset_start INTEGER DEFAULT 0,
        time_offset_end INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );
"""


def init_postgres_db(conn):
    """Initializes all PostgreSQL tables and indexes."""
    with conn.cursor() as cur:
        cur.execute(POSTGRES_SCHEMA_SQL)
        for idx in INDEXES:
            try:
                cur.execute(idx)
            except Exception:
                pass
    conn.commit()
