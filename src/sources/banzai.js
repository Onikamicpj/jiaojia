import { readJson, writeJson } from '../core/store.js';
import { matchesKit } from '../core/match.js';
import { CACHE_DIR } from '../core/paths.js';
import { resolve } from 'node:path';
import { fetchJson, nowIso, sleep } from '../core/util.js';

const BASE = 'https://banzaihobby.com';
const COLLECTION = 'bandai-gunpla';
const CATALOG_FILE = resolve(CACHE_DIR, 'banzai-catalog.json');
const PAGE_LIMIT = 250;
const MAX_PAGES = 12;
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * 版本噪音过滤。
 *
 * 比价站最致命的错误不是「没抓到」，而是「抓错了还当真」。
 * 同一款机体有通贩版、透明版、电镀版、会场限定、Gundam Base 限定、
 * 一番赏、7-11 联名……标题都长得差不多，价格却差 3~10 倍。
 * 混在一起算最低价，「几算」会直接失去意义。
 *
 * 所以这里硬性排除特殊版本，只留通贩 / 常规流通品。
 */
const VERSION_NOISE = [
  /limited/i,
  /gundam base/i,
  /side[\s-]?f\b/i,
  /clear color/i,
  /titanium/i,
  /metallic/i,
  /coating/i,
  /hyper mode/i,
  /ver\.?\s*twc/i,
  /\bprize\b/i,
  /exclusive/i,
  /special (edition|ver)/i,
  /rollout/i,
  /recirculation/i,
  /grand slam/i,
  /perfect satisfaction/i,
  /7-eleven/i,
  /ichiban/i,
  /beyond global/i,
  /\brouge\b/i,
  /theater/i,
  /memorial/i,
  /anniversary/i,
  /gold-in/i,
  /plating/i,
  /mechanical clear/i,
  /swallows/i,
  /trans-am/i,
  /限定/,
  /会場/,
  /抽選/,
  /受注/,
  /機動戦士ガンダム展/
];

function isNoisyVersion(title) {
  return VERSION_NOISE.some((re) => re.test(title));
}

export { isNoisyVersion };

function cleanUrl(raw) {
  if (!raw) return null;
  const path = String(raw).split('?')[0];
  return path.startsWith('http') ? path : `${BASE}${path}`;
}

/**
 * 拉取整个 Bandai Gunpla 目录（约 2500 个 SKU）。
 *
 * 为什么不逐款调用搜索接口？
 * 搜索接口一次只返回 10 条，20 款套件就是 20 次请求，命中率还低。
 * 整目录 2500 条只需 10 次请求，本地匹配没有召回损耗。
 */
let catalogCache = null;
let catalogFetchedAt = null;

export function catalogInfo() {
  return { count: catalogCache?.length ?? 0, fetchedAt: catalogFetchedAt };
}

export async function loadCatalog({ force = false } = {}) {
  const cached = await readJson(CATALOG_FILE, null);
  const age = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;

  if (cached && !force && age < CATALOG_TTL_MS) {
    catalogCache = cached.products;
    catalogFetchedAt = cached.fetchedAt;
    return { products: cached.products, fetchedAt: cached.fetchedAt, cached: true };
  }

  const products = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${BASE}/collections/${COLLECTION}/products.json?limit=${PAGE_LIMIT}&page=${page}`;
    const data = await fetchJson(url, { timeout: 30000, retries: 1 });
    const batch = data?.products ?? [];
    if (batch.length === 0) break;
    products.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
    await sleep(300);
  }

  const payload = { fetchedAt: nowIso(), count: products.length, products };
  await writeJson(CATALOG_FILE, payload);
  catalogCache = products;
  catalogFetchedAt = payload.fetchedAt;

  return { products, fetchedAt: payload.fetchedAt, cached: false };
}

/**
 * 关键词检索：在已缓存的目录里本地过滤。
 * 它的搜索接口（suggest）质量极差 —— 搜「RG Nu Gundam」会返回超合金、铁奥。
 * 所以改成自己维护目录 + 本地精确匹配。
 */
export async function searchCatalog(keyword, { limit = 60 } = {}) {
  const products = catalogCache ?? (await loadCatalog()).products;
  const tokens = String(keyword)
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t && !/^\d+\/\d+$/.test(t)); // 标题常不写比例，比例交给等级校验

  if (tokens.length === 0) return [];

  return products
    .filter((p) => {
      const title = p.title.toLowerCase();
      return tokens.every((tok) => title.includes(tok));
    })
    .slice(0, limit);
}

/**
 * 单品实时价格：调 Shopify 单品 JSON，拿「此刻」的价格和库存。
 * 目录是隔几小时刷的，但价格必须当场确认，这才叫实时查询。
 */
export async function fetchLive(handle) {
  if (!handle) return null;
  const data = await fetchJson(`${BASE}/products/${handle}.json`, { timeout: 15000, retries: 0 });
  const product = data?.product;
  if (!product) return null;

  const variant = Array.isArray(product.variants) ? product.variants[0] : null;
  const price = Number(variant?.price ?? product.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  const tags = Array.isArray(product.tags) ? product.tags : [];
  const used = tags.some((t) => /preloved|used|中古/i.test(t));

  return {
    kitId: null,
    source: 'banzai',
    sourceName: 'BanzaiHobby',
    region: 'JP',
    title: product.title,
    price,
    currency: 'JPY',
    available: variant?.available ?? true,
    condition: used ? 'used' : 'new',
    url: `${BASE}/products/${handle}`,
    image: product.image?.src ?? product.images?.[0]?.src ?? null,
    note: used ? '中古（Preloved）' : null,
    liveAt: product.updated_at ?? nowIso()
  };
}

function toQuote(product, kit) {
  const variant = Array.isArray(product.variants) ? product.variants[0] : null;
  const price = Number(product.price ?? variant?.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  const tags = Array.isArray(product.tags) ? product.tags : [];
  const used = tags.some((t) => /preloved|used|中古/i.test(t));
  const available = product.available ?? variant?.available ?? true;

  return {
    kitId: kit?.id ?? null,
    source: 'banzai',
    sourceName: 'BanzaiHobby',
    region: 'JP',
    title: product.title,
    price,
    currency: 'JPY',
    available,
    condition: used ? 'used' : 'new',
    url: cleanUrl(product.handle ? `/products/${product.handle}` : product.url),
    image: product.featured_image?.url ?? product.images?.[0]?.src ?? null,
    note: used ? '中古（Preloved）' : null,
    fetchedAt: nowIso()
  };
}

/**
 * 按关键词实时搜索。这是「查询」的主路径 —— 不需要预先抓任何东西。
 * BanzaiHobby 的 suggest 接口会直接返回商品标题、价格、库存、链接。
 */
export const banzai = {
  id: 'banzai',
  name: 'BanzaiHobby',
  region: 'JP',
  currency: 'JPY',
  homepage: BASE,
  note: '日本零售 / 中古，走 Shopify 公开 collection JSON，不需要 key',

  async prepare() {
    const { products, cached } = await loadCatalog();
    return { count: products.length, cached };
  },

  async search(kit) {
    if (!kit.matchAll?.length) return [];
    const products = catalogCache ?? (await loadCatalog()).products;

    const quotes = products
      .filter((p) => matchesKit(kit, p.title))
      .filter((p) => !isNoisyVersion(p.title))
      .map((p) => toQuote(p, kit))
      .filter(Boolean);

    const best = new Map();
    for (const q of quotes) {
      const key = `${q.title}::${q.condition}`;
      const prev = best.get(key);
      if (!prev || q.price < prev.price) best.set(key, q);
    }

    return [...best.values()].sort((a, b) => a.price - b.price).slice(0, 5);
  }
};
