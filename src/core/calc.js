import { convert, rateBetween } from './fx.js';
import { round } from './util.js';

/**
 * 「几算」—— 胶圈通用计价单位。
 * 官方定价 4500 円的模型，卖 225 元就是 5 算（225 / 45）。
 * 数字越低越便宜；按实时汇率折算出来的价格约等于 4.25 算。
 *
 * KO / 国模没有日元官方定价，所以不算几算，改看「相当于原版官价的百分比」。
 */
export function suanOf(cny, msrpJpy) {
  if (!msrpJpy || !cny) return null;
  return round(cny / (msrpJpy / 100), 2);
}

/** 按当前汇率，官方定价折合多少人民币 */
export function msrpCnyOf(kit, fx) {
  if (!kit.msrpJpy) return null;
  return round(convert(kit.msrpJpy, 'JPY', 'CNY', fx), 2);
}

/** 价格合理性：离官方汇率价太远的报价不参与「最低价」，避免限定版污染行情 */
export function sanityOf(cny, msrpCny) {
  if (!cny || !msrpCny) return 'na';
  const ratio = cny / msrpCny;
  if (ratio < 0.7) return 'low';
  if (ratio > 2.0) return 'high';
  return 'ok';
}

/**
 * 把一个报价换算成可比较的统一视图
 */
export function decorateQuote(quote, kit, fx) {
  const cny = round(convert(quote.price, quote.currency, 'CNY', fx), 2);
  const msrpCny = msrpCnyOf(kit, fx);
  const suan = suanOf(cny, kit.msrpJpy);

  return {
    ...quote,
    cny,
    suan,
    msrpCny,
    sanity: sanityOf(cny, msrpCny),
    /** 相对「官方定价 × 实时汇率」的溢价百分比，负数=比汇率价还便宜 */
    vsFx: msrpCny && cny ? round((cny / msrpCny - 1) * 100, 1) : null,
    /** 相对官方日元定价的绝对差价（已换人民币） */
    diffCny: msrpCny && cny ? round(cny - msrpCny, 2) : null
  };
}

export function gradeOf(suan) {
  if (suan === null || suan === undefined) return null;
  if (suan <= 4.5) return { key: 'good', zh: '好价', en: 'good' };
  if (suan <= 5.5) return { key: 'normal', zh: '正常', en: 'fair' };
  if (suan <= 6.5) return { key: 'high', zh: '偏高', en: 'high' };
  return { key: 'bad', zh: '很贵', en: 'bad' };
}

/**
 * 给一个套件汇总：各源报价、最低价、几算区间、与 KO 原版的对比
 */
export function buildKitView(kit, quotes, fx, kitIndex) {
  const decorated = quotes
    .map((q) => decorateQuote(q, kit, fx))
    .sort((a, b) => (a.cny ?? Infinity) - (b.cny ?? Infinity));

  // 有货优先；全都缺货时退化为「历史挂牌价参考」，仍然有比价意义
  const inStock = decorated.filter((q) => q.available !== false);
  const pool = inStock.length > 0 ? inStock : decorated;
  const sane = pool.filter((q) => q.sanity === 'ok' || q.sanity === 'na');
  const picked = sane[0] ?? pool[0] ?? null;
  const cheapest = picked
    ? {
        ...picked,
        suspicion: picked.sanity === 'high' ? 'high' : picked.sanity === 'low' ? 'low' : null,
        stockHint: inStock.length > 0 ? null : '全部缺货，为历史挂牌价'
      }
    : null;

  let cloneView = null;
  if (kit.cloneOf) {
    const origin = kitIndex.get(kit.cloneOf);
    if (origin) {
      const originMsrpCny = msrpCnyOf(origin, fx);
      cloneView = {
        kitId: origin.id,
        nameZh: origin.nameZh,
        nameEn: origin.nameEn,
        msrpJpy: origin.msrpJpy,
        msrpCny: originMsrpCny,
        ratio:
          cheapest && originMsrpCny ? round((cheapest.cny / originMsrpCny) * 100, 1) : null
      };
    }
  }

  return {
    kit,
    quotes: decorated,
    cheapest,
    quoteCount: decorated.length,
    suan: cheapest?.suan ?? null,
    grade: gradeOf(cheapest?.suan ?? null),
    msrpCny: msrpCnyOf(kit, fx),
    fxRateJpyCny: round(rateBetween('JPY', 'CNY', fx), 4),
    cloneView
  };
}
