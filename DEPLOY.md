# 部署到自己的服务器

两种方式，任选一种。都部署完后，服务器上跑的是一份**能自己刷数据**的完整站（不是静态快照）。

| 方式 | 适合 | 需要什么 | 之后怎么更新 |
|---|---|---|---|
| **A · 手动一条命令** | 第一次部署、想马上看到效果 | 能 ssh 上去 | 改完代码再跑一次 `bash deploy/install.sh` |
| **B · GitHub Actions 自动** | 以后不想管 | 仓库 Secrets 三个 | push 到 main 自动部署 |

**端口分配**（当前线上实际值）：

| 站点 | 对外端口 | 变量 | 本机监听 | 说明 |
|---|---|---|---|---|
| 视频专区（老站） | 80 | — | — | 已占用，不要动 |
| Next.js 站（老站） | 8080 | — | — | 已占用，不要动 |
| 老版竞足 ccss（pm2，已停） | 8765 | — | — | 2026-11-13 已 `pm2 stop ccss && pm2 save`，端口释放；源码留在 `/var/www/ccss` 可随时 `pm2 start ccss` 回滚 |
| **jczq-predict（当前线上）** | **8766** | `WEB_PORT=8766` | Node 在 `127.0.0.1:8775`，nginx 反代 | 访问地址 `http://<服务器IP>:8766/` |

阿里云安全组只放行 **22 / 80 / 8080 / 8766 / 8805** —— 换端口前先去控制台加规则，否则外网打不开。

本机 8775 是给新版留的固定值。老 pm2 进程 `ccss` 原先占 8765，已于 2026-11-13 停掉（省 22MB 常驻内存 + 释放端口）；源码与 `users/` 仍在 `/var/www/ccss`，`pm2 start ccss` 即可回滚到老版。

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
4. 写 `/etc/nginx/conf.d/jczq-predict.conf`，对外监听 **8766**（被占用则自动顺延），反代到 `127.0.0.1:8775`，reload nginx；**如果已经存在反代到 8775 的 nginx 配置（例如现网的 `sites-available/ccss`），脚本会直接复用它并退出，不新建文件**

### nginx 层做了什么（新建与复用两种路径都覆盖）

| 项 | 值 | 为什么 |
|---|---|---|
| `gzip` | `on` / `comp_level 6` / `min_length 1024` | 首页 14KB→4.8KB、`data.js` 254KB→41KB。**别关**，移动网络上是 5 倍差距 |
| `gzip_types` | 含 `application/json`、`image/svg+xml` | 默认只压 `text/html`，JSON 不压等于白传 |
| `X-Content-Type-Options` | `nosniff` | 防止浏览器把上传的文件当脚本执行 |
| `X-Frame-Options` | `SAMEORIGIN` | 防点击劫持（页面套 iframe 骗点击） |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 跨站时不泄露完整 URL |
| `Permissions-Policy` | 关掉 geolocation / microphone / camera / payment | 本站一个都不用 |
| `Cross-Origin-Opener-Policy` | `same-origin` | 隔离 opener，防跨窗口引用 |

**复用已有 conf 的路径**（现网就是这种：老配置在 `sites-available/ccss`）不会整份覆盖，只调 `harden_conf()` 做**幂等注入**：先 `cp` 备份成 `*.bak.<时间戳>`，再用 `awk` 在第一个 `server {` 之后插入 gzip 与安全头；文件里已经有 `X-Content-Type-Options` 就整段跳过，重复跑不会有副作用。

> GitHub Pages 版没有自定义响应头能力，安全头只能靠 `<meta http-equiv>` 兜底；服务器版这里给的是真 HTTP 头，比 meta 更可靠（meta 的 CSP / referrer 对非 HTML 资源无效）。

跑完打开 `http://<服务器IP>:8766/` 就是成品。想换端口就 `sudo WEB_PORT=<端口> bash deploy/install.sh`。

### 常用命令

```bash
systemctl status jczq-predict --no-pager   # 看状态
journalctl -u jczq-predict -f              # 看实时日志
systemctl restart jczq-predict             # 重启
curl -s http://127.0.0.1:8775/api/status   # 本机自测（Node 直连）
curl -sI http://127.0.0.1:8766/            # 经 nginx 自测（端口以 install.sh 打印的为准）
curl -s  http://127.0.0.1:8766/api/status  # 经 nginx 看刷新状态
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
4. 从 systemd unit 里读 `Environment=PORT=` 得到本机端口（默认 8775），再遍历 nginx 配置找反代到该端口的 `listen` 端口（默认 8766），两个都 curl 一遍，不通则 workflow 红

**没配 Secrets 时整个 deploy job 会自动跳过**，不会报红。

---

## 数据怎么保持最新（三层，互不依赖）

### 第一层 · 浏览器实时赔率（不依赖服务器抓取）

前端 `boot.js` 每次打开页面直接向体彩官方接口拉当前在售场次与全玩法赔率，之后每 6 分钟静默刷一次。
这条路走的是**访客自己的浏览器**，跟服务器能不能访问外网、cron 跑没跑都没关系。

### 第二层 · 服务端落盘（赛程 / 赛果 / 历史）

服务器上的 `server.js` 自己会刷：

- 启动 **8 秒后**拉一次官方数据
- 之后**每 2 小时**拉一次（`const INTERVAL = 2 * 60 * 60 * 1000`）
- 数据源：澳客竞彩在售页 + 赛果大厅 + 体彩官方赔率接口
- 拉完直接写回 `/opt/jczq-predict/data.js`，前端下次刷新就是新数据

### 第三层 · GitHub Actions 落盘

`refresh-data.yml` cron `*/30`（免费档实际可能 4~5 小时一次），写的是仓库里的 `data.js`，
再由 Pages / deploy 同步到线上。它覆盖的是「服务器没部署时也能有赛果」这个场景。

### 三层来源对照

| 层 | 谁在拉 | 频率 | 覆盖什么 | 服务器挂了会怎样 |
|---|---|---|---|---|
| 实时层 | 访客浏览器（`boot.js`） | 打开页面 + 每 6 分钟 | 当天在售场次的全部赔率 | 照常工作 |
| 服务端 | `server.js`（systemd） | 启动 8 秒后 + 每 2 小时 | 赛程 / 赛果 / 历史赔率，写 `data.js` | 停摆，只剩实时层 |
| Actions | `refresh-data.yml` | cron `*/30`（免费档可能 4~5 小时） | 同服务端，写进仓库 `data.js` | 照常工作 |

三者写的是同一份 `data.js` 结构，前端合并时按「赛果 > 服务端/Actions 底座 > 实时赔率」的优先级处理：
**已完场的场次，赔率与赛果都不许被实时层覆盖**（见 `boot.js` 的 `mergeLive()`）。

> 服务器长期不通外网（或 okooo.com 被墙）时，第一层照样能用 —— 这是部署到服务器后「数据还是最新的」的兜底。

### ⚠️ 不要在同一台服务器上再挂 cron 刷 data.js

`server.js` 已经每 2 小时写一次 `data.js`。再挂一个 `crontab` 跑 `fetch_official.js` 就是**两个写者抢同一个文件**：

- 可能读到对方写了一半的内容（`fs.writeFileSync` 不是原子替换）
- 两边各自 `readFileSync` 旧内容再整体写回，后写的会把先写的更新**覆盖掉**

要手动刷，用 `/api/update`（有并发锁 `state.updating`，不会双跑），不要用 cron。

真需要脱离 `server.js` 单独定时刷（例如服务停了也要刷），用仓库里的兜底脚本，它自带备份 + 校验 + 失败回滚：

```bash
bash /opt/jczq-predict/scripts/refresh.sh          # 手动刷一次
tail -n 40 /var/log/jczq-refresh.log               # 看日志
```

**用了它就必须同时停掉 `server.js` 的定时器**（把 `INTERVAL` 注释掉并重启服务），二选一，不能同时开。

想立刻刷一次，三条路任选：

```bash
# 1) 在服务器上直接打本机端口（最快，有并发锁）
curl -s http://127.0.0.1:8775/api/update

# 2) 从外网、已登录浏览器里点页面上的「↻ 更新比赛数据」按钮（走 cookie 登录态）

# 3) 从外网用 Token（需要先配 ADMIN_TOKEN）
curl -s -H "X-Admin-Token: <你的token>" http://<服务器IP>:8766/api/update
```

刷新状态随时可查：

```bash
curl -s http://127.0.0.1:8775/api/status
# {"updating":false,"lastAt":1794550899550,"lastOk":true,"ageMin":55}
#  ageMin 就是「距上次刷新多少分钟」，超过 130 说明定时器没在跑
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

> **当前这台服务器已经配好了**（2026-11-13）：`/opt/jczq-predict/.env` 存在，权限 `600`，属主 `jczq-predict`，里面是 `ADMIN_TOKEN=<32 字节 hex>`。
> Token 值不入库，存在本地 `_tools/_jczq_admin.txt` 与服务器该文件里。验证：

```bash
# 服务器上：应返回 200
curl -s -o /dev/null -w '%{http_code}\n' -H "X-Admin-Token: $(grep ^ADMIN_TOKEN /opt/jczq-predict/.env | cut -d= -f2)" http://127.0.0.1:8775/api/update

# 本机：不带 Token 必须 403，带对的必须 200
curl -s -o /dev/null -w '%{http_code}\n' http://47.121.140.215:8766/api/update
curl -s -o /dev/null -w '%{http_code}\n' -H "X-Admin-Token: <token>" http://47.121.140.215:8766/api/update
```

> `deploy.yml` 的 rsync 带 `--exclude .env`，重新部署不会覆盖它；`.env` 也从不进 git。

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
| 打开是 502 Bad Gateway | 服务没起来 | `curl 127.0.0.1:8775/api/status`，不通就重启 |
| 打开是 403 Forbidden | SELinux | `setsebool -P httpd_can_network_connect 1` |
| 数据一直不更新 | 服务器访问不了 okooo.com | `curl -I https://www.okooo.com/jingcai/` 验证；不行就换网络或代理 |
| `deploy` workflow 一直 skipped | 没配 Secrets | 按上面方式 B 第 1 步配齐 |
| `EADDRINUSE` 静默退出 | 已有实例在跑 | 正常行为，先 `systemctl stop jczq-predict` 再启动 |
| 访问端口打开的是别的项目 | `conf.d` 里另一个站点也 `listen` 同端口且 `server_name _` | 重跑 `install.sh`（会自动换端口并打印实际值），或手改 `listen` |
| 响应头里 `Cache-Control` 出现两次（如 `no-cache, no-cache`） | nginx 的 `add_header` 与 `server.js` 各发了一次 | 删掉 nginx 里那条 `add_header`，缓存策略统一由 `server.js` 的 `cacheControlFor()` 决定 |
| `curl -I` 看不到 `content-encoding: gzip` | 没带 `Accept-Encoding`，或响应小于 `gzip_min_length` | `curl -sI -H 'Accept-Encoding: gzip' http://127.0.0.1:8766/`，小文件不压是正常的 |
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
