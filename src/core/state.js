import { buildKitView } from './calc.js';
import { getRates, rateBetween } from './fx.js';
import { KITS_FILE } from './paths.js';
import { readJson } from './store.js';
import { nowIso, round } from './util.js';
import { loadQuotes } from '../sources/index.js';

export async function loadKits() {
  const data = await readJson(KITS_FILE, { kits: [] });
  return data?.kits ?? [];
}

export async function buildState() {
  const [kits, quoteStore, fx] = await Promise.all([loadKits(), loadQuotes(), getRates()]);

  const kitIndex = new Map(kits.map((k) => [k.id, k]));
  const byKit = new Map();
  for (const quote of quoteStore.quotes ?? []) {
    if (!byKit.has(quote.kitId)) byKit.set(quote.kitId, []);
    byKit.get(quote.kitId).push(quote);
  }

  const views = kits.map((kit) => {
    const quotes = byKit.get(kit.id) ?? [];
    const view = buildKitView(kit, quotes, fx, kitIndex);
    return {
      ...view,
      cheapNote: view.cheapest?.note ?? null
    };
  });

  // 品牌排序：万代 → KO → 国模 → 其他
  const order = { bandai: 0, daban: 1, dragonmomoko: 1, motornuclear: 2, infinitenova: 2, jianghunji: 2 };
  views.sort((a, b) => {
    const ba = order[a.kit.brand] ?? 9;
    const bb = order[b.kit.brand] ?? 9;
    if (ba !== bb) return ba - bb;
    return (a.kit.nameZh || '').localeCompare(b.kit.nameZh || '', 'zh');
  });

  const brands = [...new Map(views.map((v) => [v.kit.brand, v.kit.brandZh])).entries()].map(
    ([id, zh]) => ({ id, zh })
  );

  return {
    meta: {
      generatedAt: nowIso(),
      quotesFetchedAt: quoteStore.fetchedAt ?? null,
      quoteCount: quoteStore.quotes?.length ?? 0,
      errors: quoteStore.errors ?? [],
      kitCount: views.length
    },
    fx: {
      date: fx.date,
      fetchedAt: fx.fetchedAt,
      live: fx.live !== false,
      stale: Boolean(fx.stale),
      cached: Boolean(fx.cached),
      error: fx.error ?? null,
      jpyCny: round(rateBetween('JPY', 'CNY', fx), 4),
      usdCny: round(rateBetween('USD', 'CNY', fx), 4)
    },
    brands,
    kits: views
  };
}
