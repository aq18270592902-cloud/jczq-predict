#!/usr/bin/env bash
# ============================================================
# jczq-predict 一键部署到 Linux 服务器
# 用法：sudo bash deploy/install.sh
# 前置：Node 18+ 已安装（node -v 能跑）
# 做四件事：建用户 -> 放代码 -> 装 systemd 服务 -> 配 nginx 反代
# ============================================================
set -euo pipefail

APP_NAME="jczq-predict"
APP_DIR="/opt/${APP_NAME}"
APP_USER="${APP_NAME}"
PORT="${PORT:-8775}"          # Node 进程监听的本机端口（8765 常被老版 pm2 占着，所以默认 8775）
WEB_PORT="${WEB_PORT:-8766}"  # nginx 对外端口；本机 8766 是既有的对外入口，优先复用
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[!]\033[0m %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null || die "没装 node，先跑：curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs"
command -v systemctl >/dev/null || die "没有 systemd，本脚本不适用"

say "1/4 建系统用户 $APP_USER"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"

say "2/4 同步代码到 $APP_DIR"
mkdir -p "$APP_DIR"
# 保留服务器上的 users/ 与 .env，其余覆盖
if command -v rsync >/dev/null; then
  rsync -a --delete \
    --exclude 'users/' --exclude '.env' --exclude '.git/' --exclude 'node_modules/' \
    "$SRC_DIR/" "$APP_DIR/"
else
  cp -a "$SRC_DIR/." "$APP_DIR/"
fi
mkdir -p "$APP_DIR/users"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

say "3/4 装 systemd 服务"
cat > /etc/systemd/system/${APP_NAME}.service <<EOF
[Unit]
Description=jczq-predict (竞足预测汇总)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=HOST=127.0.0.1
# 前面有 nginx 反代，所有连接都来自 127.0.0.1；开这个开关让服务按 X-Forwarded-For 还原真实来源，
# 否则「本机回环免鉴权」会让 /api/update 变成任何访问者都能触发。
Environment=TRUST_PROXY=1
EnvironmentFile=-${APP_DIR}/.env
ExecStart=$(command -v node) ${APP_DIR}/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${APP_DIR}

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now "${APP_NAME}"

say "4/4 配 nginx 反代（没装 nginx 就跳过）"
if command -v nginx >/dev/null; then
  # 0) 已有 nginx 站点已经反代到 127.0.0.1:${PORT}（典型场景：老版本原地升级）→ 直接复用那个对外端口，
  #    不再新建 conf，否则会多开一个外网不通的端口（安全组只放行特定端口）。
  REUSE_PORT=""
  REUSE_FILE=""
  for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
    [ -e "$f" ] || continue
    case "$f" in */${APP_NAME}.conf) continue;; esac
    if grep -qE "proxy_pass[[:space:]]+http://127\.0\.0\.1:${PORT}([^0-9]|$)" "$f"; then
      REUSE_PORT=$(grep -oE "^[[:space:]]*listen[[:space:]]+[0-9]+" "$f" | head -1 | grep -oE "[0-9]+$")
      REUSE_FILE="$f"
      break
    fi
  done
  if [ -n "$REUSE_PORT" ]; then
    say "检测到 ${REUSE_FILE} 已反代到 127.0.0.1:${PORT}，复用其对外端口 ${REUSE_PORT}，不新建 conf"
    nginx -t && systemctl reload nginx
    say "完成。浏览器打开 http://<服务器IP>:${REUSE_PORT}/"
    exit 0
  fi
  # 端口冲突检测，两层：
  #   1) /etc/nginx/conf.d 里别的站点已 listen 同端口且 server_name 都是 _ → nginx 只用先加载的，本站会「访问这个端口打开的是别的项目」
  #   2) 端口被任何非 nginx 进程占着（Next.js / docker / pm2 / 别人的 node）→ nginx -t 过，reload 直接 EADDRINUSE
  # 两层任一命中就往后找，最多 20 个端口。
  port_taken() {
    local p="$1" f
    for f in /etc/nginx/conf.d/*.conf; do
      [ -e "$f" ] || continue
      [ "$f" = "/etc/nginx/conf.d/${APP_NAME}.conf" ] && continue
      grep -qE "^[[:space:]]*listen[[:space:]]+${p}([[:space:]]|;)" "$f" && return 0
    done
    if command -v ss >/dev/null 2>&1; then
      ss -lntH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}\$" && return 0
    fi
    return 1
  }
  WANT_WEB="$WEB_PORT"
  i=0
  while port_taken "$WEB_PORT"; do
    i=$((i+1))
    [ "$i" -gt 20 ] && die "从 ${WANT_WEB} 起连试 20 个端口都被占用，用 WEB_PORT=<端口> 手动指定一个空闲的"
    printf '\033[1;33m[!]\033[0m 端口 %s 已被占用，试 %s\n' "$WEB_PORT" "$((WEB_PORT+1))"
    WEB_PORT=$((WEB_PORT+1))
  done
  [ "$WEB_PORT" != "$WANT_WEB" ] && printf '\033[1;32m==>\033[0m 实际使用端口：%s（原定 %s 被占）\n' "$WEB_PORT" "$WANT_WEB"
  cat > /etc/nginx/conf.d/${APP_NAME}.conf <<EOF
server {
    listen ${WEB_PORT};
    server_name _;
    client_max_body_size 8m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        # 这两个头是 /api/update 鉴权还原真实来源的依据，别删
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF
  nginx -t && systemctl reload nginx
else
  say "未检测到 nginx，服务只监听 127.0.0.1:${PORT}，用 ssh 隧道访问："
  echo "    ssh -L ${PORT}:127.0.0.1:${PORT} root@<服务器IP>"
fi

say "完成。浏览器打开 http://<服务器IP>:${WEB_PORT}/"
say "检查状态：systemctl status ${APP_NAME} --no-pager"
say "看日志：journalctl -u ${APP_NAME} -f"
say "本机自测：curl -s http://127.0.0.1:${PORT}/api/status"
