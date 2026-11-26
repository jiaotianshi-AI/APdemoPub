#!/usr/bin/env bash
# 把仓库里的应用文件同步到 /opt/apdemo 并重启服务。更新网站时：
#   cd ~/APdemoPub && git pull && sudo bash deploy/update.sh
# 加 --no-restart 则只同步文件不重启（setup-server.sh 内部使用）。
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "请用 root 运行（sudo bash deploy/update.sh）"; exit 1; fi
REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="/opt/apdemo"

mkdir -p "$APP_DIR"
# 只同步运行需要的文件；测试、文档、数据库目录等都不会进入 /opt/apdemo
for item in server pages assets data deploy; do
  rsync -a --delete "$REPO/$item/" "$APP_DIR/$item/"
done
install -m 644 "$REPO/index.html" "$APP_DIR/index.html"
chown -R root:root "$APP_DIR"
chmod -R go-w "$APP_DIR"

if [ "${1:-}" != "--no-restart" ]; then
  # 服务配置、备份定时器可能随版本更新，一并同步
  install -m 644 "$REPO/deploy/apdemo.service" /etc/systemd/system/apdemo.service
  install -m 644 "$REPO/deploy/apdemo-backup.service" /etc/systemd/system/apdemo-backup.service
  install -m 644 "$REPO/deploy/apdemo-backup.timer" /etc/systemd/system/apdemo-backup.timer
  chmod 755 "$APP_DIR/deploy/backup.sh"
  mkdir -p /var/lib/apdemo/uploads
  chown apdemo:apdemo /var/lib/apdemo/uploads
  chmod 700 /var/lib/apdemo/uploads
  systemctl daemon-reload
  systemctl restart apdemo.service
  systemctl --no-pager --lines=3 status apdemo.service | head -5 || true
  echo "已更新并重启。"
fi
