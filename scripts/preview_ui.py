"""Run the real COS Theta app locally against an isolated database snapshot.

python scripts/preview_ui.py --port 8766
No background ingestion, remote connections, live messages or agent execution.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8766)
args = parser.parse_args()
snapshot_dir = ROOT / 'scratch' / 'ui-preview'
snapshot_dir.mkdir(exist_ok=True)
snapshot = snapshot_dir / ('snapshot-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + '.db')
with sqlite3.connect('file:' + (ROOT / 'zero7_crm.db').as_posix() + '?mode=ro', uri=True) as source:
    with sqlite3.connect(snapshot) as destination:
        source.backup(destination)
os.environ['ZERO7_DB_PATH'] = str(snapshot)
os.environ['DATABASE_URL'] = ''

# This process never needs outbound sockets. Enforce isolation even if an
# existing integration handler attempts a remote request during review.
def deny_outbound(event, arguments):
    if event == 'socket.connect':
        address = arguments[1]
        if isinstance(address, tuple) and address[0] in ('127.0.0.1', '::1'):
            return  # Windows asyncio creates a loopback socket pair.
        raise PermissionError('External connections are disabled in local UI staging')
    if event == 'socket.getaddrinfo' and arguments[0] not in ('127.0.0.1', '::1', 'localhost'):
        raise PermissionError('External connections are disabled in local UI staging')
sys.addaudithook(deny_outbound)

from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.encoders import jsonable_encoder
from backend.app import app
from backend.auth import get_current_user, require_auth, require_admin
from backend.database import Repository
import uvicorn

users = Repository.list_users()
operator = next((u for u in users if u.get('role') == 'admin'), users[0] if users else None)
if not operator:
    raise RuntimeError('A local account is required in the database snapshot')
local_user = {'user_id': operator['id'], 'role': operator['role']}
for dependency in (get_current_user, require_auth, require_admin):
    app.dependency_overrides[dependency] = lambda: local_user

def mail_overview():
    aliases = Repository._execute('SELECT DISTINCT alias_email, alias_name FROM zoho_emails_cache WHERE alias_email IS NOT NULL', fetchall=True) or []
    return {'status': 'local_snapshot', 'aliases': [
        {'email': a['alias_email'], 'displayName': a['alias_name'] or a['alias_email']}
        for a in aliases if a['alias_email']
    ], 'labels': Repository.get_mail_labels()}

@app.middleware('http')
async def local_staging(request, call_next):
    path = request.url.path
    if path == '/':
        html = (ROOT / 'static/index.html').read_text(encoding='utf-8')
        boot = '''<script>localStorage.setItem('zero7_token','local-ui-preview');</script>
        <style>.ui-preview-notice{height:32px;display:flex;align-items:center;justify-content:center;background:#e7f2ff;color:#16569a;font:12px Inter,system-ui,sans-serif;border-bottom:1px solid #c8def4}.app-shell,.sidebar-rail,.main-viewport{height:calc(100vh - 32px)!important}</style>'''
        html = html.replace('</head>', boot + '</head>').replace('<body>', '<body><div class="ui-preview-notice" role="status">Local staging · Database copy · External actions disabled</div>')
        return HTMLResponse(html, headers={'Cache-Control': 'no-store'})
    if path == '/api/mail/overview':
        return JSONResponse(mail_overview())
    if path == '/api/mail/messages':
        q = request.query_params
        result = Repository.get_cached_emails_unified(folder=q.get('folder', 'inbox'), alias=q.get('alias', 'all'), label=q.get('label', ''), search=q.get('search', ''), page=max(1, int(q.get('page', 1))), limit=min(100, max(1, int(q.get('limit', 12)))))
        return JSONResponse(jsonable_encoder({**mail_overview(), 'messages': result['messages'], 'aliasCounts': result['aliasCounts'], 'folderCounts': result['counts'], 'pagination': {k: result[k] for k in ('page', 'limit', 'total', 'start', 'end', 'totalPages')}}))
    if path.startswith('/api/mail/messages/') and request.method == 'GET':
        message_id = path.rsplit('/', 1)[-1]
        message = Repository.get_cached_email_by_id(message_id)
        if not message:
            return JSONResponse({'detail': 'Message is not in this database snapshot'}, status_code=404)
        thread = Repository.get_cached_thread_messages(message.get('threadKey') or message.get('thread_key') or message_id) or [message]
        return JSONResponse(jsonable_encoder({'message': message, 'thread': thread, 'labels': Repository.get_mail_labels()}))
    if path == '/api/whatsapp/central/conversations':
        return JSONResponse({'conversations': Repository.get_central_whatsapp_conversations(), 'account': {'online': False, 'status': 'local_snapshot', 'phone': '9479007951'}})
    if path == '/api/integrations/status':
        return JSONResponse({'zoho_mail': {'connected': False}, 'whatsapp': {'connected': False}, 'google_sheets': {'connected': False}})
    if path == '/api/integrations/google-tasks/status':
        return JSONResponse({'connected': False})
    if path == '/api/admin/whatsapp/status':
        return JSONResponse({'accounts': {}})
    if path.startswith('/api/') and request.method not in ('GET', 'HEAD'):
        # Permit only ordinary CRUD against this disposable local database.
        import re
        local_crud = re.fullmatch(r'/api/(leads|deals|users)(/[^/]+)?(/notes|/deliverables|/milestones)?', path)
        mail_action = path == '/api/mail/messages/action'
        if not local_crud and not mail_action:
            return JSONResponse({'detail': 'This external action is disabled in local staging. Production has not been changed.'}, status_code=409)
    response = await call_next(request)
    response.headers['X-Zero7-Environment'] = 'local-database-snapshot'
    return response

print('Local UI staging: http://127.0.0.1:' + str(args.port), flush=True)
print('Database snapshot: ' + str(snapshot), flush=True)
uvicorn.run(app, host='127.0.0.1', port=args.port, lifespan='off', log_level='warning')
