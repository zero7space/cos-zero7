import urllib.request, urllib.parse, csv, io

sheet_id = '1hYCgiSy1upKN7BqsILAL5vSz1O-6wrLNyxK7XZldCxI'
sheet_name = 'Lead form - Higher intent'
url = f'https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={urllib.parse.quote(sheet_name)}'

req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
content = urllib.request.urlopen(req).read().decode('utf-8')
reader = csv.reader(io.StringIO(content))
rows = list(reader)

priorities = {}
sample_leads = []
for r in rows[1:]:
    p = r[16].strip() if len(r) > 16 else ''
    priorities[p] = priorities.get(p, 0) + 1
    name = r[15] if len(r) > 15 else ''
    phone = r[17] if len(r) > 17 else ''
    sample_leads.append((name, phone, p))

print('Priority value breakdown in sheet:')
for p, count in sorted(priorities.items()):
    print(f'  "{p}": {count}')

print('\nSample 15 rows (Name, Phone, Priority):')
for item in sample_leads[:15]:
    print(f'  {item[0]} | {item[1]} | Priority: {item[2]}')
