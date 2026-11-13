# imgapi-invite-farm

> 在 GitHub Actions 上跑的一套邀请积分流水线：Gmail 别名收信 → 自动取验证码 → 注册 → 签到 → 出图 → 主号结算积分。每个 runner 一个独立公网 IP，绕开同 IP 注册上限。

<p>
  <a href="https://github.com/aq18270592902-cloud/imgapi-invite-farm/actions/workflows/farm.yml"><img alt="GitHub Actions" src="https://img.shields.io/badge/GitHub%20Actions-6%20%E5%88%86%E7%89%87%E5%B9%B6%E8%A1%8C-2088ff?style=flat-square&logo=githubactions&logoColor=white"></a>
  <img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white">
  <img alt="仓库" src="https://img.shields.io/badge/%E4%BB%93%E5%BA%93-Private-red?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square">
</p>

---

## 一句话

一个 `farm.mjs` 跑完整条链路，`farm.yml` 把它切成 6 片并行，每天 09:10（北京）自动执行，产出落在 `keys/YYYY-MM-DD.txt`。本机不参与。

## 1. 它到底做什么

一条完整链路，全部在 CI 里跑完，本机不参与：

```
Gmail 别名收信 ──▶ 取 6 位验证码 ──▶ loginByEmail(带邀请码) ──▶ 拿到 key
                                          │
                                          ├─▶ /charge/signin   签到
                                          ├─▶ /tool/imgapi/draw/Async  提交出图
                                          └─▶ /tool/gptimage2/query    轮询结果
```

每个新号自带约 22 分，邀请奖励 100 分/号，每日上限 20 号。

## 2. 仓库结构（与代码一一对应）

```
imgapi-invite-farm/
├─ farm.mjs                     # 唯一主程序：IMAP 取码 + 注册 + 签到 + 出图 + 轮询
├─ .github/workflows/
│  ├─ farm.yml                  # 每日 01:10 UTC（09:10 北京）+ 6 并行 shard
│  └─ keepalive.yml             # 每月 1 号提交一次，防 60 天无活动禁用定时
├─ daily.ps1                    # 本机手动补跑（当天已成功则跳过）
├─ install-task.ps1             # 注册 Windows 计划任务（09:20 兜底）
├─ keys/YYYY-MM-DD.txt          # 产出：当天注册成功的邮箱 + key + 状态
├─ LICENSE                      # MIT
└─ out/                         # 本机跑时的中间产物（已 gitignore）
```

> 早期 README 提到的 `tools/gen.mjs`、`tools/imgapi-mail2.mjs` 已不存在，逻辑全部收敛进 `farm.mjs`。

## 3. 需要的 Secrets

| 名称 | 必填 | 说明 |
|---|---|---|
| `GMAIL_USER` | ✅ | 主 Gmail 地址，用作别名母体 |
| `GMAIL_PASS` | ✅ | Gmail **应用专用密码**（16 位，非登录密码） |
| `INVITE_CODE` | ⬜ | 邀请码，缺省回落到 `farm.mjs` 第 24 行的内置常量 `6H0GNN` |
| `MAIN_TOKEN` | ⬜ | 主号 token，仅用于在 Summary 里打印积分 |
| `MAIN_KEY` | ⬜ | 主号 key，同上 |

```bash
gh secret set GMAIL_USER
gh secret set GMAIL_PASS
gh secret set INVITE_CODE
gh secret set MAIN_TOKEN
gh secret set MAIN_KEY
```

## 4. 怎么跑

**定时**：什么都不用做，每天 09:10（北京）自动执行。

**手动补跑**：
```bash
gh workflow run farm.yml
gh workflow run farm.yml -f count=1 -f shards=1     # 小批量验证
gh run list --workflow farm.yml --limit 5
gh run watch
```

**本机兜底**（PC 开着才会跑）：
```powershell
powershell -ExecutionPolicy Bypass -File .\install-task.ps1   # 装一次即可
powershell -ExecutionPolicy Bypass -File .\daily.ps1          # 立即补跑
```

## 5. 参数与环境变量

| 变量 | 默认 | 含义 |
|---|---|---|
| `START` | `0` | 起始序号，决定别名后缀 `+farm{N}` |
| `COUNT` | `3` | 本 shard 注册数量 |
| `ALIAS_BASE` | 空 | 别名模板，必须含 `{i}`，如 `you+farm{i}@gmail.com` |
| `INVITE_CODE` | 内置常量 | 邀请码 |
| `OUT_DIR` | `.` | 结果文件落盘目录 |

序号分配：`START = 6000 + 年内第几天 × 40 + shard × COUNT`，同一天不同 shard 不会撞号。

## 6. 产出

- `keys/YYYY-MM-DD.txt`：每行 `邮箱 key ok|fail`
- 每个 shard 单独上传 artifact `keys-<n>`，report job 合并去重后提交回仓库
- Run Summary 里打印主号当前积分

## 7. 已知限制

- Gmail 别名共享同一收件箱，取码靠 `To` 头匹配别名，**必须**用 `+xxx` 别名，不能用独立邮箱
- IMAP 取码轮询上限 180 秒，超时该号判失败，不影响其他号
- 出图轮询上限 40 次 × 4 秒 ≈ 160 秒
- Actions 免费额度：6 shard × 约 3 分钟 ≈ 每天 18 分钟

## 8. 排障

| 现象 | 原因 | 处理 |
|---|---|---|
| `imap login failed` | 用的是登录密码 | 换 Gmail 应用专用密码 |
| `no code` | 别名没匹配上 / 邮件延迟 | 检查 `ALIAS_BASE` 的 `{i}` 是否被正确替换 |
| `send fail` | 触发频率限制 | 减少 `count`，拉长间隔 |
| 定时不触发 | 60 天无提交被禁用 | keepalive workflow 已处理，或手动 `gh workflow run keepalive.yml` |
