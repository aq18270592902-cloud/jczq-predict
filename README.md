# 竞足预测汇总

本地跑的一个竞彩足球数据面板：自动拉官方赛程与赛果 → 多模型预测录入 → 对比 → 投注方案 → 历史统计。带手机号注册登录，数据存在本机 `users/` 目录，不联网同步。

---

## 快速开始

```bash
node server.js
# 打开 http://127.0.0.1:8765
```

Windows 双击 `启动网页服务.vbs` 静默启动（无黑窗）。开机自启：把该 vbs 的快捷方式丢进 `shell:startup`。

首次启动 8 秒后自动拉一次数据，之后每 2 小时一次。

## 目录结构

```
ccss/
├─ server.js          # HTTP 服务：静态托管 + 账号 + 用户数据 API + 定时更新
├─ fetch_official.js  # 抓取脚本：澳客竞彩 + 500 网，写入 data.js
├─ index.html         # 单页前端
├─ app.js             # 前端逻辑（4 个 tab + 表格渲染 + 导出）
├─ style.css          # 样式
├─ data.js            # 赛事数据（fetch_official.js 自动生成/覆盖）
├─ keys.json          # 【已废弃】早期卡密文件，已加入 .gitignore
├─ users/             # 用户数据，含密码哈希，已 gitignore
├─ 启动网页服务.vbs
└─ 拉取官方数据.bat
```

## 数据来源

| 来源 | 用途 | 地址 |
|---|---|---|
| 澳客竞彩在售页 | 当天/次日场次、编号、赔率 | `https://www.okooo.com/jingcai/` |
| 澳客赛果大厅 | 已完场比分 | `https://www.okooo.com/jingcai/kaijiang/` |
| 500 网 | 备用场次校验 | `https://trade.500.com/jczq/` |

页面是 GBK 编码，抓下来要 `new TextDecoder('gbk')` 解。fetch 失败会自动回落 `curl.exe`（Windows 自带）。

手动拉一次：

```bash
node fetch_official.js
node fetch_official.js --migrate 张三     # 先把现有 final 迁移成 preds["张三"]
node fetch_official.js 2026-11-12        # 指定日期
```

> 赛果次日才齐，建议每天上午拉一次。

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

`/api/update` 以前是裸奔的（任何访问者都能触发抓取）。现在要求：

```bash
# 启动时指定
set ADMIN_TOKEN=你的随机串
node server.js

# 或者写进 .env（已 gitignore）
ADMIN_TOKEN=你的随机串
```

没设 `ADMIN_TOKEN` 时，服务只监听 `127.0.0.1`，`/api/update` 仅允许本机调用。

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
| 端口占用无反应 | 已有实例在跑 | 服务遇到 `EADDRINUSE` 静默退出，先 `taskkill /F /IM node.exe` |
| 页面数据不更新 | 抓取失败 | `/api/status` 看 `lastOk`，手动跑 `node fetch_official.js` 看报错 |
| 中文乱码 | GBK 未解码 | 确认走的是 `TextDecoder('gbk')` 分支，不是 `r.text()` |
| 登录后立刻掉线 | 服务重启 | session 在内存，重启后需重新登录 |

## 依赖

无。只用 Node 内置模块：`http` `fs` `path` `crypto` `child_process`。Node 18+（需要全局 `fetch`）。
