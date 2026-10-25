import { convert, getRates } from './fx.js';
import { matchesKit, parseGrade, gradeOfLine } from './match.js';
import { KITS_FILE } from './paths.js';
import { readJson } from './store.js';
import { round } from './util.js';
import { catalogInfo, fetchLive, isNoisyVersion, searchCatalog } from '../sources/banzai.js';

async function loadKits() {
  const data = await readJson(KITS_FILE, { kits: [] });
  return data?.kits ?? [];
}

function fieldsOf(kit) {
  return [kit.nameZh, kit.nameEn, kit.nameJa, kit.code, ...(kit.aliases ?? []), ...(kit.tags ?? [])]
    .filter(Boolean)
    .map((f) => String(f).toLowerCase());
}

/**
 * 从商品标题里解析规格 —— 等级、比例、机体编号。
 * 很多商品不在基准库里，但标题一定写着 RG / 1/144 / RX-93，
 * 这些是买家分辨「我到底在看哪一款」的关键，不能只靠名字。
 */
const CODE_RE = /\b(RX|MSN|MS|RGM|RMS|AMX|AMS|ZGMF|GAT|GN|XXXG|GF|XVX|MBF|OZ|PMX|XM|F91)[- ]?\d{1,3}[A-Za-z0-9/-]*/i;

function extractSpec(title) {
  const text = String(title ?? '');
  const grade = parseGrade(text);
  const scale = (text.match(/\b1\/(?:144|100|60|48|35)\b/) ?? [null])[0];
  const codeRaw = text.match(CODE_RE);
  const code = codeRaw ? codeRaw[0].replace(/\s+/g, '-').toUpperCase() : null;
  return { grade, scale, code };
}

const GRADE_ORDER = { HG: 0, RG: 1, MG: 2, PG: 3, EG: -1, FG: -1, SD: -2 };

/**
 * 一次查询可能对应多个规格：搜「牛高达」应该把 HG / RG / MG 一起端上来，
 * 而不是因为命中基准库里的 RG 就只查 RG。
 */
function resolveTargets(raw, kits) {
  const q = raw.trim();
  const lower = q.toLowerCase();

  let hit = kits.find((k) => fieldsOf(k).some((f) => f === lower));
  if (!hit) hit = kits.find((k) => fieldsOf(k).some((f) => f.includes(lower)));

  if (!hit) return [{ query: q, kit: null, strict: false }];
  if (!hit.msrpJpy) return [{ query: null, kit: hit, strict: true }];

  const group = hit.family ? kits.filter((k) => k.family === hit.family) : [hit];
  const targets = group
    .filter((k) => k.msrpJpy && (k.query || k.nameEn))
    .map((k) => ({ query: k.query || k.nameEn, kit: k, strict: true }));

  return targets.length > 0 ? targets : [{ query: hit.query || hit.nameEn, kit: hit, strict: true }];
}

function decorate(quote, kit, fx) {
  const cny = convert(quote.price, quote.currency, 'CNY', fx);
  const msrpCny = kit?.msrpJpy ? convert(kit.msrpJpy, 'JPY', 'CNY', fx) : null;
  const suan = kit?.msrpJpy && cny ? cny / (kit.msrpJpy / 100) : null;
  const ratio = msrpCny && cny ? cny / msrpCny : null;
  const parsed = extractSpec(quote.title);

  return {
    ...quote,
    kitId: kit?.id ?? null,
    cny: round(cny, 2),
    suan: round(suan, 2),
    msrpJpy: kit?.msrpJpy ?? null,
    msrpCny: round(msrpCny, 2),
    vsFx: ratio === null ? null : round((ratio - 1) * 100, 1),
    kitName: kit?.nameZh ?? null,
    spec: {
      grade: kit?.line ? gradeOfLine(kit.line) : parsed.grade,
      scale: kit?.scale ?? parsed.scale,
      code: kit?.code ?? parsed.code,
      /** db = 基准库（准），title = 从商品标题解析（可能缺） */
      from: kit ? 'db' : 'title'
    },
    sanity: ratio === null ? 'na' : ratio > 2 ? 'high' : ratio < 0.7 ? 'low' : 'ok'
  };
}

function fxView(fx) {
  return {
    jpyCny: round(convert(1, 'JPY', 'CNY', fx), 4),
    date: fx.date,
    live: fx.live !== false,
    stale: Boolean(fx.stale)
  };
}

/**
 * 实时查询：一次调用，当场去数据源拉，不读任何预存行情。
 * 命中机体家族时，会把该家族下所有规格并发查一遍。
 */
export async function searchAll(rawQuery) {
  const startedAt = Date.now();
  const kits = await loadKits();
  const targets = resolveTargets(rawQuery, kits);
  const fxPromise = getRates();

  const familyKit = targets[0]?.kit ?? null;
  const matchedKit = familyKit
    ? {
        family: familyKit.family ?? null,
        familyZh: familyKit.familyZh ?? familyKit.nameZh,
        brandZh: familyKit.brandZh,
        specs: targets
          .filter((t) => t.kit)
          .map((t) => ({
            id: t.kit.id,
            nameZh: t.kit.nameZh,
            line: t.kit.line,
            scale: t.kit.scale,
            code: t.kit.code,
            msrpJpy: t.kit.msrpJpy
          }))
      }
    : null;

  // KO / 国模：日本站没有货源
  if (targets.every((t) => !t.query)) {
    const fx = await fxPromise;
    return {
      query: rawQuery.trim(),
      usedQuery: null,
      matchedKit,
      fx: fxView(fx),
      count: 0,
      candidateCount: 0,
      elapsedMs: Date.now() - startedAt,
      note: '这款是国模 / KO，日本站没有货源，只能在国内平台查。',
      results: []
    };
  }

  // 每个规格并发查：目录找候选 → 过滤 → 取前两条实时确认
  let candidateTotal = 0;
  const perTarget = await Promise.all(
    targets.map(async (t) => {
      if (!t.query) return [];
      try {
        let cands = await searchCatalog(t.query, { limit: 40 });
        cands = cands.filter((p) => !isNoisyVersion(p.title));
        if (t.strict && t.kit) cands = cands.filter((p) => matchesKit(t.kit, p.title));
        candidateTotal += cands.length;

        const top = cands.slice(0, 2);
        const live = await Promise.all(top.map((p) => fetchLive(p.handle).catch(() => null)));
        return live.filter(Boolean);
      } catch {
        return [];
      }
    })
  );

  const fx = await fxPromise;
  const seen = new Set();

  const results = perTarget
    .flat()
    .filter((q) => {
      if (!q.url || seen.has(q.url)) return false;
      seen.add(q.url);
      return true;
    })
    .map((q) => decorate(q, kits.find((k) => matchesKit(k, q.title)) ?? null, fx))
    .sort((a, b) => {
      const ga = GRADE_ORDER[a.spec.grade] ?? 9;
      const gb = GRADE_ORDER[b.spec.grade] ?? 9;
      if (ga !== gb) return ga - gb;
      return (a.cny ?? Infinity) - (b.cny ?? Infinity);
    });

  return {
    query: rawQuery.trim(),
    usedQuery: targets.filter((t) => t.query).map((t) => t.query).join(' | '),
    matchedKit,
    fx: fxView(fx),
    catalog: catalogInfo(),
    candidateCount: candidateTotal,
    specCount: targets.length,
    count: results.length,
    elapsedMs: Date.now() - startedAt,
    results
  };
}

export const QUERY_HELP = { grades: ['PG', 'MG', 'RG', 'HG', 'EG'], gradeOfLine, parseGrade };
