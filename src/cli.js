#!/usr/bin/env node
import { access } from 'node:fs/promises';
import { getRates, rateBetween } from './core/fx.js';
import { MANUAL_CSV, QUOTES_FILE } from './core/paths.js';
import { round } from './core/util.js';
import { loadKits } from './core/state.js';
import { startServer } from './server.js';
import { collect } from './sources/index.js';
import { manual } from './sources/manual.js';

const [, , command = 'serve', ...args] = process.argv;

function flag(name, fallback = null) {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const [, value] = hit.split('=');
  return value ?? true;
}

async function cmdServe() {
  const port = Number(flag('port', 5173));

  let hasCache = true;
  try {
    await access(QUOTES_FILE);
  } catch {
    hasCache = false;
  }
  if (!hasCache) {
    console.log('  还没有报价缓存，页面会只有基准库、价格全空。');
    console.log('  先跑一次：node src/cli.js collect\n');
  }

  startServer({ port });
}

async function cmdCollect() {
  const kits = await loadKits();
  const only = flag('kit');
  const targets = only ? String(only).split(',') : null;

  console.log(`开始抓取，共 ${targets ? targets.length : kits.length} 款套件…`);
  const result = await collect(kits, {
    only: targets,
    onProgress: ({ index, total, kit }) => {
      process.stdout.write(`\r  [${index}/${total}] ${kit.nameZh}            `);
    }
  });
  process.stdout.write('\n');

  console.log(`拿到 ${result.quoteCount} 条报价`);
  if (result.errors.length) {
    console.log(`\n有 ${result.errors.length} 个源失败：`);
    for (const e of result.errors.slice(0, 10)) {
      console.log(`  - ${e.kitId} / ${e.source}: ${e.message}`);
    }
  }
  console.log('\n结果已写入 data/cache/quotes.json');
}

async function cmdFx() {
  const fx = await getRates({ force: Boolean(flag('force')) });
  console.log(`基准 ${fx.base}，数据日期 ${fx.date ?? '—'}，抓取于 ${fx.fetchedAt}`);
  console.log(`  1 JPY   = ${round(rateBetween('JPY', 'CNY', fx), 4)} CNY  （100 円 ≈ ${round(rateBetween('JPY', 'CNY', fx) * 100, 2)} 元）`);
  console.log(`  1 USD   = ${round(rateBetween('USD', 'CNY', fx), 4)} CNY`);
  if (fx.stale) console.log('  ⚠ 汇率来自兜底/缓存，非实时');
}

async function cmdCheck() {
  const kits = await loadKits();
  const problems = [];
  const ids = new Set();

  for (const kit of kits) {
    if (!kit.id) problems.push('存在缺少 id 的套件');
    if (ids.has(kit.id)) problems.push(`重复 id：${kit.id}`);
    ids.add(kit.id);
    if (!kit.nameZh) problems.push(`${kit.id} 缺少中文名`);
    if (!kit.brand) problems.push(`${kit.id} 缺少品牌`);
    if (kit.cloneOf && !kits.some((k) => k.id === kit.cloneOf)) {
      problems.push(`${kit.id} 的 cloneOf 指向不存在的 ${kit.cloneOf}`);
    }
    if (kit.brand === 'bandai' && !kit.msrpJpy) {
      problems.push(`${kit.id} 是万代却没有官方定价`);
    }
  }

  const rows = await manual.listAll();
  for (const row of rows) {
    if (!ids.has(row.kitId)) problems.push(`quotes.manual.csv 里的 kitId 不存在：${row.kitId}`);
  }

  console.log(`套件 ${kits.length} 款，人工报价 ${rows.length} 条，CSV: ${MANUAL_CSV}`);
  if (problems.length === 0) {
    console.log('✓ 基准库自检通过');
  } else {
    console.log(`✗ 发现 ${problems.length} 个问题：`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  }
}

const commands = { serve: cmdServe, collect: cmdCollect, fx: cmdFx, check: cmdCheck };

if (!commands[command]) {
  console.log(`用法：node src/cli.js <${Object.keys(commands).join('|')}> [选项]

  serve    --port=5173        启动网页
  collect  --kit=id1,id2      抓取报价（默认全部）
  fx       --force            查看当前汇率
  check                       校验基准库与 CSV`);
  process.exit(0);
}

await commands[command]();
