#!/usr/bin/env python3
import csv, glob, re, os, sys

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
    if name:
        leads.append({'row': idx, 'name': name, 'comp': comp, 'city': city, 'prio': prio, 'status': status, 'upd': upd, 'phone': phone})

transcript_texts = {}
for path in glob.glob('scratch/transcripts/*.txt'):
    with open(path, 'r', encoding='utf-8') as f:
        transcript_texts[path] = f.read()

print(f"Total leads in sheet: {len(leads)}")
print(f"Total transcript files loaded: {len(transcript_texts)}")

matches = []
for lead in leads:
    lname = lead['name'].lower()
    lcomp = lead['comp'].lower() if lead['comp'] else ''
    
    tokens = [t for t in re.split(r'\s+', lname) if len(t) >= 4 and t not in ('self', 'employed', 'traders', 'creation', 'services', 'enterprises', 'private', 'limited', 'message', 'calling', 'before')]
    if lcomp and len(lcomp) >= 4 and lcomp not in ('self-employed', 'business', 'entrepreneur'):
        tokens.extend([t for t in re.split(r'\s+', lcomp) if len(t) >= 4 and t not in ('private', 'limited', 'enterprises', 'industries', 'system', 'systems')])
    
    found_in = []
    for path, text in transcript_texts.items():
        text_lower = text.lower()
        matched_tokens = [tok for tok in tokens if tok in text_lower]
        if matched_tokens:
            found_in.append((os.path.basename(path), matched_tokens))
    
    if found_in:
        matches.append((lead, found_in))

print(f"\nMatched {len(matches)} leads directly in current transcripts:")
for lead, fin in matches:
    print(f"Row {lead['row']:3d} | {lead['name']:<25} | Comp: {lead['comp']:<20} | In: {fin}")
