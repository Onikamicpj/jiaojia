import { QUOTES_FILE } from '../core/paths.js';
import { readJson, writeJson } from '../core/store.js';
import { nowIso, sleep } from '../core/util.js';
import { banzai } from './banzai.js';
import { manual } from './manual.js';

export const sources = [banzai, manual];

export function sourceById(id) {
  return sources.find((s) => s.id === id) ?? null;
}

async function runPool(items, limit, worker) {
  const results = [];
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

/**
 * 抓取所有套件的报价。
 * 只做「读取」——不改基准库，结果写进 data/cache/quotes.json。
 */
export async function collect(kits, { only = null, concurrency = 2, onProgress } = {}) {
  const targets = only ? kits.filter((k) => only.includes(k.id)) : kits;
  const quotes = [];
  const errors = [];
  const prepared = [];

  // 让每个源先做一次性的准备（拉目录、加载 CSV），而不是每款套件都重来
  for (const source of sources) {
    if (typeof source.prepare !== 'function') continue;
    try {
      const info = await source.prepare();
      prepared.push({ source: source.id, ...info });
    } catch (error) {
      errors.push({ kitId: null, source: source.id, message: `prepare 失败：${error.message || error}` });
    }
  }

  await runPool(targets, concurrency, async (kit, index) => {
    for (const source of sources) {
      try {
        const found = await source.search(kit);
        quotes.push(...found);
      } catch (error) {
        errors.push({ kitId: kit.id, source: source.id, message: String(error.message || error) });
      }
    }

    onProgress?.({ index: index + 1, total: targets.length, kit });
    await sleep(250);
  });

  const payload = {
    fetchedAt: nowIso(),
    quoteCount: quotes.length,
    prepared,
    errors,
    quotes
  };

  await writeJson(QUOTES_FILE, payload);
  return payload;
}

export async function loadQuotes() {
  return readJson(QUOTES_FILE, { fetchedAt: null, quoteCount: 0, errors: [], quotes: [] });
}
