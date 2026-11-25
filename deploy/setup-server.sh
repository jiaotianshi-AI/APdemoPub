#!/usr/bin/env bash
# 在新购的 Ubuntu 22.04/24.04 服务器上以 root 运行一次：
#   sudo bash setup-server.sh
# 可选环境变量：
#   DEPLOY_USER   上传文件用的登录用户，默认 ubuntu（腾讯云 Lighthouse 的 Ubuntu 镜像默认用户）
#   SSH_ALLOW_IP  只允许该 IP 访问 SSH(22)；不设则对所有 IP 开放 22（仍建议在腾讯云防火墙里限制）
# 本脚本不含任何密码或密钥。
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
SITE_DIR="/var/www/apdemo"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then echo "请用 root 运行（sudo bash setup-server.sh）"; exit 1; fi
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then echo "用户 $DEPLOY_USER 不存在，请用 DEPLOY_USER=... 指定"; exit 1; fi

export DEBIAN_FRONTEND=noninteractive

echo "== 1/5 更新系统并安装基础工具 =="
apt-get update -y
apt-get install -y ufw rsync curl gnupg debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades

echo "== 2/5 安装 Caddy（官方 apt 源）=="
if ! command -v caddy >/dev/null 2>&1; then
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "== 3/5 创建网站目录 =="
mkdir -p "$SITE_DIR"
chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$SITE_DIR"
chmod 755 "$SITE_DIR"
if [ ! -f "$SITE_DIR/index.html" ]; then
  echo "<!doctype html><meta charset=utf-8><title>APdemo</title><p>Site not deployed yet.</p>" > "$SITE_DIR/index.html"
  chown "$DEPLOY_USER":"$DEPLOY_USER" "$SITE_DIR/index.html"
fi

echo "== 4/5 写入 Caddy 配置并重载 =="
install -m 644 "$HERE/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

echo "== 5/5 防火墙与自动安全更新 =="
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
echo "完成。下一步：在你的电脑上运行 deploy/deploy.sh 上传网站文件。"
echo "别忘了：腾讯云控制台的防火墙也要放行 TCP 80、443（和 UDP 443）。"
