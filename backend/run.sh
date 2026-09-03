#!/usr/bin/env bash
# Start the NeuroTrace backend on localhost:8000 for local testing and development.
set -e

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BACKEND_DIR"

# 1. Locate Python and tools in .venv or system
if [ -d ".venv/bin" ]; then
    PYTHON=".venv/bin/python"
    UVICORN=".venv/bin/uvicorn"
    ALEMBIC=".venv/bin/alembic"
elif [ -d ".venv/Scripts" ]; then
    PYTHON=".venv/Scripts/python.exe"
    UVICORN=".venv/Scripts/uvicorn.exe"
    ALEMBIC=".venv/Scripts/alembic.exe"
elif command -v python3 &>/dev/null; then
    PYTHON="python3"
    UVICORN="uvicorn"
    ALEMBIC="alembic"
else
    echo "❌ Error: Python not found. Please setup backend/.venv."
    exit 1
fi

# 2. Database selection & fallback
# If DATABASE_URL is not explicitly passed, check .env
if [ -z "$DATABASE_URL" ] && [ -f ".env" ]; then
    ENV_DB_URL=$(grep -E "^DATABASE_URL=" .env | cut -d '=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
fi

DB_URL="${DATABASE_URL:-${ENV_DB_URL:-sqlite+aiosqlite:///./neurotrace.db}}"

# If pointing to local postgres, test if port 5432 is open; if not, seamlessly fall back to SQLite
if [[ "$DB_URL" == *"postgresql"* ]] && [[ "$DB_URL" == *"localhost"* || "$DB_URL" == *"127.0.0.1"* ]]; then
    if ! nc -z 127.0.0.1 5432 2>/dev/null && ! nc -z localhost 5432 2>/dev/null; then
        echo "⚠️  Local PostgreSQL (port 5432) is not reachable."
        echo "💡 Seamlessly falling back to local SQLite database (neurotrace.db) for local testing."
        DB_URL="sqlite+aiosqlite:///./neurotrace.db"
    fi
fi

export DATABASE_URL="$DB_URL"
export ENV="${ENV:-development}"
export DEMO_MODE="${DEMO_MODE:-true}"

# 3. Apply migrations
echo "🔄 Checking database schema..."
$ALEMBIC upgrade head || echo "⚠️  Migration check completed with warnings."


# 4. Optional / Initial demo seed
if [[ "$*" == *"--seed"* ]] || [ ! -f "neurotrace.db" ]; then
    echo "🌱 Seeding demo dataset..."
    $PYTHON -c "
import asyncio
from app.db import SessionLocal
from app.services.seed import seed_demo
async def run():
    async with SessionLocal() as db:
        await seed_demo(db)
asyncio.run(run())
" 2>/dev/null || true
fi

echo ""
echo "🚀 NeuroTrace Backend starting..."
echo "──────────────────────────────────────────────"
echo "  🌐 API URL:      http://localhost:8000"
echo "  📚 Swagger Docs: http://localhost:8000/docs"
echo "  🩺 Health Check: http://localhost:8000/health"
echo "  💾 Database:     $DB_URL"
echo "──────────────────────────────────────────────"
echo "  🔑 Demo Accounts (Password: neurotrace-demo):"
echo "     • Clinician: clinician@neurotrace.app"
echo "     • Patient:   ramesh@neurotrace.app"
echo "     • Caregiver: demo@neurotrace.app"
echo "     • Admin:     admin@neurotrace.app"
echo "──────────────────────────────────────────────"
echo ""

exec $UVICORN app.main:app --reload --host 127.0.0.1 --port 8000
