#!/usr/bin/env node
/**
 * 收录万代官网官方定价。
 *
 * 官网 sitemap 里有 5000+ 商品页，每页都写着「価格 X,XXX 円(税10%込)」和发卖日。
 * 这是唯一权威的「原价」来源 —— 零售价会浮动，官方定价是判断几算的基准。
 *
 * 用法：
 *   node scripts/scrape-bandai.mjs --limit=30        试跑
 *   node scripts/scrape-bandai.mjs                   全量（约 10 分钟）
 *   node scripts/scrape-bandai.mjs --resume          跳过已收录的
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/bandai-official.json');
const SITEMAP = 'https://bandai-hobby.net/sitemap/jp/hobby-jp-dynamic-1.xml';
const BASE = 'https://bandai-hobby.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 本机默认 DNS 有时会挂（Server failed），显式指定公共 DNS
dns.setServers(['223.5.5.5', '119.29.29.29', '8.8.8.8']);

const args = process.argv.slice(2);
const limit = Number((args.find((a) => a.startsWith('--limit=')) ?? '').split('=')[1]) || 0;
const concurrency = Number((args.find((a) => a.startsWith('--concurrency=')) ?? '').split('=')[1]) || 6;
const resume = args.includes('--resume');
const onlyGunpla = !args.includes('--all');

const GRADE_RE = /\b(PG|MG|RG|HGUC|HGCE|HGBF|HGBD|HGW|HG|EG|FG|SD|SDW|SDCS|BB)\b/i;

/** 水贴、支架、武器包这些也挂在 HG 分类下，但不是模型本体，收录进来会污染比价 */
const ACCESSORY_RE = /デカール|シール|マーキング|スタンド|台座|ディスプレイ|オプションパーツ|ウェポン|エフェクト|ウェポンズ|拡張パーツ|コンバージョン/;

function textOf(html, re) {
  const m = html.match(re);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

/** 全角字母数字 → 半角，官网标题常常是全角 */
function normalize(str) {
  if (!str) return str;
  return str
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .trim();
}

function parseItem(html, url) {
  const title = normalize(textOf(html, /<title>([^<]*)<\/title>/));
  if (!title) return null;

  const name = title.split('｜')[0].trim();

  const priceRaw = textOf(html, /価格<\/span><\/dt>\s*<dd[^>]*>([\d,]+)\s*円/);
  const price = priceRaw ? Number(priceRaw.replace(/,/g, '')) : null;

  const releasedRaw = textOf(html, /発売日<\/span><\/dt>\s*<dd[^>]*>([^<]*)<\/dd>/);
  const released = releasedRaw ? releasedRaw.trim() : null;

  const age = textOf(html, /対象年齢<\/span><\/dt>\s*<dd[^>]*>([^<]*)<\/dd>/);

  const gradeMatch = name.match(GRADE_RE);
  const grade = gradeMatch ? gradeMatch[1].toUpperCase().replace(/^HG(UC|CE|BF|BD|W)$/, 'HG') : null;

  const scaleMatch = name.match(/(1\/\d+)/);
  const codeMatch = name.match(/\b([A-Z]{2,5}-\d{1,3}[A-Z0-9/-]*)/);

  return {
    id: url.split('/item/')[1]?.replace('/', ''),
    url,
    name,
    price,
    released,
    age,
    grade,
    scale: scaleMatch ? scaleMatch[1] : null,
    code: codeMatch ? codeMatch[1] : null
  };
}

async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, 'accept-language': 'ja,en;q=0.8' },
        signal: AbortSignal.timeout(25000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      if (i === retries) throw error;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  return null;
}

async function main() {
  console.log('拉取 sitemap…');
  const xml = await fetchWithRetry(SITEMAP);
  const urls = [...xml.matchAll(/<loc>([^<]*\/item\/[^<]*)<\/loc>/g)].map((m) => m[1]);
  console.log(`商品页 ${urls.length} 个`);

  let existing = { items: [], fetchedAt: null };
  if (resume && existsSync(OUT)) {
    existing = JSON.parse(await readFile(OUT, 'utf8'));
    console.log(`已有 ${existing.items.length} 条，跳过`);
  }
  const done = new Set(existing.items.map((i) => i.url));

  let todo = urls.filter((u) => !done.has(u));
  if (limit) todo = todo.slice(0, limit);
  console.log(`本次抓取 ${todo.length} 个，并发 ${concurrency}`);

  const items = [...existing.items];
let cursor = 0;
let ok = 0;
let fail = 0;
let saving = false;
const t0 = Date.now();

/** 边抓边存 —— 跑一小时的活儿，中途断了不能全丢 */
async function flush() {
  if (saving) return;
  saving = true;
  try {
    items.sort((a, b) => (b.released ?? '').localeCompare(a.released ?? ''));
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(
      OUT,
      `${JSON.stringify({ fetchedAt: new Date().toISOString(), count: items.length, items }, null, 2)}\n`,
      'utf8'
    );
  } finally {
    saving = false;
  }
}

async function worker() {
  while (cursor < todo.length) {
    const idx = cursor;
    cursor += 1;
    const url = todo[idx];
    try {
      const html = await fetchWithRetry(url);
      const item = parseItem(html, url);
      if (item && item.price && !ACCESSORY_RE.test(item.name)) {
        if (!onlyGunpla || item.grade || /ガンプラ|ガンダム/i.test(item.name)) {
          items.push(item);
          ok += 1;
        }
      }
    } catch {
      fail += 1;
    }

    const doneCount = ok + fail;
    if (doneCount % 100 === 0) {
      const el = ((Date.now() - t0) / 1000).toFixed(0);
      const rate = (doneCount / Math.max(1, el)).toFixed(1);
      console.log(`  ${doneCount}/${todo.length}  收录 ${ok}  失败 ${fail}  ${el}s  ${rate}/s`);
      await flush();
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
await flush();

console.log(`\n完成：收录 ${items.length} 条（本次 +${ok}，失败 ${fail}）`);
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s → ${OUT}`);
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
