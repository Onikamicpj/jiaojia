export function nowIso() {
  return new Date().toISOString();
}

export function round(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 带超时与重试的 JSON 请求。零依赖，只用 Node 内置 fetch。
 */
export async function fetchJson(url, options = {}) {
  const { timeout = 20000, retries = 1, headers = {}, ...rest } = options;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...rest,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          accept: 'application/json, text/plain, */*',
          'accept-language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7',
          ...headers
        },
        signal: AbortSignal.timeout(timeout)
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    }
  }

  throw lastError;
}

/** 极简 CSV 解析，支持双引号包裹与转义引号 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const clean = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (clean.length === 0) return [];

  const header = clean[0].map((h) => h.trim());
  return clean.slice(1).map((r) => {
    const obj = {};
    header.forEach((key, idx) => {
      obj[key] = (r[idx] ?? '').trim();
    });
    return obj;
  });
}
