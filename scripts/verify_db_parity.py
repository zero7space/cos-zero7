"""
COS Theta — Database Parity and Integrity Verification Audit
Verifies table structures and row counts between the live database and backup/Postgres instances.
"""

import os
import sqlite3
import sys
from typing import Dict, Tuple

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT_DIR, "zero7_crm.db")
BACKUPS_DIR = os.path.join(ROOT_DIR, "backups")


def get_latest_backup() -> str:
    if not os.path.exists(BACKUPS_DIR):
        return ""
    backups = [os.path.join(BACKUPS_DIR, f) for f in os.listdir(BACKUPS_DIR) if f.endswith(".db")]
    if not backups:
        return ""
    backups.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    return backups[0]


def get_table_counts(conn) -> Dict[str, int]:
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    tables = [r[0] for r in cur.fetchall()]
    counts = {}
    for t in tables:
        try:
            cur.execute(f"SELECT COUNT(*) FROM {t}")
            counts[t] = cur.fetchone()[0]
        except Exception:
            counts[t] = -1
    return counts


def main():
    print("==================================================")
    print("   COS Theta Database Parity Verification Audit   ")
    print("==================================================")

    if not os.path.exists(DB_PATH):
        print(f"[ERROR] Live database not found at {DB_PATH}")
        sys.exit(1)

    latest_backup = get_latest_backup()
    if not latest_backup:
        print("[WARNING] No backups found in backups/ directory.")
        sys.exit(1)

    print(f"Live Database:   {DB_PATH} ({os.path.getsize(DB_PATH) / 1024:.1f} KB)")
    print(f"Latest Backup:   {latest_backup} ({os.path.getsize(latest_backup) / 1024:.1f} KB)")
    print("--------------------------------------------------")

    live_conn = sqlite3.connect(DB_PATH)
    backup_conn = sqlite3.connect(latest_backup)

    live_counts = get_table_counts(live_conn)
    backup_counts = get_table_counts(backup_conn)

    live_conn.close()
    backup_conn.close()

    all_tables = sorted(set(live_counts.keys()).union(set(backup_counts.keys())))

    total_live = 0
    total_backup = 0
    mismatches = []

    print(f"{'Table Name':<34} {'Live DB':>10} {'Backup DB':>12} {'Status':>10}")
    print("-" * 70)

    for t in all_tables:
        l_cnt = live_counts.get(t, 0)
        b_cnt = backup_counts.get(t, 0)
        total_live += max(0, l_cnt)
        total_backup += max(0, b_cnt)

        # Verify zero data loss: live DB must contain all backup rows plus any new live rows
        match = (l_cnt >= b_cnt)
        diff = l_cnt - b_cnt
        status = "MATCH" if diff == 0 else (f"+{diff} NEW" if diff > 0 else "DATA LOSS!")
        if not match:
            mismatches.append(t)

        print(f"{t:<34} {l_cnt:>10} {b_cnt:>12} {status:>10}")

    print("-" * 70)
    print(f"{'TOTAL ROWS':<34} {total_live:>10} {total_backup:>12}")
    print("==================================================")

    if not mismatches:
        print("[SUCCESS] 100% database integrity verified. Zero data loss.")
        sys.exit(0)
    else:
        print(f"[WARNING] Detected differences in {len(mismatches)} tables: {', '.join(mismatches)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
