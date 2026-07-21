#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-54322}"
DB_NAME="${DB_NAME:-postgres}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-}"
BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

if [[ -z "${DB_PASSWORD}" ]]; then
  echo "DB_PASSWORD 未设置，已终止。"
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
export PGPASSWORD="${DB_PASSWORD}"

CUSTOM_FILE="${BACKUP_DIR}/performance-db-${TIMESTAMP}.dump"
SCHEMA_FILE="${BACKUP_DIR}/performance-db-schema-${TIMESTAMP}.sql"

echo "开始备份 PostgreSQL 到 ${BACKUP_DIR}"
pg_dump \
  --host "${DB_HOST}" \
  --port "${DB_PORT}" \
  --username "${DB_USER}" \
  --dbname "${DB_NAME}" \
  --format=custom \
  --file "${CUSTOM_FILE}"

pg_dump \
  --host "${DB_HOST}" \
  --port "${DB_PORT}" \
  --username "${DB_USER}" \
  --dbname "${DB_NAME}" \
  --schema-only \
  --file "${SCHEMA_FILE}"

echo "数据库备份完成:"
echo "  数据备份: ${CUSTOM_FILE}"
echo "  结构备份: ${SCHEMA_FILE}"

