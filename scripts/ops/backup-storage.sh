#!/usr/bin/env bash
set -euo pipefail

STORAGE_DIR="${STORAGE_DIR:-/srv/performance-supabase/storage}"
STORAGE_BACKUP_DIR="${STORAGE_BACKUP_DIR:-./backups/storage}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

if [[ ! -d "${STORAGE_DIR}" ]]; then
  echo "STORAGE_DIR 不存在: ${STORAGE_DIR}"
  exit 1
fi

mkdir -p "${STORAGE_BACKUP_DIR}"
ARCHIVE_FILE="${STORAGE_BACKUP_DIR}/storage-${TIMESTAMP}.tar.gz"

tar -C "${STORAGE_DIR}" -czf "${ARCHIVE_FILE}" .

echo "Storage 备份完成: ${ARCHIVE_FILE}"

