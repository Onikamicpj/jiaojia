import { FX_FILE } from './paths.js';
import { readJson, writeJson } from './store.js';
import { fetchJson, nowIso } from './util.js';

const FX_ENDPOINT = 'https://api.frankfurter.dev/v1/latest?base=USD';
const TTL_MS = 12 * 60 * 60 * 1000;

/** 网络不可用时的兜底汇率：1 USD = X。仅用于让应用离线也能跑，会明确标记 stale */
const FALLBACK_RATES = {
  USD: 1,
  CNY: 7.09,
  JPY: 157.4,
  EUR: 0.92,
  HKD: 7.78,
  TWD: 32.1,
  GBP: 0.79
};

export async function getRates({ force = false } = {}) {
  const cached = await readJson(FX_FILE, null);
  const age = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;

  if (cached && !force && age < TTL_MS) {
    return { ...cached, cached: true };
  }

  try {
    const data = await fetchJson(FX_ENDPOINT, { timeout: 15000, retries: 1 });
    const rates = { ...data.rates, USD: 1 };
    const payload = {
      base: 'USD',
      rates,
      date: data.date,
      fetchedAt: nowIso(),
      live: true,
      cached: false
    };
    await writeJson(FX_FILE, payload);
    return payload;
  } catch (error) {
    if (cached) {
      return { ...cached, live: false, cached: true, stale: true, error: String(error.message || error) };
    }
    return {
      base: 'USD',
      rates: FALLBACK_RATES,
      date: null,
      fetchedAt: nowIso(),
      live: false,
      cached: false,
      stale: true,
      error: String(error.message || error)
    };
  }
}

/** 用「1 USD = rate」的汇率表做任意货币交叉换算 */
export function convert(amount, from, to, fx) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return null;
  const rates = fx?.rates ?? fx;
  if (!rates) return null;
  if (from === to) return Number(amount);
  const f = rates[from];
  const t = rates[to];
  if (!f || !t) return null;
  return (Number(amount) / f) * t;
}

export function rateBetween(from, to, fx) {
  return convert(1, from, to, fx);
}
