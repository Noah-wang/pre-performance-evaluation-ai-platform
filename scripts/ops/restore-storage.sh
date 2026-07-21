#!/usr/bin/env bash
set -euo pipefail

STORAGE_DIR="${STORAGE_DIR:-/srv/performance-supabase/storage}"
STORAGE_BACKUP_DIR="${STORAGE_BACKUP_DIR:-./backups/storage}"
ARCHIVE_FILE="${1:-}"

if [[ -z "${ARCHIVE_FILE}" ]]; then
  ARCHIVE_FILE="$(find "${STORAGE_BACKUP_DIR}" -type f -name 'storage-*.tar.gz' | sort | tail -n 1)"
fi

if [[ -z "${ARCHIVE_FILE}" || ! -f "${ARCHIVE_FILE}" ]]; then
  echo "未找到可恢复的 Storage 备份文件。请传入 .tar.gz 文件路径。"
  exit 1
fi

mkdir -p "${STORAGE_DIR}"
tar -C "${STORAGE_DIR}" -xzf "${ARCHIVE_FILE}"

echo "Storage 恢复完成: ${ARCHIVE_FILE} -> ${STORAGE_DIR}"

