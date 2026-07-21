#!/usr/bin/env bash
set -euo pipefail

APP_URL="${APP_PUBLIC_URL:-http://127.0.0.1:8080}"
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"

echo "检查前端: ${APP_URL}"
curl -fsS "${APP_URL}" >/dev/null

echo "检查 Supabase API: ${SUPABASE_URL}/rest/v1/"
curl -fsS "${SUPABASE_URL}/rest/v1/" >/dev/null

echo "联调检查通过。"

