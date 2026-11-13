# 参与开发

## 这个仓库是什么

竞足预测汇总面板。**零 npm 依赖**，纯 Node 20 + 原生前端。数据来自两个源：官方赛程赛果（Actions 定时落盘）+ 体彩实时赔率（浏览器直连）。

## 本地怎么跑

```bash
node server.js
# 打开 http://127.0.0.1:8765/
```

Windows 下双击 `启动网页服务.vbs` 也行。只想抓数据不起服务：

```bash
node fetch_official.js 2026-11-13
```

## 提交前必须跑的校验

CI 跑四组，本地按顺序跑：

```bash
# 1. 语法
for f in boot.js app.js server.js fetch_official.js data.js sw.js; do node --check "$f"; done

# 2. 数据完整性
node scripts/verify-data.js

# 3. 部署脚本语法
bash -n deploy/install.sh

# 4. 起服务冒烟（另开一个终端）
node server.js &
curl -s http://127.0.0.1:8765/api/status
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8765/users/13800138000.json   # 必须 404
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8765/api/data                # 未登录必须 401
kill %1
```

## 架构：三层，别搞混

| 层 | 文件 | 干什么 |
|---|---|---|
| 引导层 | `boot.js` | 串行：加载 `data.js` → 直连体彩刷新实时赔率 → 加载 `app.js` → 注册 SW |
| 渲染层 | `app.js` | 只读 `window.APP_DATA` 渲染，不自己发请求 |
| 数据层 | `data.js` | 历史赛程赛果 + 赔率快照，由 Actions / 服务器定时刷新落盘 |

**`index.html` 只能引 `boot.js`。** 直接引 `app.js` 或 `data.js` 会绕过实时层，CI 会判红。

## 数据刷新：单写者原则

`data.js` 有**三个可能的写者**：GitHub Actions（`refresh-data.yml`）、服务器上的 `server.js` 定时器、手动跑 `fetch_official.js`。

**同一时间只能有一个在写。** `fetch_official.js` 用的是非原子写（`writeFileSync`），两个写者会互相覆盖——历史上真出过：`data.js` 从 83827B 缩到 61597B，单场赔率从 9 个字段退化成 3 个。

所以：

- 服务器上**不要装 cron 刷 `data.js`**（`server.js` 自带 2 小时定时器）
- 要手动刷，先停 `server.js` 的定时器，或直接停服务
- 加新的写者之前，先想清楚互斥怎么做

## 赔率合并的坑（改之前必读）

`mergeOdds(base, p)` 的逻辑是有原因的：

```js
if (base.result) return b || n || null;   // 已完场：保留终盘，绝不覆盖
if (!b) return n || null;
if (!n) return b;
return Object.assign({}, b, { h: n.h, d: n.d, a: n.a });  // 只覆盖胜平负三项
```

澳客列表页只给 `{h,d,a}` 三项，体彩接口给全套（`rq/tg/hf/sc/sxds`）。早期代码整体替换，结果把体彩的让球、总进球、半全场、比分全抹掉了。**只覆盖 h/d/a 三项，其余保留。**

## 改代码时的约定

| 位置 | 约定 |
|---|---|
| `index.html` | 引 `boot.js?v=YYYYMMDDx`。发版改这一处 + 根目录 `VERSION` 文件 |
| `sw.js` | 改策略必须升 `CACHE`（现在 `jczq-v5`）。`data.js` 走 network-first，不能 cache-first，否则老访客看不到新数据 |
| `server.js` | 静态托管路径必须过 `path.resolve` 前缀校验；`users/`、`keys.json`、`.env` 显式 404 |
| `/api/update` | 放行条件是「回环 IP 或已登录或带正确 `X-Admin-Token`」。挂 nginx 后必须 `TRUST_PROXY=1`，否则所有请求都看成回环 = 全网免鉴权 |
| `scripts/verify-data.js` | 新增数据字段要同步加断言，否则数据坏了 CI 不报 |
| `deploy/` | 改了 install.sh 要跑 `bash -n`，CI 会验 |

## 提交信息

```
fix(odds): 未开赛场次不再丢失让球与比分赔率
perf(data): 历史日回填，覆盖从 37 天扩到 47 天
feat(ui): 支持 ?date= 深链
ci: refresh-data 加 verify-data 前置校验
```

## 不要做的事

- 不要提交 `users/`、`.env`、`keys.json`
- 不要在 `index.html` 里直接引 `data.js` / `app.js`
- 不要在服务器上再挂一个 cron 刷数据
- 不要把 `data.js` 换成一次拉全量的设计——现在是分层加载，改了首屏会卡

## 部署

见 [DEPLOY.md](./DEPLOY.md)。两种方式（Actions 自动 / 手动 SSH），端口规划、Secrets 清单、排障表都在里面。

## 报问题

开 issue 用模板。安全问题走 [SECURITY.md](./SECURITY.md)，**不要开公开 issue**。
