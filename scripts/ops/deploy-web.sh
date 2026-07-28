#!/usr/bin/env bash
# 发布前端静态站点。
#
# 关键点：assets 目录只增不删。
#
# 前端按路由懒加载，chunk 文件名带内容哈希。如果发布时删掉旧 chunk，那些
# 已经打开着旧页面的用户一旦切换路由，就会去请求一个已经不存在的文件，
# 动态导入失败，浏览器整页重载——正在进行的报告生成也会一起丢掉。
#
# 保留旧 chunk 的代价只是一点磁盘，收益是发布过程对在线用户无感。
set -euo pipefail

HOST="${DEPLOY_HOST:-ubuntu@43.160.247.21}"
TARGET="${DEPLOY_PATH:-/var/www/performance-evaluation}"
BACKUP_DIR="${DEPLOY_BACKUP_DIR:-/home/ubuntu/deploy-backups}"
DIST="${DEPLOY_DIST:-dist}"

[ -d "$DIST" ] || { echo "找不到构建产物 $DIST，请先执行 npm run build" >&2; exit 1; }

echo "备份当前线上版本…"
ssh "$HOST" "sudo cp -a '$TARGET' '$BACKUP_DIR/www-\$(date +%Y%m%d-%H%M%S)'"

echo "上传新 chunk（保留旧文件）…"
rsync -a "$DIST/assets/" "$HOST:$TARGET/assets/"

echo "上传入口与静态资源…"
rsync -a --exclude assets/ "$DIST/" "$HOST:$TARGET/"

echo "清理超过 30 天的旧 chunk…"
ssh "$HOST" "sudo find '$TARGET/assets' -type f -mtime +30 -delete || true"

echo "完成。"
