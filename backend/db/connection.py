"""
COS Theta — Dual-Dialect Database Connection Manager
Seamlessly routes queries to PostgreSQL when DATABASE_URL is set,
and falls back to SQLite with WAL mode for local zero-dependency development.
"""

import os
import sqlite3
from typing import Optional, Union
from backend.config import settings

DB_PATH = settings.db_path

# Global PostgreSQL connection pool (initialized lazily)
_pg_pool = None


def get_dialect() -> str:
    """Returns 'postgres' if DATABASE_URL is set, otherwise 'sqlite'."""
    url = settings.database_url or os.environ.get("DATABASE_URL", "")
    return "postgres" if url else "sqlite"


def get_sqlite_connection(timeout: float = 60.0) -> sqlite3.Connection:
    """Creates a configured SQLite connection with busy timeout and WAL support."""
    db_path = settings.db_path
    conn = sqlite3.connect(db_path, timeout=timeout, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute(f"PRAGMA busy_timeout = {int(timeout * 1000)}")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("PRAGMA journal_mode = WAL")
    except Exception:
        pass
    return conn


def _get_pg_pool():
    """Initializes or returns the thread-safe PostgreSQL connection pool."""
    global _pg_pool
    if _pg_pool is None:
        try:
            import psycopg2.pool
            from psycopg2.extras import RealDictCursor
        except ImportError as e:
            raise RuntimeError(
                "psycopg2 is required for PostgreSQL connections. Install it with: pip install psycopg2-binary"
            ) from e

        dsn = settings.database_url or os.environ.get("DATABASE_URL", "")
        # Handle sslmode requirement for cloud providers (Supabase, Neon, etc.)
        if "sslmode" not in dsn and ("supabase" in dsn or "pooler" in dsn):
            separator = "&" if "?" in dsn else "?"
            dsn = f"{dsn}{separator}sslmode=require"

        _pg_pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=20,
            dsn=dsn,
            cursor_factory=RealDictCursor,
        )
    return _pg_pool


def get_postgres_connection():
    """Checks out a PostgreSQL connection from the connection pool."""
    pool = _get_pg_pool()
    return pool.getconn()


def get_connection(timeout: float = 60.0):
    """
    Returns an active database connection for the configured dialect.
    Always release connections with release_connection(conn).
    """
    if get_dialect() == "postgres":
        return get_postgres_connection()
    return get_sqlite_connection(timeout=timeout)


def release_connection(conn) -> None:
    """Releases a connection back to the pool or closes it cleanly."""
    if conn is None:
        return
    dialect = get_dialect()
    if dialect == "postgres":
        global _pg_pool
        if _pg_pool is not None:
            try:
                _pg_pool.putconn(conn)
            except Exception:
                pass
    else:
        try:
            conn.close()
        except Exception:
            pass


def close_all_pools() -> None:
    """Closes all connection pools on application shutdown."""
    global _pg_pool
    if _pg_pool is not None:
        try:
            _pg_pool.closeall()
        except Exception:
            pass
        _pg_pool = None
