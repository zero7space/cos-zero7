#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "   Zero7 CRM (COS Theta) Production Container Starting    "
echo "=========================================================="

# Check if PostgreSQL DATABASE_URL is provided
if [ -n "$DATABASE_URL" ] && [[ "$DATABASE_URL" == *"postgres"* ]]; then
    echo "[DB] PostgreSQL database detected via DATABASE_URL."
    
    # Wait for PostgreSQL to be accessible
    echo "[DB] Checking database connectivity..."
    python -c "
import sys, time
from backend.db.connection import get_engine, init_engine
from backend.db.postgres_schema import get_all_create_table_statements

retries = 30
engine = None
while retries > 0:
    try:
        engine = init_engine()
        with engine.cursor() as cur:
            cur.execute('SELECT 1;')
        print('[DB] PostgreSQL connection successful!')
        break
    except Exception as e:
        retries -= 1
        print(f'[DB] Waiting for PostgreSQL ({e}). Retrying in 2s... ({retries} left)')
        time.sleep(2)

if not engine or retries == 0:
    print('[DB ERROR] Could not connect to PostgreSQL. Exiting.')
    sys.exit(1)

print('[DB] Ensuring all 31 PostgreSQL schema tables exist...')
with engine.cursor() as cur:
    for stmt in get_all_create_table_statements():
        cur.execute(stmt)
print('[DB] Schema verified.')
"

    # Optional automated SQLite-to-PostgreSQL migration on initial deployment
    if [ -f "zero7_crm.db" ] && [ "${AUTO_MIGRATE_SQLITE_TO_POSTGRES:-0}" = "1" ]; then
        echo "[DB] AUTO_MIGRATE_SQLITE_TO_POSTGRES is set. Performing database migration..."
        python -m backend.db.migrator --sqlite-path zero7_crm.db || echo "[DB WARNING] Migration returned non-zero. Check logs."
    fi
else
    echo "[DB] Running with local SQLite engine (zero7_crm.db)."
    python -c "
from backend.database import init_db
from backend.seed_data import seed_if_empty
init_db()
seed_if_empty()
print('[DB] Local SQLite database verified and ready.')
"
fi

echo "[STARTUP] Starting application server..."
exec "$@"
