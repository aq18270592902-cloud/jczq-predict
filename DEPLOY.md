# 部署到自己的服务器

两种方式，任选一种。都部署完后，服务器上跑的是一份**能自己刷数据**的完整站（不是静态快照）。

| 方式 | 适合 | 需要什么 | 之后怎么更新 |
|---|---|---|---|
| **A · 手动一条命令** | 第一次部署、想马上看到效果 | 能 ssh 上去 | 改完代码再跑一次 `bash deploy/install.sh` |
| **B · GitHub Actions 自动** | 以后不想管 | 仓库 Secrets 三个 | push 到 main 自动部署 |

**端口分配**（默认值，可用环境变量覆盖）：

| 站点 | 对外端口 | 变量 | 本机监听 | 说明 |
|---|---|---|---|---|
| 已有站点（视频专区） | 80 | — | — | 已经占着，不要动 |
| 已有站点（Next.js） | 8080 | — | — | 已经占着，不要动 |
| naraka-skill-spinner（纯静态） | **8081** | `PORT=8081` | nginx 直接读盘 | |
| jczq-predict（Node 服务） | **8082** | `WEB_PORT=8082` | Node 在 `127.0.0.1:8765`，nginx 反代 | |

所以装完两个站，访问地址是：

- 转盘 → `http://<服务器IP>:8081/`
- 竞足 → `http://<服务器IP>:8082/`

`install.sh` 装之前做两层检测，任一命中就自动往后找空闲端口（最多试 20 个）并打印实际值：

1. 扫 `/etc/nginx/conf.d/*.conf`，看别的站点是否已经 `listen` 同一个端口（都写 `server_name _` 时 nginx 只用先加载的那个，本站会变成「打开端口看到的是别人」）；
2. 用 `ss -lntH` 看端口是否已被任何进程占着（Next.js / docker / pm2 / 别人的 node —— 这类冲突 `nginx -t` 查不出来，只会在 reload 时 `EADDRINUSE`）。

想指定端口就直接 `sudo WEB_PORT=9000 bash deploy/install.sh`。

---

## 前置：服务器环境

- Linux（Ubuntu 20.04+ / Debian 11+ / CentOS Stream 9+）
- **Node.js 18 或更高**
- 建议装 nginx（不装也能跑，但只能 ssh 隧道访问）

```bash
# 装 Node 20（Debian/Ubuntu）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# 装 nginx（可选但强烈建议）
sudo apt install -y nginx
```

验证：`node -v` 输出 v18 以上，`nginx -v` 有输出。

---

## 方式 A · 手动一条命令

```bash
# 1. 把代码传上去（在自己电脑上执行，不是服务器）
scp -r . root@<服务器IP>:/opt/jczq-predict

# 2. ssh 上去
ssh root@<服务器IP>

# 3. 跑安装脚本
cd /opt/jczq-predict
sudo bash deploy/install.sh
```

脚本干四件事：

1. 建系统用户 `jczq-predict`（不给登录 shell）
2. 把代码同步到 `/opt/jczq-predict`（**保留服务器上已有的 `users/` 和 `.env`**）
3. 写 `/etc/systemd/system/jczq-predict.service` 并启动，设了开机自启
4. 写 `/etc/nginx/conf.d/jczq-predict.conf`，对外监听 **8082**（被占用则自动顺延），反代到 `127.0.0.1:8765`，reload nginx

跑完打开 `http://<服务器IP>:8082/` 就是成品。想换端口就 `sudo WEB_PORT=<端口> bash deploy/install.sh`。

### 常用命令

```bash
systemctl status jczq-predict --no-pager   # 看状态
journalctl -u jczq-predict -f              # 看实时日志
systemctl restart jczq-predict             # 重启
curl -s http://127.0.0.1:8765/api/status   # 本机自测
curl -sI http://127.0.0.1:8082/            # 经 nginx 自测（端口以 install.sh 打印的为准）
```

---

## 方式 B · GitHub Actions 自动部署

### 1. 配三个 Secrets

仓库页 → Settings → Secrets and variables → Actions → New repository secret：

| 名称 | 值 |
|---|---|
| `SSH_HOST` | 服务器 IP，例如 `47.121.140.215` |
| `SSH_USER` | 登录用户，例如 `root` |
| `SSH_PASS` | 登录密码 |

### 2. 触发

push 到 `main` 自动跑；也可以 Actions 页 → deploy → Run workflow 手动触发。

### 3. 它会做什么

1. 语法自检（`node --check` 三个 js + `scripts/verify-data.js`）
2. `rsync` 同步代码到 `/opt/jczq-predict`（排除 `users/`、`.env`、`.git/`）
3. ssh 上去判断：没装过就跑 `deploy/install.sh`，装过就 `systemctl restart`
4. `curl http://127.0.0.1:8765/api/status` 自测，不通则 workflow 红

**没配 Secrets 时整个 deploy job 会自动跳过**，不会报红。

---

## 数据怎么保持最新

服务器上的 `server.js` 自己会刷：

- 启动 **8 秒后**拉一次官方数据
- 之后**每 2 小时**拉一次
- 数据源：澳客竞彩在售页 + 赛果大厅 + 体彩官方赔率接口
- 拉完直接写回 `/opt/jczq-predict/data.js`，前端下次刷新就是新数据

想立刻刷一次，三条路任选：

```bash
# 1) 在服务器上直接打本机端口
curl -s http://127.0.0.1:8765/api/update

# 2) 从外网、已登录浏览器里点页面上的「↻ 更新比赛数据」按钮（走 cookie 登录态）

# 3) 从外网用 Token（需要先配 ADMIN_TOKEN）
curl -s -H "X-Admin-Token: <你的token>" http://<服务器IP>:8082/api/update
```

`/api/update` 的放行条件是**三选一**：

| 来源 | 是否放行 | 说明 |
|---|---|---|
| 本机直连（127.0.0.1） | ✅ | 服务器上 curl 或 cron |
| 已登录用户 | ✅ | 页面按钮走这条 |
| 带正确 `X-Admin-Token` | ✅ | 脚本 / 外部调用 |
| 其他 | ❌ 403 | 返回「需要登录，或带正确的 X-Admin-Token」 |

配 Token：

```bash
echo "ADMIN_TOKEN=$(openssl rand -hex 16)" | sudo tee -a /opt/jczq-predict/.env
sudo systemctl restart jczq-predict
```

> **反代关键项 `TRUST_PROXY=1`**：挂了 nginx 之后，所有请求的 socket 地址都是 `127.0.0.1`，如果不还原 `X-Forwarded-For`，「本机免鉴权」就等于全网免鉴权。`install.sh` 已经写进 service 文件；手工改过 unit 的老部署，`deploy.yml` 会自动补一行 `Environment=TRUST_PROXY=1`。
>
> `HOST` 默认 `127.0.0.1`（只给 nginx 用）。改成 `0.0.0.0` 直接对外时，**没配 ADMIN_TOKEN 会拒绝启动**。

---

## 用户数据在哪

登录用户的私有数据存在 `/opt/jczq-predict/users/{手机号}.json`。

- 目录不在 git 里，rsync 也排除了，**重新部署不会覆盖**
- 静态服务对该目录和 `keys.json` 一律返回 404，只能通过 `/api/data` 带 cookie 访问
- 备份：`tar czf users-$(date +%F).tgz -C /opt/jczq-predict users`

---

## 排障

| 现象 | 原因 | 怎么办 |
|---|---|---|
| `bash: deploy/install.sh: /bin/bash^M: bad interpreter` | 脚本被存成 CRLF | `sed -i 's/\r$//' deploy/install.sh` |
| `systemctl status` 显示 `Active: failed` | 端口被占或没权限 | `journalctl -u jczq-predict -n 50` 看真实报错 |
| 打开是 502 Bad Gateway | 服务没起来 | `curl 127.0.0.1:8765/api/status`，不通就重启 |
| 打开是 403 Forbidden | SELinux | `setsebool -P httpd_can_network_connect 1` |
| 数据一直不更新 | 服务器访问不了 okooo.com | `curl -I https://www.okooo.com/jingcai/` 验证；不行就换网络或代理 |
| `deploy` workflow 一直 skipped | 没配 Secrets | 按上面方式 B 第 1 步配齐 |
| `EADDRINUSE` 静默退出 | 已有实例在跑 | 正常行为，先 `systemctl stop jczq-predict` 再启动 |
| 访问端口打开的是别的项目 | `conf.d` 里另一个站点也 `listen` 同端口且 `server_name _` | 重跑 `install.sh`（会自动换端口并打印实际值），或手改 `listen` |
| 点「更新比赛数据」返回 403 | 未登录且没配 ADMIN_TOKEN | 登录后再点，或在 `.env` 配 `ADMIN_TOKEN` |
| 外网能直接触发 `/api/update` | unit 里缺 `TRUST_PROXY=1` | `sed -i '/^Environment=HOST=127.0.0.1/a Environment=TRUST_PROXY=1' /etc/systemd/system/jczq-predict.service && systemctl daemon-reload && systemctl restart jczq-predict` |

---

## 卸载

```bash
sudo systemctl disable --now jczq-predict
sudo rm -f /etc/systemd/system/jczq-predict.service
sudo rm -f /etc/nginx/conf.d/jczq-predict.conf
sudo nginx -t && sudo systemctl reload nginx
sudo rm -rf /opt/jczq-predict          # 用户数据也一起没了，先备份
```
