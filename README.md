# 竞足预测汇总 · Jczq Predict

> 一个跑在自己电脑上的竞彩足球面板。自动抓官方赛程与赛果，把你信任的几个预测源录进去，横向对比分歧、算一致度、生成投注方案、沉淀历史命中率。

<p>
  <a href="https://aq18270592902-cloud.github.io/jczq-predict/"><img alt="在线演示" src="https://img.shields.io/badge/在线演示-GitHub%20Pages-2ea44f?style=flat-square&logo=githubpages&logoColor=white"></a>
  <a href="https://github.com/aq18270592902-cloud/jczq-predict/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/aq18270592902-cloud/jczq-predict/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A518-339933?style=flat-square&logo=node.js&logoColor=white">
  <img alt="依赖" src="https://img.shields.io/badge/%E4%BE%9D%E8%B5%96-0-4c8bf5?style=flat-square">
  <img alt="数据" src="https://img.shields.io/badge/%E6%95%B0%E6%8D%AE-%E4%BB%85%E5%AD%98%E6%9C%AC%E6%9C%BA-8957e5?style=flat-square">
  <img alt="PWA" src="https://img.shields.io/badge/PWA-%E5%8F%AF%E5%AE%89%E8%A3%85-5a0fc8?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square">
</p>

**在线演示**：https://aq18270592902-cloud.github.io/jczq-predict/

> 演示站是静态快照（浏览器里跑，数据只读），但**赔率是实时的**：页面打开时 `boot.js` 直接向体彩官方接口
> `webapi.sporttery.cn` 拉当前在售场次与全玩法赔率（胜平负 / 让球 / 总进球 / 半全场 / 比分 / 上下单双），
> 之后每 6 分钟静默刷新一次，不用等 GitHub Actions。赛果仍由 Actions 落盘。
> 账号同步、投注记录、导出这些要本地 `node server.js` 才有。
>
> 要挂到自己服务器上（systemd + nginx + Actions 自动部署），看 **[DEPLOY.md](DEPLOY.md)**。线上对外端口 **8766**，Node 进程在 `127.0.0.1:8775`（`Environment=PORT=8775`；`server.js` 不设 `PORT` 时默认 8765，本地开发用这个）。

## 快捷入口

| 想看什么 | 直接点 |
|---|---|
| 每日汇总（赛程 + 赔率 + 我的预测） | [在线看](https://aq18270592902-cloud.github.io/jczq-predict/?demo=1&tab=summary) |
| 模型对比（多源预测并排 + 分歧标色） | [在线看](https://aq18270592902-cloud.github.io/jczq-predict/?demo=1&tab=compare) |
| 投注方案（选场 → 过关 → 结算记录） | [在线看](https://aq18270592902-cloud.github.io/jczq-predict/?demo=1&tab=bets) |
| 历史统计（命中率 + 每日复盘） | [在线看](https://aq18270592902-cloud.github.io/jczq-predict/?demo=1&tab=stats) |
| 某一天的盘（示例：2026-11-13 周五 22 场） | [在线看](https://aq18270592902-cloud.github.io/jczq-predict/?demo=1&tab=summary&date=2026-11-13) |

## 界面

**每日汇总** —— 赛程、让球、赔率、赛果一屏看完，每个玩法后面跟「我的预测」，命中自动描绿。

![每日汇总](docs/screenshots/01-summary.png)

**模型对比** —— 你录入的每个预测源一列，分歧场次一眼能看出，右侧是最终决策。

![模型对比](docs/screenshots/02-compare.png)

**投注方案** —— 左边点玩法加进投注单，右边自动算过关方式与理论奖金，存下来的方案自动结算。

![投注方案](docs/screenshots/03-bets.png)

**历史统计** —— 记录天数 / 总场次 / 已开奖 / 命中率四张卡，下面是每个来源的准确率和每日复盘。

![历史统计](docs/screenshots/04-stats.png)

---

## 它解决什么问题

竞彩最麻烦的不是选哪场，是**几个预测源互相打架时你怎么信**。

这个面板把「官方数据 + 你的判断 + 多个模型的预测」放进同一张表：

| 层 | 内容 |
|---|---|
| 官方层 | 赛程、让球、赛果，自动拉取，可手动触发刷新 |
| 模型层 | 你自己录入的多家预测（胜平负 / 比分 / 半全场），来源自由命名 |
| 对比层 | 自动标出**分歧场次**、计算**一致度**、高亮**冷门预警** |
| 决策层 | 按一致度与赔率生成投注方案，记录实际下注与盈亏 |
| 复盘层 | 历史命中率、各模型准确率排行、赛后自动回填比分 |

所有数据存在本机 `users/<手机号>.json`，不上传、不同步。

## 快速开始

```bash
node server.js
# 打开 http://127.0.0.1:8765（本地默认端口；服务器上用 PORT=8775）
```

Windows 双击 `启动网页服务.vbs` 静默启动（无黑窗）。开机自启：把该 vbs 的快捷方式丢进 `shell:startup`。

想装成手机 App 直接看：打开演示站 → 浏览器菜单「添加到主屏幕」。演示站已带 PWA 清单和 Service Worker，装完断网也能开（数据是快照，不会自动更新）。

首次启动 8 秒后自动拉一次数据，之后每 2 小时一次（服务端抓取）。

浏览器端另有一条独立通路：`boot.js` 每次打开页面都会直连体彩官方接口拉实时赔率，页面开着时每 6 分钟刷一次，
跟服务端有没有跑无关。

## 目录结构

```
jczq-predict/
├─ server.js          # HTTP 服务：静态托管 + 账号 + 用户数据 API + 定时更新
├─ fetch_official.js  # 抓取脚本：澳客竞彩 + 500 网 + 体彩接口，写入 data.js
├─ scripts/verify-data.js  # data.js 结构校验（CI 与 refresh-data 都跑）
├─ index.html         # 单页前端（只引 boot.js）
├─ boot.js            # 引导层：data.js 底座 → 体彩官方实时接口合并 → app.js（失败静默回退）
├─ app.js             # 前端逻辑（4 个 tab + 表格渲染 + 导出 + 演示模式）
├─ style.css          # 样式
├─ data.js            # 赛事数据（fetch_official.js 自动生成/覆盖）
├─ docs/screenshots/  # README 用的界面截图
├─ icons/             # 180 / 192 / 512 三种尺寸的站点图标
├─ manifest.webmanifest  # PWA 清单：可「添加到主屏幕」
├─ sw.js              # Service Worker：页面 network-first，app/data/css 走 stale-while-revalidate
├─ robots.txt         # 允许抓取，屏蔽 /api/ 与用户数据
├─ sitemap.xml        # 站点地图
├─ 404.html           # 自定义 404 页（GitHub Pages 会自动接管）
├─ .nojekyll          # 跳过 Jekyll，保证以 . 开头的目录原样发布
├─ .gitattributes     # 统一换行符（ps1/bat 保持 CRLF，sh 保持 LF）
├─ .github/workflows/ # ci.yml / refresh-data.yml / deploy.yml
├─ deploy/install.sh  # 服务器一键安装（systemd + nginx）
├─ DEPLOY.md          # 部署文档
├─ users/             # 用户数据，含密码哈希，已 gitignore
├─ 启动网页服务.vbs
└─ 拉取官方数据.bat
```

> 早期的 `keys.json`（卡密文件）已删除，账号体系改成手机号 + 密码，密码用 `scrypt` 加盐存 `users/`。

## 复制视图链接

右上角工具条有 **复制视图链接**：把「当前页签 + 当前日期」编成一条 URL，例如

```
https://aq18270592902-cloud.github.io/jczq-predict/?demo=1&tab=bets&date=2026-11-13
```

发给队友，对方点开直接落在同一页同一天。切换页签时地址栏会同步更新（`?tab=compare&date=2026-11-11`），刷新不会跳回第一页。

## 实时赔率（浏览器直连体彩官方接口）

这是「数据不更新」的根治手段。GitHub Actions 免费档会把 `*/30` 降频到 4~5 小时一次，
靠 cron 保证赔率新鲜不现实，所以赔率改成浏览器自己去要。

```
打开页面
  └─ boot.js
       ├─ 加载 data.js          ← 静态底座（Actions 落盘的赛程/赛果/历史赔率）
       ├─ fetch 体彩官方接口    ← 实时层（当前在售场次 + 全玩法赔率）
       │    https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry
       │      ?poolCode=hhad,had,crs,ttg,hafu,sxds&channel=c
       ├─ mergeLive() 合并进 window.APP_DATA
       └─ 加载 app.js            ← 照常渲染
```

| 特性 | 说明 |
|---|---|
| 触发时机 | 页面打开即拉；之后每 **6 分钟**一次；标签页切回前台且超过 6 分钟立刻补拉 |
| 超时 | 6 秒（`AbortController`），超时不算错，静默用底座数据 |
| 合并规则 | 已有场次只刷 `time/league/home/away/rq/odds`，**`final`（我的预测）/ `preds`（模型预测）/ `result`（赛果）一律不动**；已完场的场次不覆盖赔率 |
| 失败回退 | 完全不影响页面，在售场次照常渲染（当前 21~22 场）；顶栏角标变红写「实时：失败（用底座数据）」，悬停看错误原文 |
| 角标含义 | 「底座 11-13 10:30（24 分钟前） · 官方 11-13 10:23」= data.js 落盘时间 + 体彩接口最后更新时间 |
| 跨域 | 接口返回 `access-control-allow-origin: *`，浏览器直连无阻碍；Service Worker 完全不介入跨域请求 |
| 手动刷新 | 顶栏「↻ 刷新实时赔率」，就地重拉重绘，不整页重载 |

**为什么只有「当天在售」的那十几场？** 体彩这个接口只返回当前销售期（实测 8~22 场随赛程密度浮动），`matchDate` / `businessDate` 等日期参数全部无效
（传了还是同一组数据）。所以实时层只覆盖在售场次，历史赛程与赛果仍靠 `fetch_official.js` + Actions 落盘到 `data.js`。
两者互补，不是替代关系。

**接口反爬注意**：Node 侧直连时，**不带 `User-Agent` 能过，只带 `User-Agent` 会被 567 拦**。
要带就带全套浏览器头（`Referer: https://www.sporttery.cn/` + `Origin` + `Accept: application/json`）。
`fetch_official.js` 里用的是 Node 默认头，所以一直是通的 —— 别顺手给它加 UA。

## 数据来源

| 来源 | 用途 | 地址 |
|---|---|---|
| 澳客竞彩在售页 | 当天/次日场次、编号、赔率 | `https://www.okooo.com/jingcai/` |
| 澳客赛果大厅 | 已完场比分 | `https://www.okooo.com/jingcai/kaijiang/` |
| 500 网 | 历史赛程/赛果回填（**仅最近 30 天**） | `https://trade.500.com/jczq/?date=YYYY-MM-DD` |

> **500 网的坑（已加防护）**：日期参数只对最近约 30 天生效。传更早的日期，它不报错，而是整页吐「今天在售」的场次。
> 早期回填就是这样把 9/30–10/13 写成了今天的比赛。现在 `fetch_official.js` 有两道闸：
> ① 窗口校验 —— 返回场次里落在 `date-2 ~ date+1` 之外的比例超过 40% 就整批丢弃；
> ② 星期校验 —— 编号前缀（周五/周六…）与业务日星期不符的场次直接过滤。
> 因此**早于 30 天的历史赛果补不回来**，只能保留 `data.js` 里已有的。

页面是 GBK 编码，抓下来要 `new TextDecoder('gbk')` 解。fetch 失败会自动回落 `curl.exe`（Windows 自带）。

手动拉一次：

```bash
node fetch_official.js
node fetch_official.js --migrate 张三     # 先把现有 final 迁移成 preds["张三"]
node fetch_official.js 2026-11-12        # 指定日期
```

> 赛果次日才齐，建议每天上午拉一次。

## 数据自动刷新（GitHub Actions）

仓库里带了一个定时任务 `.github/workflows/refresh-data.yml`：**cron 写的是每 30 分钟**，拉一次官方数据，有变化就自动提交回 `main`。

> 免费档注意：GitHub 会把 `*/30` 这类高频 cron **降频**，实测两次执行间隔 4.7~5.7 小时。
> 所以「赛果」最长会滞后几小时——这也是实时层（浏览器直连体彩）存在的原因：赔率不靠它，只有比分靠它。

```
cron */30 * * * *
  ├─ node fetch_official.js      # 抓澳客 + 体彩接口，写 data.js
  ├─ node scripts/verify-data.js # 结构校验，不通过直接红
  └─ git diff 有变化才 commit & push
```

所以 **Pages 上的演示站数据也是最新的**，不需要你本地开着服务。

页面顶栏显示「数据更新于 11-12 21:45（1 分钟前）」，来自 `data.js` 顶层 `meta.updatedAt`。这个时间戳由抓取脚本每次写盘时注入，鼠标悬停能看到完整 ISO 时间与总场次。

### 赔率合并规则（踩过的坑）

抓取脚本里有个 `mergeOdds(base, p)`：

| 场次状态 | 行为 |
|---|---|
| 已完场（有 `result`） | **保留终盘赔率，绝不覆盖** |
| 未开赛且本地无赔率 | 直接用新抓到的 |
| 未开赛且本地有赔率 | 只更新 `h/d/a` 三个主盘，`rq/tg/hf/sc/sxds` 保留 |

早期版本在未开赛时用澳客列表页的 `{h,d,a}` **整体替换**，把体彩接口灌进来的让球、总进球、半全场、比分玩法全抹掉（data.js 从 83827B 缩到 61597B）。`scripts/verify-data.js` 现在会在「有赔率但让球玩法为 0 场」时直接判红，防止再犯。

### 历史回填补齐（`scripts/backfill.js`）

`data.js` 平时只往前长（当天在售 + 赛果大厅能看到的几天），滚出页面的日期会留下空洞。补洞用：

```bash
node scripts/backfill.js                    # 自动找空洞，逐日补
node scripts/backfill.js 2026-10-14 2026-11-08   # 指定区间
node scripts/backfill.js --missing          # 只补完全缺失的整天
node scripts/backfill.js --force            # 已有数据也重抓
```

它按天调 `fetch_official.js <日期>`，默认注入 `SKIP_HALF=1` 跳过拿不到的半场比分（`live.500.com/detail.php` 恒返回 567 反爬页），日间限速 300ms。

**当前覆盖**：37 个业务日 / 522 场 / 492 场有赛果 / 504 场有赔率，范围 2026-09-25 → 2026-11-15。
2026-09-30 ~ 2026-10-13 这段是空的——500 网的日期窗口只有 30 天，补不回来。

## 演示模式怎么工作的

判断条件写在 `index.html` 里：

```js
if (/(^|\.)github\.io$/.test(location.hostname) || /[?&]demo=1/.test(location.search))
  window.STATIC_DEMO = true;
```

命中后 `app.js` 的行为：

| 位置 | 正常模式 | 演示模式 |
|---|---|---|
| `bootApp()` | 先 `fetch('/api/me')`，未登录弹登录遮罩 | 直接进主界面，顶栏写「演示模式」，隐藏退出按钮 |
| `loadJSON / persistUser` | 读写 `/api/data` | 读写 `localStorage`，不碰后端 |
| 数据轮询 | 每 2 小时 `autoCheck` | 不轮询后端；改由 `boot.js` 每 6 分钟拉体彩实时赔率 |
| 模型列 | 你录入的才有 | 注入 `模型A·示例` / `模型B·示例` 两列 |
| 投注记录 | 你自己的 | 注入三条示例方案（已中奖 / 未中 / 待开奖各一条） |

示例预测是按 `FNV-1a(日期|比赛编号|盐)` 算出来的确定性伪随机，同一场比赛每次刷新结果完全一致，不会「刷一下变一次」。

想本地验证演示效果，不用推到线上：

```bash
node server.js
# 打开 http://127.0.0.1:8765/?demo=1
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/status` | 更新状态：`updating` / `lastAt` / `lastOk` / `ageMin` |
| POST | `/api/update` | 触发拉取。**需带 `X-Admin-Token`**（见下） |
| POST | `/api/register` | `{phone, password}` → 建用户 + 设 `sid` cookie |
| POST | `/api/login` | `{phone, password}` → 设 `sid` cookie |
| POST | `/api/logout` | 清 session |
| GET | `/api/me` | 当前登录手机号 |
| GET | `/api/data` | 读当前用户全部数据 |
| POST | `/api/data` | `{key, value}` 写单个字段 |

可写字段白名单：`myFinal` `customModels` `preds` `renames` `order` `bets` `notes` `tags`。

### 管理 Token

`/api/update` 以前是裸奔的（任何访问者都能触发抓取）。现在的规则：

| 调用来源 | 未设 `ADMIN_TOKEN` | 已设 `ADMIN_TOKEN` |
|---|---|---|
| 本机回环 `127.0.0.1` | 放行 | 放行（页面上的「↻ 更新比赛数据」按钮走这条） |
| 外部来源 | 403 | 必须带 `X-Admin-Token` 且匹配 |

```bash
# 启动时指定
set ADMIN_TOKEN=你的随机串
node server.js

# 或者写进 .env（已 gitignore）
ADMIN_TOKEN=你的随机串
```

```bash
curl -X POST -H "X-Admin-Token: 你的随机串" http://127.0.0.1:8765/api/update
```

## 监听地址

默认 `127.0.0.1`，只本机可访问。要局域网访问：

```bash
set HOST=0.0.0.0
node server.js
```

此时**务必**同时设 `ADMIN_TOKEN`。

## 用户数据

`users/{手机号}.json`：

```json
{
  "phone": "13800138000",
  "salt": "16字节hex",
  "passHash": "scrypt-64字节hex",
  "createdAt": "2026-11-12T09:00:00.000Z",
  "data": { "myFinal": {}, "preds": {}, "bets": [], "notes": {} }
}
```

密码用 `scrypt`（Node 内置）加随机 salt，校验走 `crypto.timingSafeEqual` 常量时间比较。session 存在内存 Map 里，**重启服务即全部登出**。

## 排障

| 现象 | 原因 | 处理 |
|---|---|---|
| 端口占用无反应 | 已有实例在跑 | 服务遇到 `EADDRINUSE` 静默退出，先 `taskkill /F /IM node.exe`；Linux 上 `ss -lntp | grep 8765` 看谁占着 |
| 页面数据不更新 | 抓取失败 | `/api/status` 看 `lastOk`，手动跑 `node fetch_official.js` 看报错 |
| 中文乱码 | GBK 未解码 | 确认走的是 `TextDecoder('gbk')` 分支，不是 `r.text()` |
| 登录后立刻掉线 | 服务重启 | session 在内存，重启后需重新登录 |
| 演示站赔率不动 | 体彩接口被拦 / 断网 | 顶栏角标会变红写「实时：失败（用底座数据）」，鼠标悬停看具体错误；恢复网络后自动转绿 |
| 演示站赛果不更新 | Actions cron 降频 | 免费档 `*/30` 实际可能 4~5 小时跑一次；赛果不急，赔率走实时层不受影响 |
| `/users/xxx.json` 打不开 | 显式 404 保护 | 正常，用户数据不经静态托管暴露 |
| 数据时间戳一直是旧的 | Actions 没跑或抓取失败 | Actions 页看 refresh-data 最近一次 run，或本地 `node fetch_official.js`；注意角标现在分两段：「底座」= data.js 落盘时间，「官方」= 体彩接口最后更新时间 |
| data.js 突然变小 | 玩法赔率被整体覆盖 | 跑 `node scripts/verify-data.js`，看是否报「丢失让球玩法赔率」 |

## 依赖

无。只用 Node 内置模块：`http` `fs` `path` `crypto` `child_process`。Node 18+（需要全局 `fetch`）。

---

## 其他项目

- [绘梦工坊 Studio](https://github.com/aq18270592902-cloud/huimeng-studio) —— 文生图 / 文生视频的网页工作台
- [租号么 · 数据浏览器](https://github.com/aq18270592902-cloud/zuhaome-db) —— 游戏账号数据检索面板
- [竞足预测汇总](https://aq18270592902-cloud.github.io/jczq-predict/?demo=1&tab=summary) —— 官方赛程赛果 + 多源预测对比 + 命中率复盘（就是本仓库，[部署文档](DEPLOY.md)）
