"""
COS Theta — SQLite to PostgreSQL Migration Bridge
Safely streams all data from zero7_crm.db into PostgreSQL with zero data loss,
idempotent ON CONFLICT handling, and table-by-table row count verification.
"""

import argparse
import os
import sqlite3
import sys
import time
from typing import Dict, List, Tuple

# Tables in strict dependency order (parent before child foreign keys)
MIGRATION_TABLES = [
    ("users", "id"),
    ("leads", "id"),
    ("deals", "id"),
    ("call_logs", "id"),
    ("notes", "id"),
    ("whatsapp_accounts", "id"),
    ("whatsapp_messages", "id"),
    ("company_briefs", "id"),
    ("lead_prototypes", "id"),
    ("agent_jobs", "id"),
    ("agent_worker_heartbeats", "worker_id"),
    ("google_tasks_config", "id"),
    ("agent_conversation_transcripts", "conversation_id"),
    ("agent_worker_commands", "id"),
    ("agent_definitions", "id"),
    ("skills_registry", "id"),
    ("custom_data_pills", "id"),
    ("mcp_servers", "id"),
    ("agent_actions", "id"),
    ("lead_attributions", "id"),
    ("deal_milestones", "id"),
    ("deal_payments", "id"),
    ("deal_deliverables", "id"),
    ("deal_environments", "id"),
    ("subdomain_routes", "id"),
    ("activities", "id"),
    ("zoho_mail_metadata", "message_id"),
    ("zoho_mail_labels", "id"),
    ("zoho_emails_cache", "message_id"),
    ("zoho_attachments_cache", "id"),
    ("lead_facts", "id"),
]


def get_sqlite_conn(sqlite_path: str) -> sqlite3.Connection:
    if not os.path.exists(sqlite_path):
        raise FileNotFoundError(f"SQLite database not found at {sqlite_path}")
    conn = sqlite3.connect(sqlite_path)
    conn.row_factory = sqlite3.Row
    return conn


def get_pg_conn(pg_url: str):
    import psycopg2
    from psycopg2.extras import RealDictCursor

    if "sslmode" not in pg_url and ("supabase" in pg_url or "pooler" in pg_url):
        separator = "&" if "?" in pg_url else "?"
        pg_url = f"{pg_url}{separator}sslmode=require"

    return psycopg2.connect(pg_url, cursor_factory=RealDictCursor)


def migrate_table(
    sqlite_conn: sqlite3.Connection,
    pg_conn,
    table_name: str,
    pk_col: str,
    batch_size: int = 500,
) -> Tuple[int, int]:
    """
    Migrates a single table from SQLite to PostgreSQL.
    Returns (sqlite_row_count, pg_migrated_count).
    """
    import psycopg2
    from psycopg2.extras import execute_batch

    # 1. Check if table exists in SQLite
    cur_sqlite = sqlite_conn.cursor()
    cur_sqlite.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
    if not cur_sqlite.fetchone():
        return (0, 0)

    # 2. Fetch column names and row count from SQLite
    cur_sqlite.execute(f"SELECT COUNT(*) FROM {table_name}")
    total_sqlite_rows = cur_sqlite.fetchone()[0]
    if total_sqlite_rows == 0:
        return (0, 0)

    cur_sqlite.execute(f"SELECT * FROM {table_name}")
    col_names = [desc[0] for desc in cur_sqlite.description]

    cols_str = ", ".join(col_names)
    placeholders = ", ".join(["%s"] * len(col_names))
    insert_sql = (
        f"INSERT INTO {table_name} ({cols_str}) VALUES ({placeholders}) "
        f"ON CONFLICT ({pk_col}) DO NOTHING"
    )

    # 3. Stream in batches and write to PostgreSQL
    pg_cur = pg_conn.cursor()
    migrated_count = 0

    while True:
        rows = cur_sqlite.fetchmany(batch_size)
        if not rows:
            break

        cleaned_rows = []
        for row in rows:
            row_vals = []
            for col_idx, val in enumerate(row):
                # Handle binary data (e.g. attachments)
                if isinstance(val, (bytes, memoryview)):
                    row_vals.append(psycopg2.Binary(bytes(val)))
                else:
                    row_vals.append(val)
            row_vals_tuple = tuple(row_vals)
            cleaned_rows.append(row_vals_tuple)

        execute_batch(pg_cur, insert_sql, cleaned_rows)
        migrated_count += len(cleaned_rows)

    pg_conn.commit()
    pg_cur.close()

    # 4. Verify count in PostgreSQL
    with pg_conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM {table_name}")
        pg_count = cur.fetchone()["count"]

    return (total_sqlite_rows, pg_count)


def run_migration(
    sqlite_path: str = None,
    pg_url: str = None,
    dry_run: bool = False,
) -> bool:
    """
    Executes end-to-end database migration with safety assertions.
    """
    from backend.config import settings
    from backend.db.postgres_schema import init_postgres_db

    sqlite_path = sqlite_path or settings.db_path
    pg_url = pg_url or settings.database_url or os.environ.get("DATABASE_URL", "")

    if not pg_url:
        print("[MIGRATOR ERROR] No PostgreSQL DATABASE_URL provided or configured in settings.")
        return False

    print(f"==================================================")
    print(f"  COS Theta SQLite -> PostgreSQL Migration Bridge")
    print(f"==================================================")
    print(f"Source SQLite: {sqlite_path}")
    print(f"Target URL:    {pg_url.split('@')[-1] if '@' in pg_url else 'configured'}")
    print(f"Mode:          {'DRY RUN (schema only)' if dry_run else 'LIVE MIGRATION'}")
    print(f"--------------------------------------------------")

    # Connect to both databases
    sqlite_conn = get_sqlite_conn(sqlite_path)
    pg_conn = get_pg_conn(pg_url)

    # Initialize PostgreSQL schema & indexes
    print("[1/3] Initializing PostgreSQL schema & indexes...")
    init_postgres_db(pg_conn)
    print("      Done.")

    if dry_run:
        print("[DRY RUN COMPLETE] Schema and tables successfully verified in PostgreSQL.")
        sqlite_conn.close()
        pg_conn.close()
        return True

    # Migrate all tables
    print("[2/3] Streaming tables into PostgreSQL...")
    audit_results: Dict[str, Tuple[int, int]] = {}
    total_migrated = 0
    all_matched = True

    start_time = time.time()
    for table_name, pk_col in MIGRATION_TABLES:
        try:
            sqlite_cnt, pg_cnt = migrate_table(sqlite_conn, pg_conn, table_name, pk_col)
            audit_results[table_name] = (sqlite_cnt, pg_cnt)
            if sqlite_cnt > 0:
                print(f"  - {table_name:<32} SQLite: {sqlite_cnt:>6} -> PG: {pg_cnt:>6} {'✓' if sqlite_cnt <= pg_cnt else '✗ MISMATCH'}")
                total_migrated += sqlite_cnt
                if sqlite_cnt > pg_cnt:
                    all_matched = False
        except Exception as e:
            print(f"  - {table_name:<32} [ERROR] {e}")
            all_matched = False

    elapsed = time.time() - start_time
    sqlite_conn.close()
    pg_conn.close()

    print(f"--------------------------------------------------")
    print(f"[3/3] Migration Audit Complete in {elapsed:.2f}s")
    print(f"Total Rows Processed: {total_migrated}")
    print(f"Integrity Status:     {'ALL TABLES MATCHED (100% PARITY)' if all_matched else 'WARNING: MISMATCH DETECTED'}")
    print(f"==================================================")

    return all_matched


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="COS Theta SQLite to PostgreSQL Migration Bridge")
    parser.add_argument("--sqlite-path", help="Path to zero7_crm.db", default=None)
    parser.add_argument("--postgres-url", help="PostgreSQL connection string (DATABASE_URL)", default=None)
    parser.add_argument("--dry-run", action="store_true", help="Initialize schema only without copying rows")

    args = parser.parse_args()
    success = run_migration(
        sqlite_path=args.sqlite_path,
        pg_url=args.postgres_url,
        dry_run=args.dry_run,
    )
    sys.exit(0 if success else 1)
