# 部署到腾讯云轻量服务器（东京）

目标地址：**https://apdemo.locprof.com/**（子域名，网站放在根目录；页面全部使用相对路径，放根目录或子路径都能用）。

## 步骤
1. **购买服务器**：东京，2 核 2GB（只跑网站 1 核 1GB 也够），镜像选 Ubuntu 24.04 LTS 或 22.04 LTS。
2. **腾讯云控制台 → 防火墙**：放行 TCP 80、TCP 443、UDP 443；SSH(22) 建议只允许你自己的 IP。
3. **DNS**：给 `apdemo.locprof.com` 添加 A 记录，指向服务器公网 IP。等解析生效后再进行第 5 步，否则 Caddy 申请证书会失败（会自动重试）。
4. **登录服务器**，把 `deploy/` 目录里的 `setup-server.sh` 和 `Caddyfile` 放在同一目录，运行：
   ```bash
   sudo bash setup-server.sh
   # 如默认用户不是 ubuntu：sudo DEPLOY_USER=你的用户名 bash setup-server.sh
   # 只允许你自己的 IP 连 SSH：sudo SSH_ALLOW_IP=你的IP bash setup-server.sh
   ```
5. **在你自己的电脑上**（仓库根目录）上传网站：
   ```bash
   bash deploy/deploy.sh ubuntu@服务器IP
   ```
6. 浏览器打开 https://apdemo.locprof.com/ 检查。

## 之后更新内容
- 改了页面或 `data/*.json`：重新运行第 5 步即可。`data/` 已设为不缓存，刷新即生效。

## 说明
- `Caddyfile` 不含 CSP 头；页面自己用 `<meta>` 设置了 CSP。
- 服务器上会 404 的路径：隐藏文件、`tests/`、`node_modules/`、`package.json`、报告文件等（以防误传后被访问）。
- 本目录的脚本我没有在真实服务器上运行过，也没有在本容器里验证 Caddy 配置（容器未安装 Caddy）。`setup-server.sh` 里有 `caddy validate`，配置有误时会在这一步报错并停止。
- 脚本和配置里没有任何密码、密钥或账号信息。
