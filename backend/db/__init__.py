"""
COS Theta — Database Initialization & Core Connection Interface
Modular database package supporting both SQLite and PostgreSQL.
"""

from backend.db.connection import DB_PATH, get_connection, get_dialect, release_connection
from backend.db.schema import SCHEMA_SQL
from backend.db.indexes import create_indexes
from backend.db.migrations import run_migrations, run_backfills


def init_db():
    """Initializes tables, safe column migrations, performance indexes, and historical data backfills."""
    dialect = get_dialect()

    if dialect == "postgres":
        from backend.db.postgres_schema import init_postgres_db
        conn = get_connection()
        try:
            init_postgres_db(conn)
        finally:
            release_connection(conn)
        return

    # SQLite initialization
    conn = get_connection()
    try:
        conn.execute("PRAGMA journal_mode = WAL")
    except Exception:
        pass
    c = conn.cursor()

    # 1. Primary Table Schemas
    c.executescript(SCHEMA_SQL)

    # 2. Backward-compatible column migrations
    run_migrations(c)

    # 3. High-performance indexes
    create_indexes(c)

    # 4. Safe data backfills & cleanups
    run_backfills(c)

    conn.commit()
    conn.close()

    # Enable WAL mode for optimal concurrent performance
    try:
        wal_conn = get_connection()
        wal_conn.execute("PRAGMA journal_mode = WAL")
        wal_conn.close()
    except Exception:
        pass


__all__ = ["DB_PATH", "get_connection", "get_dialect", "release_connection", "init_db"]
