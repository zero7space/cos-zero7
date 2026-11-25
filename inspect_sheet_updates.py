import openpyxl
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

wb = openpyxl.load_workbook('test_sheet.xlsx')
ws = wb['Lead form - Higher intent']
rows = list(ws.iter_rows(values_only=True))
header = [str(c).strip() if c is not None else f'col_{i}' for i, c in enumerate(rows[0])]

print("Header columns:", header)

active_updates = []
for idx, r in enumerate(rows[1:], start=2):
    row_dict = {k: v for k, v in zip(header, r)}
    if not any(row_dict.values()):
        continue
    
    name = row_dict.get('full_name')
    updates = row_dict.get('UPDATES')
    meeting = row_dict.get('MEEETING')
    next_step = row_dict.get('NEXT STEP')
    priority = row_dict.get('Priority')
    lead_status = row_dict.get('lead_status')

    if updates or meeting or (priority and str(priority).lower() in ['high', 'urgent', 'hot']) or next_step:
        active_updates.append({
            'row': idx,
            'name': name,
            'company': row_dict.get('company_name'),
            'phone': row_dict.get('phone_number'),
            'priority': priority,
            'next_step': next_step,
            'updates': updates,
            'meeting': meeting,
            'status': lead_status
        })

print(f"\nTotal rows with Priority/Updates/Meeting/Next Step notes: {len(active_updates)}")
for u in active_updates[-15:]:
    print(f"\nRow {u['row']}: {u['name']} ({u['company']})")
    print(f"  Priority: {u['priority']} | Status: {u['status']}")
    print(f"  Next Step: {u['next_step']}")
    if u['updates']:
        print(f"  Updates: {u['updates']}")
    if u['meeting']:
        print(f"  Meeting: {u['meeting']}")
