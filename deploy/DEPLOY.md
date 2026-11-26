# 部署到腾讯云轻量服务器（东京）

网址：**https://apdemo.locprof.com/**

结构：Caddy（对外，自动 HTTPS）→ Node.js 应用（只监听本机 127.0.0.1:3000）→ SQLite 数据库文件。
- 应用文件：`/opt/apdemo`（只读，由 `update.sh` 从仓库同步）
- 数据库：`/var/lib/apdemo/apdemo.db`（只有 `apdemo` 用户可读写）
- 每日备份：`/var/backups/apdemo/`（保留最近 14 份，仅 root 可读）
- 服务：`systemctl status apdemo`、`systemctl status caddy`

## 第一次安装
1. 购买服务器：东京，2 核 2GB 起，Ubuntu 22.04 或 24.04。
2. 腾讯云控制台 → 防火墙：放行 TCP 80、TCP 443、UDP 443；SSH(22) 建议只允许你自己的 IP。
3. DNS：`apdemo.locprof.com` 的 A 记录指向服务器 IP。
4. 登录服务器，拉取代码并安装：
   ```bash
   git clone https://github.com/jiaotianshi-AI/APdemoPub.git
   cd APdemoPub/deploy
   sudo bash setup-server.sh
   ```
   （只允许你的 IP 连 SSH：`sudo SSH_ALLOW_IP=你的IP bash setup-server.sh`）
5. 创建第一个管理员账号（会打印一次性初始密码）：
   ```bash
   sudo bash /opt/apdemo/deploy/create-admin.sh 你的管理员账号名
   ```
6. 浏览器打开 https://apdemo.locprof.com/ ，用管理员账号登录，按提示修改初始密码，进入 `/admin`。

## 之后更新网站
```bash
cd ~/APdemoPub && git pull && sudo bash deploy/update.sh
```

## 常用操作
- 管理员忘记密码：`sudo bash /opt/apdemo/deploy/create-admin.sh 账号名 reset`
- 看日志：`sudo journalctl -u apdemo -n 50 --no-pager`
- 手动备份：`sudo bash /opt/apdemo/deploy/backup.sh`
- 恢复备份：停止服务 `sudo systemctl stop apdemo`，把备份文件复制为 `/var/lib/apdemo/apdemo.db`，`sudo chown apdemo:apdemo /var/lib/apdemo/apdemo.db`，再 `sudo systemctl start apdemo`。

## 从旧的“纯静态”部署升级
之前的部署是 Caddy 直接发送 `/var/www/apdemo` 里的静态文件。按上面第 4 步重新运行 `setup-server.sh` 即可：它会换成新的 Caddy 配置，并安装 Node.js 和应用服务。旧的 `/var/www/apdemo` 不再使用，可以删除。

## 安全说明
- 账号、密码、会话都在你的服务器上；密码只保存加密后的值（scrypt）。
- 所有页面和数据都需要登录；登录失败多次会临时锁定（同一账号名+IP 连续 5 次，锁 15 分钟）。
- 备份文件含账号信息，请勿上传到公开的地方。
- 本脚本和配置里没有任何密码、密钥或账号信息。
- 这些脚本我没有在真实服务器上完整运行过（本地验证了应用、命令行工具和备份脚本，没有验证 systemd、Caddy、Node 安装步骤）。如果某一步报错，把输出发给我。
