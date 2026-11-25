import sqlite3
import json

conn = sqlite3.connect('zero7_crm.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

ids = ['lead_6be083b3', 'lead_c823c3af', 'lead_ae60bba7', 'lead_87c70232', 'lead_6ebd97a9', 'lead_5e7a1f30']
for lid in ids:
    cur.execute("SELECT * FROM leads WHERE id = ?", (lid,))
    row = dict(cur.fetchone())
    print(f"=== {lid} ({row.get('name')}) ===")
    for k, v in row.items():
        if v:
            print(f"  {k}: {v}")
