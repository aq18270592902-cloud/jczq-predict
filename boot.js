/* boot.js — 竞足预测汇总 · 引导层（静态底座 + 体彩官方实时接口）
 *
 * 加载顺序必须串行（app.js 顶部的 const DATA = window.APP_DATA 依赖底座已就绪）：
 *   1. data.js   静态底座，GitHub Actions 每 30 分钟落盘一次（cron 会被免费档降频，不可当作实时源）
 *   2. 体彩实时  浏览器直连 webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry
 *                该接口 access-control-allow-origin: *，无需代理；返回「当前在售」那一组场次的
 *                胜平负 had / 让球 hhad / 总进球 ttg / 半全场 hafu / 比分 crs / 上下单双 sxds
 *   3. app.js    页面逻辑
 *   4. SW 注册
 *
 * 实时接口失败（断网、接口改版、被运营商拦）时静默回退静态底座，页面照常可用。
 * 结果写到 window.__LIVE，供数据角标与「载入最新数据」按钮读取。
 */
(function () {
  "use strict";

  /* 发版标记：改它等于强制所有访客重新拉 data.js / app.js。
     GitHub Pages 对静态资源给 Cache-Control: max-age=600，浏览器 HTTP 缓存
     会在这 10 分钟内继续吐旧 app.js —— 只靠 SW 换 CACHE 版本号治不了这一层，
     必须让 URL 本身变掉。 */
  var BUILD = (function () {
    /* 版本号从自身 <script src="boot.js?v=..."> 上取，发版只改 index.html 一处。
       index.html 走 network-first，一定拿到新的 v，于是 app.js / data.js 的 URL
       也跟着变，彻底绕开 Pages 的 max-age=600。 */
    try {
      var src = (document.currentScript && document.currentScript.src) || "";
      var m = /[?&]v=([^&]+)/.exec(src);
      if (m) return decodeURIComponent(m[1]);
    } catch (e) {}
    return "20261113c";
  })();

  var LIVE_URL = "https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry"
    + "?poolCode=hhad,had,crs,ttg,hafu,sxds&channel=c";
  var LIVE_TIMEOUT = 6000;
  var POOL_KEYS = ["rq", "tg", "hf", "sc", "sxds"];

  /* ---------- 小工具 ---------- */
  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }
  function str(v) {
    if (v === null || v === undefined || v === "") return null;
    return String(v);
  }
  /* "2026-11-13 10:23:27"（北京时间）→ ISO 串，供 new Date() 解析 */
  function isoFromCn(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(s || "").trim());
    if (!m) return "";
    return m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":" + m[6] + "+08:00";
  }

  /* ---------- 体彩字段 → data.js 结构 ---------- */
  /* 比分：s00s00 → "0:0"；s1sh/s1sd/s1sa 是「胜其他/平其他/负其他」 */
  var CRS_MAP = (function () {
    var map = {}, h, a;
    for (h = 0; h <= 5; h++) {
      for (a = 0; a <= 5; a++) map["s0" + h + "s0" + a] = h + ":" + a;
    }
    map.s1sh = "胜其他"; map.s1sd = "平其他"; map.s1sa = "负其他";
    return map;
  })();

  function mapTtg(t) {
    if (!t) return null;
    var out = {}, any = false, i, v;
    for (i = 0; i <= 7; i++) {
      v = str(t["s" + i]);
      if (v != null) { out[i] = v; any = true; }
    }
    return any ? out : null;
  }
  function mapHafu(f) {
    if (!f) return null;
    var keys = ["hh", "hd", "ha", "dh", "dd", "da", "ah", "ad", "aa"];
    var out = {}, any = false, i, v;
    for (i = 0; i < keys.length; i++) {
      v = str(f[keys[i]]);
      if (v != null) { out[keys[i]] = v; any = true; }
    }
    return any ? out : null;
  }
  function mapCrs(c) {
    if (!c) return null;
    var out = {}, any = false, k, v;
    for (k in CRS_MAP) {
      if (!Object.prototype.hasOwnProperty.call(CRS_MAP, k)) continue;
      v = str(c[k]);
      if (v != null) { out[CRS_MAP[k]] = v; any = true; }
    }
    return any ? out : null;
  }
  function mapSxds(s) {
    if (!s) return null;
    var keys = ["sd", "ss", "xd", "xs"];
    var out = {}, any = false, i, v;
    for (i = 0; i < keys.length; i++) {
      v = str(s[keys[i]]);
      if (v != null) { out[keys[i]] = v; any = true; }
    }
    return any ? out : null;
  }

  function toMatch(m) {
    if (!m || !m.matchNumStr) return null;
    var had = m.had || {};
    var h = num(had.h), d = num(had.d), a = num(had.a);
    if (h == null && d == null && a == null) return null; /* 无胜平负赔率的场次不进表 */

    var hhad = m.hhad || {};
    var line = (hhad.goalLine === null || hhad.goalLine === undefined) ? "" : String(hhad.goalLine);

    var odds = { h: h, d: d, a: a };
    if (line !== "" && hhad.h != null) {
      odds.rq = { line: line, h: str(hhad.h), d: str(hhad.d), a: str(hhad.a) };
    }
    var tg = mapTtg(m.ttg); if (tg) odds.tg = tg;
    var hf = mapHafu(m.hafu); if (hf) odds.hf = hf;
    var sc = mapCrs(m.crs); if (sc) odds.sc = sc;
    var sx = mapSxds(m.sxds); if (sx) odds.sxds = sx;
    if (had.updateDate && had.updateTime) odds.upd = had.updateDate + " " + had.updateTime;

    var out = {
      id: m.matchNumStr,
      time: String(m.matchTime || "").slice(0, 5),
      league: m.leagueAbbName || "",
      home: m.homeTeamAbbName || "",
      away: m.awayTeamAbbName || "",
      odds: odds,
      live: true
    };
    if (line !== "") out.rq = line;
    if (m.businessDate) out.date = m.businessDate;
    return out;
  }

  function parseLive(json) {
    var v = (json && json.value) || {};
    var groups = v.matchInfoList || [];
    var raw = [], i, k;
    for (i = 0; i < groups.length; i++) {
      var sub = groups[i].subMatchList || [];
      for (k = 0; k < sub.length; k++) raw.push(sub[k]);
    }
    var matches = [], one;
    for (i = 0; i < raw.length; i++) {
      one = toMatch(raw[i]);
      if (one) matches.push(one);
    }
    if (!matches.length) throw new Error("体彩接口返回 0 场");
    return {
      businessDate: matches[0].date || "",
      lastUpdateTime: v.lastUpdateTime || "",
      updatedAt: isoFromCn(v.lastUpdateTime) || new Date().toISOString(),
      matches: matches
    };
  }

  /* ---------- 赔率合并：已完场保留终盘，未开赛全量刷新（与 fetch_official.js 的 mergeOdds 同规则） ---------- */
  function mergeOdds(base, next) {
    if (!base) return next || null;
    if (!next) return base;
    var out = {}, k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    if (next.h != null) out.h = next.h;
    if (next.d != null) out.d = next.d;
    if (next.a != null) out.a = next.a;
    for (var i = 0; i < POOL_KEYS.length; i++) {
      k = POOL_KEYS[i];
      if (next[k]) out[k] = next[k];
    }
    if (next.upd) out.upd = next.upd;
    return out;
  }

  function timeKey(m) {
    var t = String((m && m.time) || "");
    var p = t.split(":");
    var hh = parseInt(p[0], 10), mm = parseInt(p[1], 10);
    if (!isFinite(hh)) hh = 0;
    if (!isFinite(mm)) mm = 0;
    return hh * 60 + mm;
  }
  function idKey(m) {
    return String((m && m.id) || "");
  }

  /* ---------- 把实时数据并进 window.APP_DATA ---------- */
  function mergeLive(live) {
    var D = window.APP_DATA;
    if (!D || !D.days) return { added: 0, updated: 0, day: "" };
    var day = live.businessDate;
    if (!day) return { added: 0, updated: 0, day: "" };

    if (!D.days[day]) D.days[day] = { matches: [] };
    if (!Array.isArray(D.days[day].matches)) D.days[day].matches = [];
    var list = D.days[day].matches;

    var byId = {}, i, m, cur, added = 0, updated = 0;
    for (i = 0; i < list.length; i++) {
      m = list[i];
      if (m && m.id) byId[m.id] = m;
    }

    for (i = 0; i < live.matches.length; i++) {
      m = live.matches[i];
      cur = byId[m.id];
      if (!cur) {
        delete m.date;
        list.push(m);
        byId[m.id] = m;
        added++;
        continue;
      }
      /* 已有场次：基础信息与赔率刷新，本地预测 final/preds/result 一律不动 */
      if (m.time) cur.time = m.time;
      if (m.league) cur.league = m.league;
      if (m.home) cur.home = m.home;
      if (m.away) cur.away = m.away;
      if (m.rq != null && m.rq !== "") cur.rq = m.rq;
      if (!cur.result) cur.odds = mergeOdds(cur.odds, m.odds);
      cur.live = true;
      updated++;
    }

    list.sort(function (x, y) {
      var d = timeKey(x) - timeKey(y);
      return d !== 0 ? d : (idKey(x) < idKey(y) ? -1 : idKey(x) > idKey(y) ? 1 : 0);
    });

    /* meta：角标与分享卡片都读这里。
       注意不要覆盖 updatedAt —— 它是「静态底座落盘时间」，角标拿它和实时时间分开显示，
       覆盖了就分不清「赔率刚拉的」和「赛果上次落盘的」。 */
    D.meta = D.meta || {};
    if (!D.meta.updatedAt) D.meta.updatedAt = live.updatedAt;
    D.meta.liveUpdatedAt = live.updatedAt;
    D.meta.liveSource = "webapi.sporttery.cn";
    D.meta.liveFetchedAt = new Date().toISOString();
    D.meta.liveCount = live.matches.length;
    D.meta.liveBusinessDate = day;
    if (live.lastUpdateTime) D.meta.liveLastUpdateTime = live.lastUpdateTime;

    var total = 0, days = 0, keys = Object.keys(D.days);
    for (i = 0; i < keys.length; i++) {
      var ms = D.days[keys[i]].matches || [];
      if (ms.length) { days++; total += ms.length; }
    }
    D.meta.matches = total;
    D.meta.days = days;

    return { added: added, updated: updated, day: day };
  }

  function fetchLive() {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, LIVE_TIMEOUT);
    var opts = { cache: "no-store", mode: "cors", credentials: "omit" };
    if (ctl) opts.signal = ctl.signal;
    return fetch(LIVE_URL, opts).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }, function (e) {
      clearTimeout(timer);
      throw e;
    });
  }

  /* 广播：实时状态变化（成功或失败都发），app.js 监听后重绘角标与表格 */
  function emit() {
    try {
      window.dispatchEvent(new CustomEvent("live-updated", { detail: window.__LIVE || null }));
    } catch (e) { /* 老浏览器没有 CustomEvent 构造器，忽略即可 */ }
  }

  /* 拉一次实时并合并；返回 true=成功。app.js 的「刷新实时赔率」也调这个。 */
  function refreshLive() {
    return fetchLive().then(function (json) {
      var live = parseLive(json);
      var r = mergeLive(live);
      window.__LIVE = {
        ok: true,
        source: "webapi.sporttery.cn",
        fetchedAt: new Date().toISOString(),
        updatedAt: live.updatedAt,
        lastUpdateTime: live.lastUpdateTime,
        businessDate: r.day,
        count: live.matches.length,
        added: r.added,
        updated: r.updated
      };
      emit();
      return true;
    }).catch(function (e) {
      window.__LIVE = {
        ok: false,
        source: "webapi.sporttery.cn",
        fetchedAt: new Date().toISOString(),
        error: String((e && e.message) || e)
      };
      emit();
      return false;
    });
  }

  /* ---------- 顺序加载 ---------- */
  /* ver 为空表示不加版本参数（data.js 自己带时间桶，见 boot()） */
  function loadScript(src, ver) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      var q = ver ? (src.indexOf("?") < 0 ? "?" : "&") + "v=" + ver : "";
      s.src = src + q;
      s.async = false;
      s.onload = function () { resolve(src); };
      s.onerror = function () { reject(new Error("脚本加载失败: " + src)); };
      document.head.appendChild(s);
    });
  }

  /* data.js 每 30 分钟被 Actions 改写，不能钉死版本号，否则 10 分钟 HTTP 缓存期内
     永远拿旧赛果；用 5 分钟时间桶，既能命中缓存又不至于让赛果落后太久。 */
  function dataVer() {
    return "d" + Math.floor(Date.now() / 300000);
  }

  function boot() {
    loadScript("data.js", dataVer()).then(function () {
      /* 实时是增强项：失败也继续，绝不能把页面卡死 */
      return refreshLive().catch(function () { return false; });
    }).then(function () {
      return loadScript("app.js", BUILD);
    }).then(function () {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("./sw.js").catch(function () {});
      }
    }).catch(function (e) {
      /* 底座都加载失败（断网且无缓存）→ 给一句人话，不留白屏 */
      var main = document.querySelector("main") || document.body;
      if (main) {
        var box = document.createElement("div");
        box.style.cssText = "margin:40px auto;max-width:560px;padding:20px;border:1px solid #e5e7eb;border-radius:12px;font:14px/1.7 system-ui;color:#374151";
        box.textContent = "页面资源加载失败：" + ((e && e.message) || e) + "。请检查网络后刷新。";
        main.appendChild(box);
      }
    });
  }

  window.__REFRESH_LIVE = refreshLive;
  window.__RELOAD_LIVE = function () {
    return refreshLive().then(function (ok) {
      if (ok && window.APP_DATA) {
        /* 新日期可能刚进来，重建日期下拉 */
        var sel = document.getElementById("dateSel");
        if (sel && window.APP_DATA.days) {
          var have = {};
          Array.prototype.forEach.call(sel.options, function (o) { have[o.value] = 1; });
          Object.keys(window.APP_DATA.days).sort().reverse().forEach(function (d) {
            if (!have[d] && (window.APP_DATA.days[d].matches || []).length) {
              var o = document.createElement("option");
              o.value = d; o.textContent = d;
              sel.insertBefore(o, sel.firstChild);
            }
          });
          if (window.__LIVE && window.__LIVE.businessDate && window.APP_DATA.days[window.__LIVE.businessDate]) {
            sel.value = window.__LIVE.businessDate;
          }
        }
      }
      return ok;
    });
  };

  boot();
})();
