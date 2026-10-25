import { convert } from './fx.js';
import { getRates } from './fx.js';
import { matchesKit, parseGrade, gradeOfLine } from './match.js';
import { KITS_FILE } from './paths.js';
import { readJson } from './store.js';
import { round } from './util.js';
import { catalogInfo, fetchLive, isNoisyVersion, searchCatalog } from '../sources/banzai.js';

async function loadKits() {
  const data = await readJson(KITS_FILE, { kits: [] });
  return data?.kits ?? [];
}

/**
 * 把用户输入的中文/型号，翻成数据源认得的检索词。
 *
 * BanzaiHobby 是英文站，直接搜「牛高达」只会返回一堆无关商品。
 * 所以先看输入能不能命中基准库（含胶圈俗称），命中就用它的英文检索词。
 */
function fieldsOf(kit) {
  return [kit.nameZh, kit.nameEn, kit.nameJa, kit.code, ...(kit.aliases ?? []), ...(kit.tags ?? [])]
    .filter(Boolean)
    .map((f) => String(f).toLowerCase());
}

function resolveQuery(raw, kits) {
  const q = raw.trim();
  const lower = q.toLowerCase();

  // 先精确命中，避免「牛」被「海牛」抢走
  let hit = kits.find((k) => fieldsOf(k).some((f) => f === lower));

  if (!hit) {
    hit = kits.find((k) => fieldsOf(k).some((f) => f.includes(lower)));
  }

  // 精确命中某一款且它有官方定价 → 只认这一款的通贩报价
  // 否则搜「牛高达」会连 Hi-ν、透明限定、HG 版一起端上来，几算全乱
  if (hit) {
    if (!hit.msrpJpy) {
      return { query: null, kit: hit, translated: true };
    }
    return { query: hit.query || hit.nameEn, kit: hit, translated: true, strict: true };
  }
  return { query: q, kit: null, translated: false, strict: false };
}

function decorate(quote, kit, fx) {
  const cny = convert(quote.price, quote.currency, 'CNY', fx);
  const msrpCny = kit?.msrpJpy ? convert(kit.msrpJpy, 'JPY', 'CNY', fx) : null;
  const suan = kit?.msrpJpy && cny ? cny / (kit.msrpJpy / 100) : null;
  const ratio = msrpCny && cny ? cny / msrpCny : null;

  return {
    ...quote,
    cny: round(cny, 2),
    suan: round(suan, 2),
    msrpJpy: kit?.msrpJpy ?? null,
    msrpCny: round(msrpCny, 2),
    /** 相对「官价 × 实时汇率」的溢价，负数代表比汇率价还便宜 */
    vsFx: ratio === null ? null : round((ratio - 1) * 100, 1),
    kitName: kit?.nameZh ?? null,
    kitCode: kit?.code ?? null,
    kitLine: kit?.line ?? null,
    sanity: ratio === null ? 'na' : ratio > 2 ? 'high' : ratio < 0.7 ? 'low' : 'ok'
  };
}

/** 同一个词 5 分钟内复用，避免反复打对方接口（搜索一次要 3~6 秒） */
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

/**
 * 实时查询：一次调用，当场去数据源拉，不读任何预存行情。
 */
export async function searchAll(rawQuery) {
  const startedAt = Date.now();
  const kits = await loadKits();
  const resolved = resolveQuery(rawQuery, kits);

  const matchedKit = resolved.kit
    ? {
        id: resolved.kit.id,
        nameZh: resolved.kit.nameZh,
        nameEn: resolved.kit.nameEn,
        brandZh: resolved.kit.brandZh,
        line: resolved.kit.line,
        scale: resolved.kit.scale,
        code: resolved.kit.code,
        msrpJpy: resolved.kit.msrpJpy,
        cloneOf: resolved.kit.cloneOf ?? null
      }
    : null;

  const fxPromise = getRates();

  // KO / 国模没有日本货源，抓也抓不到，直接告诉用户去国内平台看
  if (!resolved.query) {
    const fx = await fxPromise;
    return {
      query: rawQuery.trim(),
      usedQuery: null,
      translated: resolved.translated,
      matchedKit,
      fx: {
        jpyCny: round(convert(1, 'JPY', 'CNY', fx), 4),
        date: fx.date,
        live: fx.live !== false,
        stale: Boolean(fx.stale)
      },
      count: 0,
      elapsedMs: Date.now() - startedAt,
      note: '这款是国模 / KO，日本站没有货源，只能在国内平台查。',
      results: []
    };
  }

  // 1) 在目录里找候选
  let candidates = await searchCatalog(resolved.query, { limit: 80 });

  // 2) 过滤限定版；精确命中某款时，再按等级严格筛一遍
  candidates = candidates.filter((p) => !isNoisyVersion(p.title));
  if (resolved.strict && resolved.kit) {
    candidates = candidates.filter((p) => matchesKit(resolved.kit, p.title));
  }

  // 3) 只对排在前面的候选，逐条实时确认此刻的价格
  const top = candidates.slice(0, 5);
  const live = await Promise.all(top.map((p) => fetchLive(p.handle).catch(() => null)));
  const fx = await fxPromise;

  const results = live
    .filter(Boolean)
    .map((quote) => {
      const kit = kits.find((k) => matchesKit(k, quote.title)) ?? null;
      return decorate(quote, kit, fx);
    })
    .sort((a, b) => (a.cny ?? Infinity) - (b.cny ?? Infinity));

  return {
    query: rawQuery.trim(),
    usedQuery: resolved.query,
    translated: resolved.translated,
    matchedKit,
    fx: {
      jpyCny: round(convert(1, 'JPY', 'CNY', fx), 4),
      date: fx.date,
      live: fx.live !== false,
      stale: Boolean(fx.stale)
    },
    catalog: catalogInfo(),
    candidateCount: candidates.length,
    count: results.length,
    elapsedMs: Date.now() - startedAt,
    results
  };
}

export const QUERY_HELP = {
  grades: ['PG', 'MG', 'RG', 'HG', 'EG'],
  gradeOfLine,
  parseGrade
};
