/**
 * 标题匹配：把商家标题映射回基准库里的套件。
 *
 * 为什么不用模糊相似度？
 * 模型标题脏得离谱（"BANDAI Gunpla Nu Gundam 1/144 RG MSN-93 Clear Color" 里
 * 混着厂牌、系列、比例、限定名、涂装名）。编辑距离会把 Hi-Nu 判成 Nu，
 * 也会把 1/100 判成 1/144 —— 这种错误在比价站上是致命的。
 *
 * 所以采用「人工写死规则 + 严格逻辑」：
 *   matchAll  所有 token 必须命中
 *   matchNone 任一 token 命中就否决
 * 宁可漏，不可错。
 */

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hit(text, token) {
  const t = String(token).toLowerCase().trim();
  if (!t) return true;

  // 短 token（如 rg / mg / pg / hg）容易误伤单词内部，必须按词边界匹配
  if (t.length <= 4 && /^[a-z0-9]+$/.test(t)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(t)}([^a-z0-9]|$)`, 'i').test(text);
  }

  return text.toLowerCase().includes(t);
}

/**
 * 从标题解析模型等级。
 * 顺序不能乱：先大后小，否则 "MG" 会被 "G" 之类误判。
 */
export function parseGrade(title) {
  const s = String(title || '').toUpperCase();
  if (/\bPG\b|PERFECT\s+GRADE/.test(s)) return 'PG';
  if (/\bMG\b|MASTER\s+GRADE/.test(s)) return 'MG';
  if (/\bRG\b|RG\s?\d/.test(s)) return 'RG';
  if (/HGUC|HGCE|HGBF|HGBD|HGW|HG\s?\d|\bHG\b/.test(s)) return 'HG';
  if (/\bEG\b|ENTRY\s+GRADE/.test(s)) return 'EG';
  if (/\bFG\b|FIRST\s+GRADE/.test(s)) return 'FG';
  if (/\bSD\b|\bBB\b/.test(s)) return 'SD';
  return null;
}

/** 把 kit.line 归一化成 grade：HGUC / HGBF / HGCE 都算 HG */
export function gradeOfLine(line) {
  if (!line) return null;
  const s = String(line).toUpperCase();
  if (s.startsWith('HG')) return 'HG';
  if (['PG', 'MG', 'RG', 'EG', 'FG', 'SD'].includes(s)) return s;
  return null;
}

/** 配件 / 水贴之类的非整机商品 */
const ACCESSORY_NOISE = [
  /decal/i,
  /sticker/i,
  /option (part|set)/i,
  /expansion/i,
  /effect (part|set)/i,
  /weapon (set|pack)/i,
  /水転写/,
  /デカール/,
  /オプションパーツ/
];

export function isAccessory(title) {
  return ACCESSORY_NOISE.some((re) => re.test(title));
}

/**
 * 严格匹配：等级必须一致 + 关键词全部命中 + 排除项未命中。
 * 等级对不上直接否决 —— RG 独角兽的水贴、HGUC 的杰刚都不能算进 RG 独角兽的行情。
 */
export function matchesKit(kit, title) {
  const text = String(title || '');
  if (!text) return false;

  const wantGrade = gradeOfLine(kit.line);
  if (wantGrade && parseGrade(text) !== wantGrade) return false;

  if (isAccessory(text)) return false;

  for (const bad of kit.matchNone ?? []) {
    if (hit(text, bad)) return false;
  }

  for (const need of kit.matchAll ?? []) {
    // 比例由 grade 已经锁定（RG=1/144、MG=1/100、PG=1/60），
    // 而商家标题常常根本不写比例，强制匹配会漏掉一大半
    if (/^\d+\/\d+$/.test(need)) continue;
    if (!hit(text, need)) return false;
  }

  return true;
}

/** 在基准库里查找一个 id */
export function findKit(kits, id) {
  return kits.find((k) => k.id === id) ?? null;
}
