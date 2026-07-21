#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-54322}"
DB_NAME="${DB_NAME:-postgres}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-}"
BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
BACKUP_FILE="${1:-}"

if [[ -z "${DB_PASSWORD}" ]]; then
  echo "DB_PASSWORD 未设置，已终止。"
  exit 1
fi

if [[ -z "${BACKUP_FILE}" ]]; then
  BACKUP_FILE="$(find "${BACKUP_DIR}" -type f -name 'performance-db-*.dump' | sort | tail -n 1)"
fi

if [[ -z "${BACKUP_FILE}" || ! -f "${BACKUP_FILE}" ]]; then
  echo "未找到可恢复的备份文件。请传入 .dump 文件路径。"
  exit 1
fi

export PGPASSWORD="${DB_PASSWORD}"

echo "即将恢复数据库: ${BACKUP_FILE}"
pg_restore \
  --host "${DB_HOST}" \
  --port "${DB_PORT}" \
  --username "${DB_USER}" \
  --dbname "${DB_NAME}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  "${BACKUP_FILE}"

echo "数据库恢复完成。"

