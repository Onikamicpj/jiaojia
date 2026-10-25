import { convert } from './fx.js';
import { getRates } from './fx.js';
import { HISTORY_FILE, KITS_FILE } from './paths.js';
import { readJson, writeJson } from './store.js';
import { nowIso, round } from './util.js';

const MAX_HISTORY = 40;

function gradeOf(suan) {
  if (suan === null || suan === undefined) return null;
  if (suan <= 4.5) return { key: 'good', zh: '好价', verdict: '低于 4.5 算，可以下手。' };
  if (suan <= 5.5) return { key: 'normal', zh: '正常', verdict: '正常区间，不着急可以再等等。' };
  if (suan <= 6.5) return { key: 'high', zh: '偏高', verdict: '偏高了，不是急用建议再等。' };
  return { key: 'bad', zh: '很贵', verdict: '明显贵了，除非绝版或急用，否则别买。' };
}

async function loadHistory() {
  return readJson(HISTORY_FILE, {});
}

/**
 * 核价：你报一个看到的价格，算出它是几算、比官价贵多少、跟历史比是涨是跌。
 *
 * 「几算」= 人民币价 ÷ (日元官价 ÷ 100)。
 * 官价 4500 円的 RG 卖 210 元，就是 4.7 算。
 */
export async function appraise({ kitId, price, currency = 'CNY' }) {
  const kitStore = await readJson(KITS_FILE, { kits: [] });
  const kit = (kitStore.kits ?? []).find((k) => k.id === kitId);
  if (!kit) throw new Error(`没有这个套件：${kitId}`);

  const seenPrice = Number(price);
  if (!Number.isFinite(seenPrice) || seenPrice <= 0) throw new Error('价格无效');

  const cur = String(currency).toUpperCase() === 'JPY' ? 'JPY' : 'CNY';
  const fx = await getRates();

  const cny = convert(seenPrice, cur, 'CNY', fx);
  const msrpCny = kit.msrpJpy ? convert(kit.msrpJpy, 'JPY', 'CNY', fx) : null;
  const suan = kit.msrpJpy && cny ? cny / (kit.msrpJpy / 100) : null;
  const grade = gradeOf(suan);

  // 存一条快照，攒出这只的价格历史
  const history = await loadHistory();
  const list = history[kit.id] ?? [];
  list.push({
    at: nowIso(),
    price: seenPrice,
    currency: cur,
    cny: round(cny, 2),
    suan: round(suan, 2)
  });
  history[kit.id] = list.slice(-MAX_HISTORY);
  await writeJson(HISTORY_FILE, history);

  const previous = list.slice(0, -1);
  const lastBefore = previous[previous.length - 1] ?? null;
  const bestEver = list.reduce((min, item) => (item.suan && (!min || item.suan < min.suan) ? item : min), null);

  // 跟上次比：suan 变高就是涨价
  let trend = null;
  if (lastBefore && suan && lastBefore.suan) {
    const diff = round(suan - lastBefore.suan, 2);
    trend = {
      diffSuan: diff,
      diffPct: round(((suan - lastBefore.suan) / lastBefore.suan) * 100, 1),
      direction: diff > 0.05 ? 'up' : diff < -0.05 ? 'down' : 'flat',
      prevAt: lastBefore.at,
      prevSuan: lastBefore.suan
    };
  }

  return {
    kit: {
      id: kit.id,
      nameZh: kit.nameZh,
      brandZh: kit.brandZh,
      line: kit.line,
      scale: kit.scale,
      code: kit.code,
      aliases: kit.aliases ?? []
    },
    fx: {
      jpyCny: round(convert(1, 'JPY', 'CNY', fx), 4),
      date: fx.date,
      stale: Boolean(fx.stale)
    },
    seen: {
      input: seenPrice,
      currency: cur,
      cny: round(cny, 2)
    },
    msrpJpy: kit.msrpJpy ?? null,
    msrpCny: round(msrpCny, 2),
    suan: round(suan, 2),
    grade,
    /** 相对「官价 × 实时汇率」的溢价百分比 */
    vsMsrpPct: msrpCny && cny ? round((cny / msrpCny - 1) * 100, 1) : null,
    trend,
    bestEver: bestEver
      ? { suan: bestEver.suan, cny: bestEver.cny, at: bestEver.at }
      : null,
    historyCount: list.length,
    history: list.slice(-12).reverse()
  };
}

export async function getHistory(kitId) {
  const history = await loadHistory();
  return (history[kitId] ?? []).slice(-20).reverse();
}
