import urllib.request

url = 'https://docs.google.com/spreadsheets/d/1hYCgiSy1upKN7BqsILAL5vSz1O-6wrLNyxK7XZldCxI/edit?usp=sharing'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req) as resp:
    html = resp.read().decode('utf-8', errors='ignore')

idx = html.find('Lead from Higher Intent')
if idx != -1:
    print("Found 'Lead from Higher Intent' at index", idx)
    print(html[max(0, idx-200):idx+300])
else:
    print("'Lead from Higher Intent' not directly found in raw HTML")
