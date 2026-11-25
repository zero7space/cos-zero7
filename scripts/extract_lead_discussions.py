#!/usr/bin/env python3
"""
Deep lead extraction across all call transcripts.
Matches leads from live_sheet_higher_intent.csv and extracts:
- Lead details (name, company, phone, priority, status)
- Context discussed between Abhijeet and Shailesh
- Concrete decisions, actions, and next steps mentioned in the calls.
"""
import csv, glob, re, os, sys, json

sys.stdout.reconfigure(encoding='utf-8')

with open('live_sheet_higher_intent.csv', 'r', encoding='utf-8', errors='ignore') as f:
    sheet_rows = list(csv.reader(f))

leads = []
for idx, r in enumerate(sheet_rows[1:], start=2):
    if not any(r): continue
    name = r[15].strip() if len(r) > 15 else ''
    comp = r[19].strip() if len(r) > 19 else ''
    city = r[21].strip() if len(r) > 21 else ''
    prio = r[17].strip() if len(r) > 17 else ''
    status = r[22].strip() if len(r) > 22 else ''
    upd = r[23].strip() if len(r) > 23 else ''
    phone = r[18].strip() if len(r) > 18 else ''
    biz = r[12].strip() if len(r) > 12 else ''
    rev = r[14].strip() if len(r) > 14 else ''
    if name:
        leads.append({
            'row': idx, 'name': name, 'comp': comp, 'city': city,
            'prio': prio, 'status': status, 'upd': upd, 'phone': phone,
            'biz': biz, 'rev': rev
        })

# Load all transcripts
transcripts = {}
for path in glob.glob('scratch/transcripts/*.txt'):
    with open(path, 'r', encoding='utf-8') as f:
        transcripts[os.path.basename(path)] = f.read()

# Keywords to match leads
lead_analyses = []

for lead in leads:
    # Build search terms for this lead
    search_terms = []
    # Clean name
    clean_name = re.sub(r'\(.*?\)', '', lead['name']).strip()
    name_parts = [p.lower() for p in clean_name.split() if len(p) >= 3]
    if name_parts:
        search_terms.extend(name_parts)
    
    clean_comp = re.sub(r'\(.*?\)', '', lead['comp']).strip()
    comp_parts = [p.lower() for p in clean_comp.split() if len(p) >= 3 and p.lower() not in ('pvt', 'ltd', 'india', 'private', 'limited', 'self', 'employed', 'business')]
    if comp_parts:
        search_terms.extend(comp_parts)

    # Search in transcripts
    lead_snippets = []
    for fname, t_text in transcripts.items():
        # Split text into paragraphs or blocks
        paras = t_text.split('\n\n')
        for i, para in enumerate(paras):
            para_lower = para.lower()
            matched = [term for term in search_terms if term in para_lower]
            if len(matched) >= 2 or (len(matched) == 1 and len(matched[0]) >= 5):
                # Context snippet: grab prev, curr, next para
                start_p = max(0, i - 1)
                end_p = min(len(paras), i + 2)
                snippet = '\n'.join([p.strip() for p in paras[start_p:end_p] if p.strip()])
                lead_snippets.append({
                    'file': fname,
                    'matched': matched,
                    'snippet': snippet[:800]
                })

    if lead_snippets:
        lead_analyses.append({
            'lead': lead,
            'snippets': lead_snippets
        })

print(f"Extracted discussions for {len(lead_analyses)} leads.")
with open('scratch/lead_discussions.json', 'w', encoding='utf-8') as out_f:
    json.dump(lead_analyses, out_f, ensure_ascii=False, indent=2)

for la in lead_analyses:
    lead = la['lead']
    print(f"\n[Row {lead['row']:3d}] {lead['name']} ({lead['comp']}) - Prio: {lead['prio']} - Upd: {lead['upd'][:30]}")
    for s in la['snippets'][:2]:
        print(f"   [{s['file']}] Matched: {s['matched']}")
        first_line = s['snippet'].replace('\n', ' ')[:140]
        print(f"   -> {first_line}...")
