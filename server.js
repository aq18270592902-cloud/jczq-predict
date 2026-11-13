/* =========================================================
 * 竞足预测汇总 - 本地服务
 * 1) 静态托管项目目录（http://0.0.0.0:8765）
 * 2) /api/update        手动/静默触发官方数据拉取（已登录用户 / 本机 / 带 X-Admin-Token 才放行）
 * 3) /api/status        查询更新状态（前端决定是否提示刷新）
 * 4) /api/register      注册新用户（写 users/{手机号}.json + 设置 sid cookie）
 * 5) /api/login         校验密码 + 设置 sid cookie
 * 6) /api/logout        清 session + 清 cookie
 * 7) /api/me            当前登录用户（cookie sid → 手机号）
 * 8) /api/data          GET 读 / POST 写当前用户 8 个私有数据字段
 * 9) 定时自动更新：启动 8 秒后拉一次，之后每 2 小时一次
 *    （当天场次/赔率随在售页更新；完场比分随赛果大厅更新）
 * 仅用 Node 内置模块：http / fs / path / crypto / child_process
 * ======================================================= */
const http = require('http'), fs = require('fs'), path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const root = __dirname;
const NODE = process.execPath;
const FETCH = path.join(root, 'fetch_official.js');
const INTERVAL = 2 * 60 * 60 * 1000; /* 2小时 */
const START_DELAY = 8 * 1000;
const USERS_DIR = path.join(root, 'users');
const SESSIONS = new Map(); /* sid(hex32) -> phone */
const DATA_KEYS = new Set(['myFinal', 'customModels', 'preds', 'renames', 'order', 'bets', 'notes', 'tags']);
const MAX_BODY = 5 * 1024 * 1024; /* 5MB */
const SESSION_MAX_AGE = 30 * 24 * 3600;

/* ── GitHub 回推（可选）：让 Pages 与服务器共用同一份 data.js ──────────────
   服务器 2 小时刷一次，GitHub Actions 的 cron 免费档实测 4.7~7.2 小时才跑一次，
   所以 Pages 的数据天然比服务器旧几小时。开启本功能后，doUpdate 成功就把
   data.js 推回仓库，Pages 构建完即与服务器同源同新鲜度。
   开启方式：在 /opt/jczq-predict/.env 里加两行
     GITHUB_TOKEN=ghp_xxx      （fine-grained token，只需 Contents: Read and write）
     GITHUB_REPO=aq18270592902-cloud/jczq-predict
   不配则完全不联网、零行为变化。 */
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || '').trim();
const GITHUB_REPO  = String(process.env.GITHUB_REPO  || '').trim();
const GITHUB_PATH  = String(process.env.GITHUB_PATH  || 'data.js').trim();
const GITHUB_BRANCH= String(process.env.GITHUB_BRANCH|| 'main').trim();
const GH_ENABLED = !!(GITHUB_TOKEN && /^[^\/]+\/[^\/]+$/.test(GITHUB_REPO));
const GH_API = 'https://api.github.com';

/* 取当前文件 sha；不存在返回 null（首次推送）。 */
async function ghGetSha() {
  const url = `${GH_API}/repos/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_PATH)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'jczq-predict-server'
    }
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET sha ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.sha || null;
}

/* 内容未变就不推（比较仓库里的 sha 与本地 blob sha）。 */
function gitBlobSha(buf) {
  return crypto.createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf]))
    .digest('hex');
}

/* 把 data.js 回推仓库。失败只记日志，绝不影响刷新主流程。 */
async function pushDataToGitHub() {
  if (!GH_ENABLED) return { skipped: true, reason: 'GITHUB_TOKEN/GITHUB_REPO 未配置' };
  const file = path.join(root, GITHUB_PATH);
  let buf;
  try { buf = await fs.promises.readFile(file); }
  catch (e) { return { ok: false, err: `读本地 ${GITHUB_PATH} 失败: ${e.message}` }; }
  const localSha = gitBlobSha(buf);
  let remoteSha = null;
  try { remoteSha = await ghGetSha(); }
  catch (e) { return { ok: false, err: `取远端 sha 失败: ${e.message}` }; }
  if (remoteSha === localSha) return { ok: true, skipped: true, reason: '内容一致，无需推送', sha: localSha };

  const body = {
    message: `chore(data): 服务器回推 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`,
    content: buf.toString('base64'),
    branch: GITHUB_BRANCH
  };
  if (remoteSha) body.sha = remoteSha;
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(`${GH_API}/repos/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_PATH)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'jczq-predict-server'
        },
        body: JSON.stringify(body)
      });
      if (r.ok) {
        const j = await r.json();
        return { ok: true, sha: (j.content && j.content.sha) || localSha, bytes: buf.length, commit: j.commit && j.commit.sha };
      }
      const txt = (await r.text()).slice(0, 300);
      /* 409/422 = sha 过期（别人刚推过），重取 sha 再来 */
      if ((r.status === 409 || r.status === 422) && i < 3) {
        try { const s2 = await ghGetSha(); if (s2) body.sha = s2; else delete body.sha; } catch (_) {}
        await new Promise(t => setTimeout(t, 800 * i));
        continue;
      }
      return { ok: false, err: `PUT ${r.status} ${txt}` };
    } catch (e) {
      if (i === 3) return { ok: false, err: `PUT 异常: ${e.message}` };
      await new Promise(t => setTimeout(t, 800 * i));
    }
  }
  return { ok: false, err: 'PUT 重试耗尽' };
} /* 30 天（秒） */

/* ---- 部署配置：默认只监听本机，管理接口需 Token ---- */
const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '').trim();
/* 前面有 nginx 反代时所有连接都来自 127.0.0.1，必须靠 X-Forwarded-For 还原真实来源 */
const TRUST_PROXY = String(process.env.TRUST_PROXY || '').trim() === '1';
/* 对外监听却没设 Token 时，启动即拒绝，避免管理接口裸奔 */
/* 还原真实客户端 IP：直连时就是 socket 地址；TRUST_PROXY=1 时取代理头最后一个值 */
function clientIp(q) {
  const direct = String(q.socket.remoteAddress || '');
  if (!TRUST_PROXY) return direct;
  const xff = String(q.headers['x-forwarded-for'] || '').split(',').map(v => v.trim()).filter(Boolean);
  const real = String(q.headers['x-real-ip'] || '').trim();
  const ip = real || (xff.length ? xff[xff.length - 1] : '');
  return ip || direct;
}
function isLoopback(ip) {
  const s = String(ip || '').replace(/^::ffff:/, '');
  return s === '127.0.0.1' || s === '::1' || s === 'localhost' || /^127./.test(s);
}

if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !ADMIN_TOKEN) {
  console.error('[fatal] HOST=' + HOST + ' 但未设置 ADMIN_TOKEN，拒绝启动。');
  console.error('        设置方式：set ADMIN_TOKEN=随机串 && node server.js');
  process.exit(1);
}

/* 启动时确保 users/ 目录存在 */
try { fs.mkdirSync(USERS_DIR, { recursive: true }); } catch (e) { /* 已存在或无权限 */ }

/* ---- 密码哈希：scrypt + 随机 16 字节 salt，哈希 64 字节 ---- */
function hashPass(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}
function verifyPass(password, saltHex, hashHex) {
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expect = Buffer.from(hashHex, 'hex');
  const got = crypto.scryptSync(password, salt, 64);
  /* 常量时间比较，防侧信道 */
  return got.length === expect.length && crypto.timingSafeEqual(got, expect);
}

/* ---- 请求体解析：JSON 上限 5MB ---- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BODY) { req.destroy(); return reject(new Error('body_too_large')); }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { resolve({}); /* 容错：非 JSON 当空对象 */ }
    });
    req.on('error', reject);
  });
}

/* ---- cookie 解析：req.headers.cookie 内取 sid ---- */
function getSessionPhone(req) {
  const ck = req.headers.cookie || '';
  const m = ck.match(/(?:^|;\s*)sid=([0-9a-f]{32})/i);
  if (!m) return null;
  return SESSIONS.get(m[1]) || null;
}

/* ---- 生成新的 32 位 hex sessionId + 对应 cookie 字符串 ---- */
function newSession(phone) {
  const sid = crypto.randomBytes(16).toString('hex');
  SESSIONS.set(sid, phone);
  return `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}`;
}
function clearSessionCookie() { return 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'; }

/* ---- 用户文件路径：仅允许 11 位数字手机号，防路径穿越 ---- */
function userFile(phone) {
  if (!/^\d{11}$/.test(phone)) return null;
  return path.join(USERS_DIR, phone + '.json');
}
function readUser(phone) {
  const f = userFile(phone);
  if (!f) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}
function writeUser(phone, obj) {
  const f = userFile(phone);
  if (!f) return false;
  try { fs.writeFileSync(f, JSON.stringify(obj, null, 2)); return true; } catch (e) { return false; }
}

function sendJson(s, status, obj, headers) {
  const h = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, headers || {});
  s.writeHead(status, h);
  s.end(JSON.stringify(obj));
}

const state = {
  updating: false, lastAt: 0, lastOk: null, lastLog: '', timer: null,
  /* GitHub 回推结果（供 /api/status 展示，排查「Pages 为什么不更新」） */
  ghAt: 0, ghOk: null, ghMsg: '', ghSha: ''
};

function runFetch(date) {
  return new Promise((resolve) => {
    const args = [FETCH];
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) args.push(date);
    const child = spawn(NODE, args, { cwd: root, windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

async function doUpdate(date, manual) {
  if (state.updating) return { skipped: true, updating: true };
  state.updating = true;
  try {
    const r = await runFetch(date);
    state.lastAt = Date.now();
    state.lastOk = r.code === 0;
    state.lastLog = (r.out + r.err).slice(-2000);
    /* 拉取成功后把 data.js 回推 GitHub，让 Pages 与服务器同源同新鲜度。
       失败不影响本次刷新结果，只记在 state.gh* 里。 */
    let gh = null;
    if (state.lastOk) {
      try {
        gh = await pushDataToGitHub();
        state.ghAt = Date.now();
        state.ghOk = !!gh.ok;
        state.ghMsg = gh.ok ? (gh.skipped ? (gh.reason || '内容一致') : `已推送 ${gh.bytes || 0}B @ ${String(gh.commit || '').slice(0, 7)}`) : String(gh.err || '');
        if (gh.ok && gh.sha) state.ghSha = gh.sha;
        console.log(`[github] ${state.ghOk ? 'OK' : 'FAIL'} ${state.ghMsg}`);
      } catch (e) {
        state.ghAt = Date.now(); state.ghOk = false;
        state.ghMsg = String((e && e.message) || e);
        console.log('[github] 异常 ' + state.ghMsg);
      }
    }
    return { ok: state.lastOk, log: state.lastLog, github: gh };
  } catch (e) {
    state.lastAt = Date.now();
    state.lastOk = false;
    state.lastLog = String((e && e.message) || e);
    return { ok: false, log: state.lastLog };
  } finally {
    state.updating = false;
  }
}

/* 定时自动更新（无日期参数：拉当天在售+近两天赛果） */
setTimeout(() => { doUpdate(); state.timer = setInterval(() => doUpdate(), INTERVAL); }, START_DELAY);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  /* robots.txt 与 sitemap.xml 原来落到 application/octet-stream —— 搜索引擎抓 sitemap
     时会因为类型不认识而跳过，等于 sitemap 白写。这里补齐文本类。 */
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp4': 'video/mp4'
};

/* 无扩展名的纯文本文件（VERSION / LICENSE / README）单独认一下，
   否则会落到 application/octet-stream，浏览器直接变成下载。 */
const TEXT_NOEXT = new Set(['VERSION', 'LICENSE', 'README', 'CHANGELOG', 'NOTICE']);
function contentTypeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext && MIME[ext]) return MIME[ext];
  if (!ext && TEXT_NOEXT.has(path.basename(file).toUpperCase())) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

/* 404 页面：有 404.html 就回整页（带样式与返回链接），没有就退回纯文本 */
function send404(s) {
  fs.readFile(path.join(root, '404.html'), (e, d) => {
    if (e) { s.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return s.end('404 Not Found'); }
    s.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    s.end(d);
  });
}

/* ---- 静态资源缓存策略 ----
 * index.html / data.js / sw.js：每次都回源（数据和版本随时会变）
 * 带 ?v= 的资源（boot.js?v=、app.js?v=、style.css?v=）：一年强缓存 immutable
 * 其余（图标、manifest）：10 分钟 + ETag 条件请求
 * ETag 用 size + mtime，部署换文件即失效，不用读全文件算哈希。 */
function cacheControlFor(pathname, hasVer) {
  if (pathname === '/' || pathname === '/index.html') return 'no-cache';
  if (pathname === '/data.js' || pathname === '/sw.js') return 'no-cache';
  if (hasVer) return 'public, max-age=31536000, immutable';
  return 'public, max-age=600, must-revalidate';
}



const srv = http.createServer(async (q, s) => {
  const u = new URL(q.url, 'http://x');
  const p = u.pathname;

  if (p === '/api/status') {
    s.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return s.end(JSON.stringify({
      updating: state.updating,
      lastAt: state.lastAt,
      lastOk: state.lastOk,
      ageMin: state.lastAt ? Math.round((Date.now() - state.lastAt) / 60000) : null,
      /* GitHub 回推状态：ghOk=null 表示还没跑过或未配置；ghMsg 是给人看的一句话 */
      github: GH_ENABLED ? {
        enabled: true,
        repo: GITHUB_REPO,
        path: GITHUB_PATH,
        branch: GITHUB_BRANCH,
        at: state.ghAt || null,
        ok: state.ghOk,
        msg: state.ghMsg,
        sha: state.ghSha
      } : { enabled: false, hint: '在 .env 里配 GITHUB_TOKEN 与 GITHUB_REPO 即可让 Pages 与服务器同源' }
    }));
  }

  if (p === '/api/update') {
    /* 鉴权三选一：本机直连 / 已登录用户 / 正确的 X-Admin-Token。
       页面上的「↻ 更新比赛数据」按钮走登录态，所以服务器上登录后照样能点。 */
    const ip = clientIp(q);
    const token = String(q.headers['x-admin-token'] || '');
    let allowed = isLoopback(ip) || !!getSessionPhone(q);
    if (!allowed && ADMIN_TOKEN && token) {
      const a = Buffer.from(token), b = Buffer.from(ADMIN_TOKEN);
      allowed = a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    if (!allowed) {
      return sendJson(s, 403, { ok: false, err: '需要登录，或带正确的 X-Admin-Token' });
    }
    const date = u.searchParams.get('date') || '';
    const r = await doUpdate(date);
    return sendJson(s, 200, r.skipped ? { ok: true, busy: true } : r);
  }

  /* ---- 注册：创建用户文件 + 设置 session cookie ---- */
  if (p === '/api/register' && q.method === 'POST') {
    const body = await readBody(q);
    const phone = String(body.phone || '').trim();
    const password = String(body.password || '');
    if (!/^\d{11}$/.test(phone)) return sendJson(s, 400, { ok: false, err: '手机号必须为 11 位数字' });
    if (password.length < 6 || password.length > 20) return sendJson(s, 400, { ok: false, err: '密码长度 6-20 位' });
    if (readUser(phone)) return sendJson(s, 400, { ok: false, err: '手机号已注册' });
    const { salt, hash } = hashPass(password);
    const ok = writeUser(phone, {
      phone, salt, passHash: hash, createdAt: new Date().toISOString(),
      data: { myFinal: {}, customModels: [], preds: {}, renames: {}, order: [], bets: [], notes: {}, tags: {} }
    });
    if (!ok) return sendJson(s, 500, { ok: false, err: '无法写入用户文件' });
    return sendJson(s, 200, { ok: true, phone }, { 'Set-Cookie': newSession(phone) });
  }

  /* ---- 登录：校验密码 + 设置 session cookie ---- */
  if (p === '/api/login' && q.method === 'POST') {
    const body = await readBody(q);
    const phone = String(body.phone || '').trim();
    const password = String(body.password || '');
    if (!/^\d{11}$/.test(phone) || !password) return sendJson(s, 400, { ok: false, err: '手机号或密码错误' });
    const user = readUser(phone);
    if (!user || !verifyPass(password, user.salt, user.passHash)) {
      return sendJson(s, 400, { ok: false, err: '手机号或密码错误' });
    }
    return sendJson(s, 200, { ok: true, phone }, { 'Set-Cookie': newSession(phone) });
  }

  /* ---- 退出：清 session + 清 cookie ---- */
  if (p === '/api/logout' && q.method === 'POST') {
    const ck = q.headers.cookie || '';
    const m = ck.match(/(?:^|;\s*)sid=([0-9a-f]{32})/i);
    if (m) SESSIONS.delete(m[1]);
    return sendJson(s, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
  }

  /* ---- 当前登录用户：cookie sid → 手机号 ---- */
  if (p === '/api/me' && q.method === 'GET') {
    const phone = getSessionPhone(q);
    if (phone) return sendJson(s, 200, { ok: true, phone });
    return sendJson(s, 401, { ok: false });
  }

  /* ---- 用户数据：GET 读 / POST 写单字段（需登录） ---- */
  if (p === '/api/data' && q.method === 'GET') {
    const phone = getSessionPhone(q);
    if (!phone) return sendJson(s, 401, { ok: false, err: '未登录' });
    const user = readUser(phone);
    if (!user) return sendJson(s, 404, { ok: false, err: '用户不存在' });
    return sendJson(s, 200, Object.assign({ ok: true }, user.data || {}));
  }
  if (p === '/api/data' && q.method === 'POST') {
    const phone = getSessionPhone(q);
    if (!phone) return sendJson(s, 401, { ok: false, err: '未登录' });
    const body = await readBody(q);
    const key = String(body.key || '');
    const value = body.value;
    if (!DATA_KEYS.has(key)) return sendJson(s, 400, { ok: false, err: '非法字段：' + key });
    const user = readUser(phone);
    if (!user) return sendJson(s, 404, { ok: false, err: '用户不存在' });
    user.data = user.data || {};
    user.data[key] = value;
    if (!writeUser(phone, user)) return sendJson(s, 500, { ok: false, err: '写入失败' });
    return sendJson(s, 200, { ok: true });
  }

  let fp = p === '/' ? '/index.html' : p;
  let decoded;
  try { decoded = decodeURIComponent(fp); } catch (e) { s.writeHead(400); return s.end('400'); }
  /* 路径穿越防护：解析后必须仍在项目根目录内 */
  const f = path.resolve(root, '.' + decoded);
  if (f !== root && !f.startsWith(root + path.sep)) {
    s.writeHead(403); return s.end('403');
  }
  /* users/ 目录与 keys.json 禁止通过静态服务访问 */
  if (f.startsWith(path.join(root, 'users') + path.sep) || f === path.join(root, 'keys.json')) {
    s.writeHead(404); return s.end('404');
  }
  fs.stat(f, (se, st) => {
    if (se || !st.isFile()) return send404(s);
    const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    const cc = cacheControlFor(decoded, u.searchParams.has('v'));
    if (String(q.headers['if-none-match'] || '').trim() === etag) {
      s.writeHead(304, { 'ETag': etag, 'Cache-Control': cc });
      return s.end();
    }
    fs.readFile(f, (e, d) => {
      if (e) return send404(s);
      s.writeHead(200, {
        'Content-Type': contentTypeOf(f),
        'Cache-Control': cc,
        'ETag': etag
      });
      s.end(d);
    });
  });
});
srv.on('error', (e) => {
  if (e.code === 'EADDRINUSE') process.exit(0); /* 已有实例在跑，静默退出 */
  throw e;
});
srv.listen(PORT, HOST, () => {
  console.log('竞足预测汇总 已启动: http://' + HOST + ':' + PORT);
  console.log('管理接口鉴权: ' + (ADMIN_TOKEN ? 'ADMIN_TOKEN 已配置' : '未配置') + ' / 已登录用户可调用 /api/update' + (TRUST_PROXY ? ' / TRUST_PROXY=1（按 X-Forwarded-For 还原来源）' : ''));
});
