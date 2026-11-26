#!/usr/bin/env bash
# 在 Ubuntu 22.04/24.04 服务器上以 root 运行（可重复运行）：
#   cd ~/APdemoPub/deploy && sudo bash setup-server.sh
# 可选环境变量：
#   SSH_ALLOW_IP  只允许该 IP 访问 SSH(22)；不设则对所有 IP 开放 22（仍建议在腾讯云防火墙里限制）
# 做的事：安装 Node.js 22 和 Caddy，创建运行用户与目录，部署应用，配置 systemd 服务、
# 每日数据库备份、防火墙、自动安全更新。本脚本不含任何密码或密钥。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
APP_DIR="/opt/apdemo"
DATA_DIR="/var/lib/apdemo"

if [ "$(id -u)" -ne 0 ]; then echo "请用 root 运行（sudo bash setup-server.sh）"; exit 1; fi
export DEBIAN_FRONTEND=noninteractive

echo "== 1/7 更新系统并安装基础工具 =="
apt-get update -y
apt-get install -y ufw rsync curl gnupg ca-certificates debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades

echo "== 2/7 安装 Node.js 22（官方 NodeSource 源）=="
node_ok() { command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'; }
if ! node_ok; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node_ok || { echo "Node.js 版本不满足（需要 22.13 或更高）：$(node -v 2>/dev/null || echo 未安装)"; exit 1; }
echo "Node.js $(node -v)"

echo "== 3/7 安装 Caddy（官方 apt 源）=="
if ! command -v caddy >/dev/null 2>&1; then
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "== 4/7 创建运行用户、目录，部署应用文件 =="
id apdemo >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin apdemo
mkdir -p "$APP_DIR" "$DATA_DIR" "$DATA_DIR/uploads"
chown apdemo:apdemo "$DATA_DIR"
chmod 700 "$DATA_DIR"
bash "$HERE/update.sh" --no-restart

echo "== 5/7 systemd 服务与每日备份 =="
install -m 644 "$HERE/apdemo.service" /etc/systemd/system/apdemo.service
install -m 644 "$HERE/apdemo-backup.service" /etc/systemd/system/apdemo-backup.service
install -m 644 "$HERE/apdemo-backup.timer" /etc/systemd/system/apdemo-backup.timer
chmod 755 "$APP_DIR/deploy/backup.sh"
systemctl daemon-reload
systemctl enable --now apdemo.service
systemctl restart apdemo.service
systemctl enable --now apdemo-backup.timer

echo "== 6/7 Caddy 配置 =="
install -m 644 "$HERE/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

echo "== 7/7 防火墙与自动安全更新 =="
ufw default deny incoming
ufw default allow outgoing
if [ -n "${SSH_ALLOW_IP:-}" ]; then
  ufw allow from "$SSH_ALLOW_IP" to any port 22 proto tcp
else
  ufw allow 22/tcp
fi
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo
echo "完成。下一步："
echo "  1) 创建第一个管理员账号：sudo bash $HERE/create-admin.sh 你的管理员账号名"
echo "  2) 浏览器打开 https://apdemo.locprof.com/ 登录（腾讯云防火墙需放行 TCP 80、443、UDP 443，DNS 需已指向本机）"
