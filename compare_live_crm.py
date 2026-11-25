import json
import openpyxl
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

with open('live_crm_leads.json', 'r', encoding='utf-8') as f:
    live_leads = json.load(f)

print(f"Total leads from Live CRM API (https://cos.zero7.space/api): {len(live_leads)}")

wb = openpyxl.load_workbook('test_sheet.xlsx')
ws = wb['Lead form - Higher intent']
rows = list(ws.iter_rows(values_only=True))
header = [str(c).strip() if c is not None else f'col_{i}' for i, c in enumerate(rows[0])]

sheet_leads = []
for idx, r in enumerate(rows[1:], start=2):
    row_dict = {k: v for k, v in zip(header, r)}
    if not any(row_dict.values()):
        continue
    
    name = str(row_dict.get('full_name') or '').strip()
    if not name:
        continue
    
    phone_raw = str(row_dict.get('phone_number') or '').strip()
    email_raw = str(row_dict.get('email') or '').strip()
    
    # Handle shifted columns in rows 102, 103, 104
    next_step = str(row_dict.get('NEXT STEP') or '').strip()
    if next_step.startswith('p:'):
        phone_raw = next_step
        email_raw = str(row_dict.get('phone_number') or '').strip()
        company = str(row_dict.get('Priority') or '').strip()
        city = str(row_dict.get('company_name') or '').strip()
    else:
        company = str(row_dict.get('company_name') or '').strip()
        city = str(row_dict.get('city') or '').strip()

    sheet_leads.append({
        'row_num': idx,
        'id': str(row_dict.get('id') or ''),
        'name': name,
        'company': company,
        'phone_raw': phone_raw,
        'phone_norm': normalize_phone(phone_raw),
        'email_raw': email_raw,
        'email_norm': normalize_email(email_raw),
        'city': city,
        'created_time': str(row_dict.get('created_time') or ''),
        'status': str(row_dict.get('lead_status') or ''),
        'next_step': str(row_dict.get('NEXT STEP') or ''),
        'priority': str(row_dict.get('Priority') or ''),
        'updates': str(row_dict.get('UPDATES') or ''),
        'meeting': str(row_dict.get('MEEETING') or '')
    })

print(f"Total non-empty leads in Sheet: {len(sheet_leads)}")

# Index sheet
sheet_by_phone = {s['phone_norm']: s for s in sheet_leads if s['phone_norm']}
sheet_by_email = {s['email_norm']: s for s in sheet_leads if s['email_norm']}
sheet_by_id = {}
for s in sheet_leads:
    if s['id']:
        clean_id = s['id'].replace('l:', '')
        sheet_by_id[clean_id] = s
        sheet_by_id[s['id']] = s

# Check which Live CRM leads are missing from the Sheet
missing_in_sheet = []
matched_in_sheet = []

for l in live_leads:
    lp = normalize_phone(l.get('phone') or l.get('phone_normalized') or '')
    le = normalize_email(l.get('email') or '')
    lid = str(l.get('id') or '')
    
    # Also check if lead has meta leadgen_id in channel_data
    cdata = l.get('channel_data') or {}
    if isinstance(cdata, str):
        try:
            cdata = json.loads(cdata)
        except Exception:
            cdata = {}
    leadgen_id = str(cdata.get('leadgen_id') or '')

    match = None
    if lp and lp in sheet_by_phone:
        match = sheet_by_phone[lp]
    elif le and le in sheet_by_email:
        match = sheet_by_email[le]
    elif leadgen_id and (leadgen_id in sheet_by_id or f"l:{leadgen_id}" in sheet_by_id):
        match = sheet_by_id[leadgen_id]

    if match:
        matched_in_sheet.append((l, match))
    else:
        missing_in_sheet.append(l)

print(f"\nMatched: {len(matched_in_sheet)}")
print(f"Missing in Sheet from Live CRM: {len(missing_in_sheet)}")

print("\n--- LEADS IN LIVE CRM THAT ARE MISSING FROM THE SHEET ---")
for l in missing_in_sheet:
    print(f"• ID: {l.get('id')} | Name: {l.get('name')} | Business: {l.get('business_name')} | Phone: {l.get('phone')} | City: {l.get('city')} | Source: {l.get('source')} | Form: {l.get('meta_form_id')} | Created: {l.get('created_at')}")

# Also check which Sheet leads are missing from Live CRM
live_phones = {normalize_phone(l.get('phone') or l.get('phone_normalized') or ''): l for l in live_leads if l.get('phone') or l.get('phone_normalized')}
live_emails = {normalize_email(l.get('email') or ''): l for l in live_leads if l.get('email')}

missing_in_live_crm = []
for s in sheet_leads:
    if s['phone_norm'] not in live_phones and s['email_norm'] not in live_emails:
        missing_in_live_crm.append(s)

print(f"\n--- LEADS IN SHEET MISSING FROM LIVE CRM: {len(missing_in_live_crm)} ---")
for s in missing_in_live_crm:
    print(f"• Row {s['row_num']}: {s['name']} | Company: {s['company']} | Phone: {s['phone_raw']} | Email: {s['email_raw']} | City: {s['city']} | Created: {s['created_time']}")
