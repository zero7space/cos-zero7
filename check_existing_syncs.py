import urllib.request, json

req = urllib.request.Request('https://cos.zero7.space/api/auth/login',
    data=json.dumps({'email':'abhijeet@zero7.space','password':'admin123'}).encode(),
    headers={'Content-Type':'application/json'})
token = json.loads(urllib.request.urlopen(req).read())['token']

req2 = urllib.request.Request('https://cos.zero7.space/api/leads', headers={'Authorization': 'Bearer ' + token})
leads = json.loads(urllib.request.urlopen(req2).read())

print(f"Total leads in CRM: {len(leads)}")
already_synced = {}
for l in leads:
    lid = l['id']
    req_act = urllib.request.Request('https://cos.zero7.space/api/leads/' + lid, headers={'Authorization': 'Bearer ' + token})
    detail = json.loads(urllib.request.urlopen(req_act).read())
    activity = detail.get('activity', [])
    calls = [a for a in activity if a.get('type') == 'call']
    notes = [a for a in activity if a.get('type') == 'note']
    if calls or notes:
        recordings = [c.get('recording_file_name') for c in calls if c.get('recording_file_name')]
        already_synced[l['name']] = {
            'phone': l.get('phone'),
            'calls_count': len(calls),
            'recordings': recordings,
            'notes_count': len(notes)
        }
        print(f"[{l['name']}] (Phone: {l.get('phone')}): {len(calls)} calls ({len(recordings)} with audio), {len(notes)} notes")

print("\nSummary of already synced leads:", list(already_synced.keys()))
