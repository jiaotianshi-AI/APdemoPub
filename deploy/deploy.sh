#!/usr/bin/env bash
# 在你自己的电脑上、仓库根目录运行：把网站文件上传到服务器。
#   bash deploy/deploy.sh ubuntu@服务器IP
# 使用你本机已有的 SSH 登录方式（密钥或密码由 ssh 自己处理，本脚本不接触凭据）。
set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then echo "用法：bash deploy/deploy.sh 用户@服务器IP"; exit 1; fi

cd "$(dirname "$0")/.."
rsync -av --delete \
  --exclude '.git/' --exclude '.gitignore' --exclude 'node_modules/' \
  --exclude 'tests/' --exclude 'deploy/' --exclude 'package.json' --exclude 'package-lock.json' \
  --exclude 'playwright.config.js' --exclude 'test-results/' --exclude 'playwright-report/' \
  --exclude 'APdemo_TASK.md' --exclude 'REPORT.md' --exclude 'CLAUDE.md' \
  ./ "$TARGET":/var/www/apdemo/

echo "上传完成。访问：https://apdemo.locprof.com/"
