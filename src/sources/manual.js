import { MANUAL_CSV } from '../core/paths.js';
import { readText } from '../core/store.js';
import { nowIso, parseCsv } from '../core/util.js';

/**
 * 人工报价源。
 *
 * 国模和 KO 没有官方 API，淘宝 / 拼多多 / 闲鱼也都没有对外开放价格接口，
 * 所以这部分只能靠人填。设计成一个 CSV，任何人（包括未来的你）都能直接编辑、
 * 提交 PR，不需要碰代码。
 *
 * 列：kitId, source, sourceName, title, price, currency, condition, url, note
 */
export const manual = {
  id: 'manual',
  name: '人工录入',
  region: 'CN',
  currency: 'CNY',
  homepage: null,
  note: '从 data/quotes.manual.csv 读取，适合国模 / KO / 淘宝 / 闲鱼',

  async listAll() {
    const text = await readText(MANUAL_CSV, '');
    if (!text.trim()) return [];

    return parseCsv(text)
      .map((row) => {
        const price = Number(row.price);
        if (!row.kitId || !Number.isFinite(price) || price <= 0) return null;

        return {
          kitId: row.kitId,
          source: (row.source || 'manual').toLowerCase(),
          sourceName: row.sourceName || row.source || '人工录入',
          region: row.region || 'CN',
          title: row.title || '',
          price,
          currency: (row.currency || 'CNY').toUpperCase(),
          available: row.available === '' || row.available === undefined ? true : row.available !== '0',
          condition: row.condition === 'used' ? 'used' : 'new',
          url: row.url || null,
          image: null,
          note: row.note || null,
          fetchedAt: nowIso()
        };
      })
      .filter(Boolean);
  },

  async search(kit) {
    const all = await this.listAll();
    return all.filter((q) => q.kitId === kit.id);
  }
};
