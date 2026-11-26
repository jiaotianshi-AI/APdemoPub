# 部署到腾讯云轻量服务器（东京）

网址：**https://apdemo.locprof.com/**

结构：Caddy（对外，自动 HTTPS）→ Node.js 应用（只监听本机 127.0.0.1:3000）→ SQLite 数据库文件。
- 应用文件：`/opt/apdemo`（只读，由 `update.sh` 从仓库同步）
- 数据库：`/var/lib/apdemo/apdemo.db`；上传的 PDF：`/var/lib/apdemo/uploads/`（只有 `apdemo` 用户可读写，不能通过网址直接访问，每次打开都要先检查登录和权限）
- 每日备份：`/var/backups/apdemo/`（数据库和上传文件各保留最近 14 份，仅 root 可读；注意磁盘空间）
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

## 第一次部署新版本（增加了测试管理和 PDF 上传）后请检查
1. 更新后运行：`cd ~/APdemoPub && git pull && sudo bash deploy/update.sh`（会同步新的服务配置并重启）。
2. **检查服务器的时区数据**，确认偏移是你期望的（账号右上角的“-7”和测试的精确时刻都用服务器的时区数据；这里以温哥华为例，其他时区同理）：
   ```bash
   node -e 'const f=(d)=>new Intl.DateTimeFormat("en-US",{timeZone:"America/Vancouver",timeStyle:"long"}).format(new Date(d));console.log(f("2026-11-28T23:00:00Z"))'
   ```
   这一时刻是 UTC 23:00。你确认温哥华当前是 UTC-7，所以应当显示 `4:00:00 PM PDT`（如果显示 `3:00:00 PM PST`，说明服务器的时区数据与你的预期不一致，请告诉我）。
3. 单个 PDF 上限 20MB，每条测试的题目、答题文件各最多 10 个；超过会被拒绝。

## 升级到“测试流程”版本（数据库会自动升级）
- 第一次用新版本启动时，数据库会**自动升级**：测试记录增加“测试时长”（旧记录默认 60 分钟）和新的状态，并新增答卷、答案、离开页面记录三张表；原有账号、测试、文件和关联都保留。
- 升级前建议先手动备份一次：`sudo bash /opt/apdemo/deploy/backup.sh`。
- 升级命令不变：`cd ~/APdemoPub && git pull && sudo bash deploy/update.sh`。

## 启用 AI 判分（可选）
1. 确认服务器能出站访问 `api.anthropic.com`（443）：`curl -sI https://api.anthropic.com | head -1`（出现 `HTTP/2 404` 之类也说明网络是通的）。腾讯云轻量服务器默认放行出站。
2. 用管理员登录，打开 `https://apdemo.locprof.com/admin/ai`，填写模型和 API 密钥，点“测试连通性”，确认成功后点“保存设置”。
3. 密钥加密保存，加密主密钥文件是 `/var/lib/apdemo/master.key`（自动生成，权限 600）。**每日备份不包含它**；如果你把数据库恢复到另一台服务器，需要在 `/admin/ai` 重新填写密钥。不要把 `master.key` 复制到公开的地方。
4. 会产生 AI 服务商的费用（按 token 计费，PDF 也会消耗 token）。每个督导者每小时最多 60 次请求，可用环境变量 `AI_MAX_PER_HOUR` 调整（写在 `deploy/apdemo.service` 的 `Environment=` 里，然后 `sudo systemctl daemon-reload && sudo systemctl restart apdemo`）。

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


## 运行时依赖（unpdf）

AI 评分用到 DeepSeek 等只能读文字的模型时，服务器需要 `unpdf` 把 PDF 里的文字提取出来。`deploy/update.sh` 会自动把 `package.json`/`package-lock.json` 同步到 `/opt/apdemo` 并执行 `npm ci --omit=dev`，所以更新时照常运行：

```bash
cd ~/APdemoPub && git pull && sudo bash deploy/update.sh
```

服务器需要能访问 npm 仓库（registry.npmjs.org）；如果装不上，只有“文字模式”的模型会提示缺少组件，Claude / GPT 直接读 PDF 不受影响。
