#!/usr/bin/env node
/**
 * 补商品主图。
 *
 * 官网图片是带哈希的随机名（153_6270_s_qtf3ojj...），没法从商品编号推出来，
 * 只能回每个商品页去捞。所以单独跑一次，把 img 字段补进 bandai-official.json。
 *
 * 用法：
 *   node scripts/scrape-images.mjs            # 补所有缺图的
 *   node scripts/scrape-images.mjs --limit=50 # 试跑
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = resolve(ROOT, 'data/bandai-official.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

dns.setServers(['223.5.5.5', '119.29.29.29', '8.8.8.8']);

const args = process.argv.slice(2);
const limit = Number((args.find((a) => a.startsWith('--limit=')) ?? '').split('=')[1]) || 0;
const concurrency = Number((args.find((a) => a.startsWith('--concurrency=')) ?? '').split('=')[1]) || 40;

/** 商品页里有好几张图，`_o_` 是大图，`_s_` 是小图，优先大图 */
function pickImage(html) {
  const all = [...html.matchAll(/https:\/\/bandai-hobby\.net\/images\/(\d+_\d+)_([a-z])_([a-z0-9]+)\.(jpg|jpeg|png|webp)/g)];
  if (all.length === 0) return null;

  const big = all.find((m) => m[2] === 'o');
  const chosen = big ?? all[0];
  return `https://bandai-hobby.net/images/${chosen[1]}_${chosen[2]}_${chosen[3]}.${chosen[4]}`;
}

async function fetchHtml(url, retries = 2) {
  for (let i = 0; i <= retries; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, 'accept-language': 'ja,en;q=0.8' },
        signal: AbortSignal.timeout(25000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === retries) throw e;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  return null;
}

const store = JSON.parse(await readFile(FILE, 'utf8'));
let todo = store.items.filter((it) => !it.img && it.url);
if (limit) todo = todo.slice(0, limit);
console.log(`待补图 ${todo.length} / ${store.items.length} 条，并发 ${concurrency}`);

let cursor = 0;
let ok = 0;
let fail = 0;
let saving = false;
const t0 = Date.now();

async function flush() {
  if (saving) return;
  saving = true;
  try {
    await writeFile(FILE, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  } finally {
    saving = false;
  }
}

async function worker() {
  while (cursor < todo.length) {
    const idx = cursor;
    cursor += 1;
    const item = todo[idx];

    try {
      const html = await fetchHtml(item.url);
      const img = html ? pickImage(html) : null;
      if (img) {
        item.img = img;
        ok += 1;
      } else {
        fail += 1;
      }
    } catch {
      fail += 1;
    }

    const done = ok + fail;
    if (done % 100 === 0) {
      const el = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`  ${done}/${todo.length}  成功 ${ok}  失败 ${fail}  ${el}s`);
      await flush();
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
await flush();

console.log(`\n完成：补图 ${ok} 条，失败 ${fail} 条，耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
