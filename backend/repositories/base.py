"""
COS Theta — Base Repository
Provides dual-dialect query execution, automatic placeholder adaptation,
connection pooling, and retry logic.
"""

import datetime
import re
import time
from backend.db.connection import get_connection, get_dialect, release_connection


class BaseRepository:
    @staticmethod
    def now() -> str:
        return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    @staticmethod
    def _execute(
        query: str,
        params: tuple = (),
        commit: bool = False,
        fetchone: bool = False,
        fetchall: bool = False,
        retries: int = 5,
    ):
        dialect = get_dialect()
        last_err = None

        # Adapt placeholders for PostgreSQL if necessary
        exec_query = query
        if dialect == "postgres":
            exec_query = query.replace("?", "%s")

        for attempt in range(retries):
            conn = None
            try:
                conn = get_connection()
                c = conn.cursor()
                c.execute(exec_query, params)
                if commit:
                    conn.commit()

                res = None
                if fetchone:
                    row = c.fetchone()
                    if row:
                        res = dict(row)
                elif fetchall:
                    rows = c.fetchall()
                    if rows:
                        res = [dict(row) for row in rows]
                    else:
                        res = []
                return res
            except Exception as e:
                last_err = e
                err_str = str(e).lower()

                if conn and dialect == "postgres":
                    try:
                        conn.rollback()
                    except Exception:
                        pass

                if "locked" in err_str or "busy" in err_str or "deadlock" in err_str:
                    time.sleep(0.05 * (attempt + 1))
                    continue
                raise e
            finally:
                if conn:
                    release_connection(conn)

        if last_err:
            raise last_err
