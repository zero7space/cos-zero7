import os
import sys
import sqlite3
import hashlib
import datetime

BACKUP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backups")
os.makedirs(BACKUP_DIR, exist_ok=True)

SOURCE_DB = os.environ.get(
    "ZERO7_DB_PATH",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "zero7_crm.db")
)

def compute_sha256(filepath: str) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def backup_database() -> str:
    if not os.path.exists(SOURCE_DB):
        raise FileNotFoundError(f"Source database not found at {SOURCE_DB}")

    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = os.path.join(BACKUP_DIR, f"zero7_crm_backup_{timestamp}.db")

    print(f"[*] Starting immutable backup of: {SOURCE_DB}")
    print(f"[*] Size: {os.path.getsize(SOURCE_DB) / 1024 / 1024:.2f} MB")

    # Use SQLite's online backup API to ensure 100% ACID consistency even during concurrent reads
    src_conn = sqlite3.connect(SOURCE_DB)
    dst_conn = sqlite3.connect(backup_file)

    with dst_conn:
        src_conn.backup(dst_conn, pages=100)

    dst_conn.close()

    # Compute SHA-256 of backup
    checksum = compute_sha256(backup_file)
    print(f"[+] Backup written to: {backup_file}")
    print(f"[+] SHA-256 Checksum: {checksum}")

    # Verify table row counts on backup
    c = src_conn.cursor()
    tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()]
    
    b_conn = sqlite3.connect(backup_file)
    bc = b_conn.cursor()

    print("\n--- Table Verification Audit ---")
    verified_all = True
    for t in sorted(tables):
        src_cnt = c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        bak_cnt = bc.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        status = "MATCH" if src_cnt == bak_cnt else "MISMATCH!"
        if src_cnt != bak_cnt:
            verified_all = False
        print(f"  {t:32s}: {src_cnt:4d} rows | Backup: {bak_cnt:4d} rows [{status}]")

    src_conn.close()
    b_conn.close()

    if not verified_all:
        raise ValueError("Backup table row counts do not match source database!")

    # Write checksum manifest
    manifest_file = os.path.join(BACKUP_DIR, f"zero7_crm_backup_{timestamp}.sha256")
    with open(manifest_file, "w", encoding="utf-8") as f:
        f.write(f"{checksum}  {os.path.basename(backup_file)}\n")

    print(f"\n[SUCCESS] Backup verified perfectly! Manifest saved to {manifest_file}\n")
    return backup_file

if __name__ == "__main__":
    backup_database()
