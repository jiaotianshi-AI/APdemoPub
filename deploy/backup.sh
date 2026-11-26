#!/usr/bin/env bash
# 备份账号数据库到 /var/backups/apdemo（保留最近 14 份）。由 systemd 定时器每天运行一次。
# 备份文件里有账号信息（含加密后的密码），权限为只有 root 可读，请勿上传到公开的地方。
set -euo pipefail
DB="${APDEMO_DB:-/var/lib/apdemo/apdemo.db}"
DEST="/var/backups/apdemo"
mkdir -p "$DEST"
chmod 700 "$DEST"
OUT="$DEST/apdemo-$(date +%Y%m%d-%H%M%S).db"
DB="$DB" OUT="$OUT" node --disable-warning=ExperimentalWarning -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.env.DB);
db.exec("VACUUM INTO \x27" + process.env.OUT.replace(/\x27/g, "") + "\x27");
db.close();'
chmod 600 "$OUT"
ls -1t "$DEST"/apdemo-*.db | tail -n +15 | xargs -r rm -f
echo "备份完成：$OUT"
