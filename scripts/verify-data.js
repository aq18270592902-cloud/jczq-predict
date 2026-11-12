#!/usr/bin/env node
/**
 * verify-data.js — data.js 结构校验（CI 与本地都能跑）
 * 退出码 0 = 结构正常，1 = 结构损坏
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data.js');
const src = fs.readFileSync(FILE, 'utf8');

const problems = [];
if (!/window\.APP_DATA\s*=/.test(src)) problems.push('缺少 window.APP_DATA 赋值');
const days = src.match(/"days"\s*:\s*\{/);
if (!days) problems.push('缺少 days 对象');

/* 用 vm 在沙箱里跑一遍，确认是可执行的合法 JS 且能取到数据 */
let data = null;
try {
  const vm = require('vm');
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox, { timeout: 5000 });
  data = sandbox.window.APP_DATA;
} catch (e) {
  problems.push('执行失败：' + e.message);
}

if (data) {
  const dates = Object.keys(data.days || {});
  if (!dates.length) problems.push('days 为空');
  let matches = 0;
  for (const d of dates) matches += (data.days[d].matches || []).length;
  if (!matches) problems.push('没有任何比赛数据');
  console.log('业务日 ' + dates.length + ' 个：' + dates.join(', '));
  console.log('总场次 ' + matches + ' 场');
  /* 注意：sort() 会就地排序，pop() 会删元素；用副本，否则后面统计少算最后一个业务日 */
  const latest = [...dates].sort().pop();
  console.log('最新业务日 ' + latest + '：' + (data.days[latest].matches || []).length + ' 场');

  /* 赔率完整度：玩法赔率（让球/总进球/半全场/比分）被抹掉是历史事故，必须守住 */
  let withOdds = 0, withRq = 0, withSc = 0;
  for (const d of dates) for (const m of data.days[d].matches || []) {
    if (m.odds) withOdds++;
    if (m.odds && m.odds.rq) withRq++;
    if (m.odds && m.odds.sc) withSc++;
  }
  console.log('有赔率 ' + withOdds + ' 场 / 有让球玩法 ' + withRq + ' 场 / 有比分玩法 ' + withSc + ' 场');
  if (withOdds && withRq === 0) problems.push('全部场次丢失让球玩法赔率（mergeOdds 被整体覆盖了）');

  const meta = data.meta || {};
  if (meta.updatedAt) console.log('数据更新时间 ' + meta.updatedAt);
}

console.log('data.js 字节数 ' + Buffer.byteLength(src));
if (problems.length) {
  console.error('❌ 结构异常：');
  for (const p of problems) console.error('   - ' + p);
  process.exit(1);
}
console.log('✅ 结构正常');
