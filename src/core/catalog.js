import { resolve } from 'node:path';
import { ALIAS_FILE, DATA_DIR } from './paths.js';
import { readJson } from './store.js';

export const OFFICIAL_FILE = resolve(DATA_DIR, 'bandai-official.json');

let cache = null;
let meta = { fetchedAt: null, count: 0 };

export async function loadOfficial() {
  if (cache) return cache;
  const data = await readJson(OFFICIAL_FILE, { items: [], fetchedAt: null });
  cache = data.items ?? [];
  meta = { fetchedAt: data.fetchedAt ?? null, count: cache.length };
  return cache;
}

export function officialMeta() {
  return meta;
}

/**
 * 中文俗称 → 日文原名。
 *
 * 官方库存的是日文（νガンダム / ユニコーン），胶圈平时说的是中文俗称（牛高达 / 独角兽）。
 * 没有这层翻译，中文用户搜什么都搜不到。
 */
let aliasCache = null;

async function loadAlias() {
  if (aliasCache) return aliasCache;
  aliasCache = await readJson(ALIAS_FILE, {});
  return aliasCache;
}

function translateZh(text, alias) {
  let out = String(text ?? '');
  // 长词优先，避免「强袭」把「强袭自由」拆坏；英文忽略大小写
  const keys = Object.keys(alias).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const idx = out.toLowerCase().indexOf(key.toLowerCase());
    if (idx >= 0) out = out.slice(0, idx) + alias[key] + out.slice(idx + key.length);
  }
  return out;
}

/** 万代官方名是全角日文，搜索前统一压成半角，否则「HG」搜不到「ＨＧ」 */
function normalize(text) {
  return String(text ?? '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

const GRADE_ORDER = { HG: 0, RG: 1, MG: 2, PG: 3, EG: -1, FG: -1, SD: -2 };

/**
 * 在官方定价库里检索。
 * 全部本地匹配，毫秒级 —— 这是「原价库」该有的样子，不需要联网。
 */
/**
 * 限定版识别。
 *
 * 你要的是「通贩原价」—— 限定版（Gundam Base、7-11 联名、PB 受注、透明电镀）
 * 定价体系和通贩完全不同，混在一起会让「几算」失去意义。
 * 标题里这些词是可靠信号；「デストロイモード」是形态不是限定，别误伤。
 */
const LIMITED_RE = /限定|ガンダムベース|セブン-イレブン|プレミアムバンダイ|ホビーオンライン|受注|抽選|イベント|記念|特装|豪華版|クリアカラー|メッキ|チタニウム|エクストラフィニッシュ|劇場|初回|GFT|Ver\.GFT|エコプラ|リサイクル/i;

/** SD / BB / EG 这些不是 HG/MG/RG/PG 的常规定价体系，默认不显示 */
const EXCLUDE_GRADES = new Set(['SD', 'SDW', 'SDCS', 'BB', 'EG', 'FG']);

/** 配件：标题里出现这些基本是「XX用 底座/武器」，不是整机 */
const ACCESSORY_RE = /用\s*ブースター|ブースターベッド|用\s*ベース|ディスプレイベース|武器セット|オプションパーツ|クリアファイル|ファイル|ポスター|Tシャツ|マグカップ|キーホルダー|ストラップ/;

export function isLimited(name) {
  return LIMITED_RE.test(String(name ?? ''));
}

/**
 * 相关性打分。
 *
 * 搜「独角兽」不该先出来「ザクII改（ユニコーンVer.）」—— 那是独角兽版的其他机体。
 * 括号里的注释命中只给低分，机体名主体命中才给高分。
 */
function relevance(name, tokens) {
  const n = normalize(name);
  const bare = n.replace(/（[^）]*）|\([^)]*\)/g, '');
  let score = 0;
  for (const t of tokens) {
    const idx = bare.indexOf(t);
    if (idx === 0) score += 120;
    else if (idx > 0 && /\s/.test(bare[idx - 1])) score += 100;
    else if (idx > 0 && /[-‐ー]/.test(bare[idx - 1])) score += 70;
    else if (idx > 0) score += 90;
    else if (n.includes(t)) score += 8;
  }
  return score;
}

export async function searchOfficial(query, { limit = 60, includeLimited = false } = {}) {
  const items = await loadOfficial();
  const alias = await loadAlias();
  const translated = translateZh(query, alias);
  const tokens = normalize(translated).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const hits = items.filter((it) => {
    if (EXCLUDE_GRADES.has(it.grade)) return false;
    if (ACCESSORY_RE.test(it.name)) return false;
    if (!includeLimited && isLimited(it.name)) return false;
    const hay = normalize(`${it.name} ${it.code ?? ''} ${it.grade ?? ''} ${it.scale ?? ''}`);
    return tokens.every((t) => hay.includes(t));
  });

  return hits
    .map((it) => ({ it, score: relevance(it.name, tokens) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ga = GRADE_ORDER[a.it.grade] ?? 5;
      const gb = GRADE_ORDER[b.it.grade] ?? 5;
      if (ga !== gb) return ga - gb;
      return (a.it.price ?? 0) - (b.it.price ?? 0);
    })
    .slice(0, limit)
    .map((x) => x.it);
}

export async function getOfficialById(id) {
  const items = await loadOfficial();
  return items.find((it) => it.id === id) ?? null;
}

export function gradeOfTitle(name) {
  const m = normalize(name).match(/\b(pg|mg|rg|hguc|hgce|hgbf|hgbd|hg|eg|fg|sd)\b/);
  if (!m) return null;
  const g = m[1].toUpperCase();
  return g.startsWith('HG') ? 'HG' : g;
}
