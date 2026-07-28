#!/usr/bin/env bash
set -euo pipefail

AI_URL="${AI_CHAT_BASE_URL:-}"
ASR_URL="${LOCAL_ASR_BASE_URL:-}"
OCR_URL="${DOCUMENT_EXTRACTOR_BASE_URL:-${LOCAL_OCR_BASE_URL:-}}"

probe() {
  local name="$1"
  local url="$2"
  if [ -z "$url" ]; then
    echo "跳过 ${name}: 未配置"
    return 0
  fi

  local health="${url%/}/health"
  echo "检查 ${name}: ${health}"
  if curl -fsS --max-time 5 "${health}" >/dev/null 2>&1; then
    echo "${name} 健康检查通过"
    return 0
  fi

  echo "${name} 未提供 /health，尝试探测根地址"
  curl -fsS --max-time 5 "${url}" >/dev/null
  echo "${name} 地址可访问"
}

probe "AI_CHAT_BASE_URL" "${AI_URL}"
probe "LOCAL_ASR_BASE_URL" "${ASR_URL}"
probe "DOCUMENT_EXTRACTOR_BASE_URL/LOCAL_OCR_BASE_URL" "${OCR_URL}"

echo "AI / ASR / OCR 探测完成。"
