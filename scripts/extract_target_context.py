#!/usr/bin/env python3
import json, re, sys
sys.stdout.reconfigure(encoding='utf-8')

with open('scratch/transcripts/call_d5312302_20261006_001139_96m.txt', 'r', encoding='utf-8') as f:
    text_96m = f.read()

with open('scratch/transcripts/call_6dd86267_20261005_210630_37m.txt', 'r', encoding='utf-8') as f:
    text_37m = f.read()

# Keywords to extract context
leads_to_find = [
    ("City Bike Rental", ["city bike", "bike rental", "भोपाल", "city by"]),
    ("Pooja Deora / Aashish Agency", ["आशीष agency", "aashish agency", "pooja", "पूजा", "deora"]),
    ("Subham Rai / Gaurika Fresh Foods", ["gaurika", "गौरिका", "केले", "fresh food", "fresh foods"]),
    ("Shadab Ali Syed / Promis Dental", ["promis", "dental", "डेंटल", "shadab"]),
    ("Vivek Kedia / Signature World", ["kedia", "केड़िया", "signature", "garment"]),
    ("Mustanshir Gandhi / Bombay Surgical", ["bombay surgical", "gandhi", "mustanshir", "सर्जिकल"]),
    ("Harshad Tanna / Surgi Pack", ["harshad", "tanna", "surgi"]),
    ("Aaloke kr / TATL (Trident Agro)", ["tatl", "trident", "aaloke", "आलोक"]),
    ("Anshul Bajaj / Civil CAD", ["bajaj", "बजाज", "anshul", "अंशुल", "lisp", "cad"]),
    ("Jagdeep Sharma / Anushka Eye Hospital", ["anushka", "अनुष्का", "jagdeep", "eye hospital"]),
    ("Naresh Vyas / Naresh Electrical", ["naresh", "नरेश", "vyas"]),
    ("Vishal Dama / Unique Security", ["vishal", "विशाल", "dama", "धामा", "unique security"]),
    ("Manthan Mehta / Giriraj Plastic", ["giriraj", "गिर्राज", "plastic"]),
    ("Shalini Sharma / Mahalaxmi Green", ["mahalaxmi", "महालक्ष्मी", "green venture"]),
    ("Babu Gupta / Guru Kripa Electronics", ["babu gupta", "बाबू गुप्ता", "guru kripa", "electronics"]),
    ("Carfy Auto Workshop Bhilai", ["carfy", "कार्फी", "bhilai"]),
    ("Het Sanghavi / Medi Pharma", ["het", "sanghavi", "medi pharma"]),
    ("Raj / ONUS Impression", ["onus", "raj", "impression"]),
    ("Rajesh Singh / RRC Logistic", ["rrc", "rajesh singh", "logistic"]),
    ("Mohd Iqbal Shaikh / Building Material", ["iqbal", "इकबाल", "building material"]),
    ("Sachin / Mr. Farmer India", ["mr.farmer", "mr farmer", "farmer"]),
    ("SK / Supreme Auto", ["supreme auto", "supreme"]),
    ("Vinit / Bhavesh Mehta (Mumbai)", ["vinit", "bhavesh", "विनीत", "भावेश"]),
]

combined = text_96m + "\n\n" + text_37m
results = {}

for label, kws in leads_to_find:
    found_snippets = []
    # search around matches in combined text
    for kw in kws:
        for m in re.finditer(re.escape(kw), combined, re.IGNORECASE):
            start = max(0, m.start() - 350)
            end = min(len(combined), m.end() + 450)
            snip = combined[start:end].replace('\n', ' ')
            found_snippets.append(snip)
    if found_snippets:
        results[label] = found_snippets[:3] # keep top 3

print(f"Found detailed discussions for {len(results)} target leads!")
with open('scratch/target_leads_context.json', 'w', encoding='utf-8') as out_f:
    json.dump(results, out_f, ensure_ascii=False, indent=2)

for lbl, snips in results.items():
    print(f"\n==========================================")
    print(f"LEAD: {lbl}")
    print(f"==========================================")
    for idx, s in enumerate(snips, 1):
        print(f"[{idx}] ...{s.strip()}...\n")
