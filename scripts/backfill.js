#!/usr/bin/env node
/* =========================================================
 * backfill.js — 批量回填历史业务日（补 data.js 里的日期空洞）
 *
 * 背景：fetch_official.js 只抓澳客「在售页 + 赛果大厅」，场次滚出页面后不再回溯，
 *       于是 9 月底到 11 月初之间留下整月空洞。500 彩票网按日期保留了历史赛程赛果，
 *       这里按天循环调用 fetch_official.js <YYYY-MM-DD> 把洞补上。
 *
 * 用法：
 *   node scripts/backfill.js                   回填「最近一次成功刷新日往前 N 天」的缺口
 *   node scripts/backfill.js 2026-09-30 2026-11-10   指定区间（含端点）
 *   node scripts/backfill.js --missing         只补 data.js 里完全缺失的业务日
 *   SKIP_HALF=1 node scripts/backfill.js       跳过半场比分（detail.php 有反爬，批量时更快）
 *
 * 说明：
 *   - 每天一次请求（trade.500.com/jczq/index.php?date=），失败不中断，最后汇总。
 *   - 已存在且有赛果的业务日默认跳过，避免重复抓取；--force 强制重抓。
 * ======================================================= */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data.js');
const FETCH = path.join(ROOT, 'fetch_official.js');

function loadData() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(DATA_FILE, 'utf8'), sandbox, { timeout: 20000 });
  return sandbox.window.APP_DATA;
}

function isoDay(d) { return d.toISOString().slice(0, 10); }
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const missingOnly = args.includes('--missing');
const dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

let list = [];
if (dates.length >= 2) {
  let cur = dates[0], end = dates[1];
  while (cur <= end) { list.push(cur); cur = addDays(cur, 1); }
} else {
  /* 默认：从「最早已记录的业务日」到「今天」之间所有缺口 */
  const D = loadData();
  const have = Object.keys(D.days || {}).sort();
  if (!have.length) { console.error('data.js 里没有任何业务日，无法推断区间'); process.exit(2); }
  const start = have[0], today = isoDay(new Date());
  let cur = start;
  while (cur <= today) {
    const day = D.days[cur];
    const n = day ? (day.matches || []).length : 0;
    const scored = day ? (day.matches || []).filter((m) => m.result && m.result.score).length : 0;
    const complete = n > 0 && scored > 0;
    if (!complete || force) list.push(cur);
    cur = addDays(cur, 1);
  }
  if (missingOnly) list = list.filter((d) => !D.days[d]);
}

if (!list.length) { console.log('没有需要回填的日期'); process.exit(0); }
console.log('待回填 ' + list.length + ' 天：' + list[0] + ' → ' + list[list.length - 1]);

const env = Object.assign({}, process.env);
if (!env.SKIP_HALF) env.SKIP_HALF = '1';   /* 批量默认跳过半场，避开 detail.php 反爬 */

let okN = 0, failN = 0, addN = 0;
for (const d of list) {
  try {
    const out = execFileSync(process.execPath, [FETCH, d], {
      cwd: ROOT, env, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe']
    });
    const m = out.match(/新增 (\d+) 场/);
    const add = m ? +m[1] : 0;
    addN += add;
    okN++;
    console.log('[ok] ' + d + ' 新增 ' + add + ' 场');
  } catch (e) {
    failN++;
    const msg = (e.stderr || e.message || '').toString().split('\n').slice(-2).join(' ');
    console.log('[!!] ' + d + ' 失败：' + msg.slice(0, 160));
  }
  /* 对端限速：每天之间停 300ms，避免被 500 站判成爬虫 */
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
}

const D2 = loadData();
const days = Object.keys(D2.days || {}).sort();
const total = Object.values(D2.days || {}).reduce((n, x) => n + (x.matches || []).length, 0);
const scored = Object.values(D2.days || {}).reduce((n, x) => n + (x.matches || []).filter((m) => m.result && m.result.score).length, 0);
console.log('\n回填完成：成功 ' + okN + ' 天 / 失败 ' + failN + ' 天 / 共新增 ' + addN + ' 场');
console.log('当前 data.js：' + days.length + ' 个业务日（' + days[0] + ' → ' + days[days.length - 1] + '），' + total + ' 场，' + scored + ' 场有赛果');
process.exit(failN > 0 && okN === 0 ? 1 : 0);
