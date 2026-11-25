import openpyxl
import sqlite3
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

def normalize_phone(phone_str):
    if not phone_str:
        return ""
    digits = re.sub(r'\D', '', str(phone_str))
    if len(digits) == 12 and digits.startswith('91'):
        return digits[2:]
    if len(digits) == 11 and digits.startswith('0'):
        return digits[1:]
    if len(digits) >= 10:
        return digits[-10:]
    return digits

def normalize_email(email_str):
    if not email_str:
        return ""
    return str(email_str).strip().lower()

wb = openpyxl.load_workbook('test_sheet.xlsx')
ws = wb['Lead form - Higher intent']
rows = list(ws.iter_rows(values_only=True))
header = [str(c).strip() if c is not None else f'col_{i}' for i, c in enumerate(rows[0])]

conn = sqlite3.connect('zero7_crm.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()
cur.execute("SELECT * FROM leads")
crm_leads = [dict(r) for r in cur.fetchall()]
crm_phones = {normalize_phone(c.get('phone') or c.get('phone_normalized') or ''): c for c in crm_leads if c.get('phone') or c.get('phone_normalized')}
crm_emails = {normalize_email(c.get('email') or ''): c for c in crm_leads if c.get('email')}

sheet_missing = []
for idx, r in enumerate(rows[1:], start=2):
    row_dict = {k: v for k, v in zip(header, r)}
    
    # Check if empty row
    if not any(row_dict.values()):
        continue
    
    name = str(row_dict.get('full_name') or '').strip()
    if not name:
        continue

    phone_raw = str(row_dict.get('phone_number') or '').strip()
    email_raw = str(row_dict.get('email') or '').strip()
    
    # Special fix for shifted columns in rows 102, 103, 104
    next_step = str(row_dict.get('NEXT STEP') or '').strip()
    if next_step.startswith('p:'):
        phone_raw = next_step
        email_raw = str(row_dict.get('phone_number') or '').strip()
        company = str(row_dict.get('Priority') or '').strip()
        city = str(row_dict.get('company_name') or '').strip()
    else:
        company = str(row_dict.get('company_name') or '').strip()
        city = str(row_dict.get('city') or '').strip()

    p_norm = normalize_phone(phone_raw)
    e_norm = normalize_email(email_raw)

    if p_norm not in crm_phones and e_norm not in crm_emails:
        sheet_missing.append({
            'row': idx,
            'id': row_dict.get('id'),
            'name': name,
            'company': company,
            'phone': phone_raw,
            'email': email_raw,
            'city': city,
            'revenue': row_dict.get('what_is_your_approximate_monthly_revenue?'),
            'business': row_dict.get('what_does_your_business_do?'),
            'created_time': row_dict.get('created_time'),
            'status': row_dict.get('lead_status'),
            'next_step': row_dict.get('NEXT STEP'),
            'priority': row_dict.get('Priority')
        })

print(f"Total non-empty sheet leads missing in CRM: {len(sheet_missing)}")
for s in sheet_missing:
    print(f"Row {s['row']:3d} | {s['name']:<25} | {s['company']:<30} | {s['phone']:<18} | {s['email']:<30} | {s['city']:<15} | {s['created_time']}")
