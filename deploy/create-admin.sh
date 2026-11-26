#!/usr/bin/env bash
# 在服务器上创建管理员账号，或重置管理员密码（只能在服务器命令行里做，网页上不能创建管理员）：
#   sudo bash /opt/apdemo/deploy/create-admin.sh 账号名          # 创建
#   sudo bash /opt/apdemo/deploy/create-admin.sh 账号名 reset    # 重置密码
# 会打印一次性初始密码；该管理员第一次登录时必须修改。
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "请用 root 运行（sudo）"; exit 1; fi
NAME="${1:-}"
[ -n "$NAME" ] || { echo "用法：sudo bash create-admin.sh 账号名 [reset]"; exit 2; }
CMD="create-admin"; [ "${2:-}" = "reset" ] && CMD="reset-admin-password"
cd /opt/apdemo
exec sudo -u apdemo env APDEMO_DB=/var/lib/apdemo/apdemo.db node --disable-warning=ExperimentalWarning server/cli.js "$CMD" "$NAME"
