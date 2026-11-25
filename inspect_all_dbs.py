import sqlite3
import os

dbs = [f for f in os.listdir('.') if f.endswith('.db') or f.endswith('.sqlite')]
print("Found databases:", dbs)

for db in dbs:
    try:
        conn = sqlite3.connect(db)
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [r[0] for r in cur.fetchall()]
        print(f"\n=== Database: {db} ===")
        print("Tables:", tables[:10])
        for t in ['leads', 'lead', 'meta_leads']:
            if t in tables:
                cur.execute(f"SELECT COUNT(*) FROM {t}")
                print(f"  Table '{t}' count: {cur.fetchone()[0]}")
    except Exception as e:
        print(f"Error reading {db}:", e)
