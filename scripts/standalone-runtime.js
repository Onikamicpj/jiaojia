/* 单文件版运行时：搜索 + 核价，全部在浏览器本地完成 */
(function () {
  const GRADE_COLOR = { HG: '#8a8f98', RG: '#3dd6c4', MG: '#6ea8fe', PG: '#ff6b35', EG: '#8a8f98', FG: '#8a8f98', SD: '#a78bfa' };
  const VERDICT_COLOR = { good: '#3dd6c4', normal: '#d8d2c4', high: '#f5a623', bad: '#ff5a5a' };
  const GRADE_ORDER = { HG: 0, RG: 1, MG: 2, PG: 3, EG: -1, FG: -1, SD: -2 };
  const EXCLUDE_GRADES = { SD: 1, SDW: 1, SDCS: 1, BB: 1, EG: 1, FG: 1 };

  const LIMITED_RE = /限定|ガンダムベース|セブン-イレブン|プレミアムバンダイ|ホビーオンライン|受注|抽選|イベント|記念|特装|豪華版|クリアカラー|メッキ|チタニウム|エクストラフィニッシュ|劇場|初回|GFT|GPB|エコプラ|リサイクル|コーティング/i;
  const ACCESSORY_RE = /用\s*ブースター|ブースターベッド|用\s*ベース|ディスプレイベース|武器セット|オプションパーツ/;

  const PAGE = 24;
  let allItems = [];
  let shown = PAGE;
  let fx = 0.0424;
  let fxNote = '内置汇率';

  const $ = (id) => document.getElementById(id);

  function normalize(text) {
    return String(text ?? '')
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .toLowerCase();
  }

  const ALIAS_KEYS = Object.keys(window.__ALIAS__).sort((a, b) => b.length - a.length);

  function translateZh(text) {
    let out = String(text ?? '');
    for (const zh of ALIAS_KEYS) {
      if (out.includes(zh)) out = out.split(zh).join(window.__ALIAS__[zh]);
    }
    return out;
  }

  function relevance(name, tokens) {
    const n = normalize(name);
    const bare = n.replace(/（[^）]*）|\([^)]*\)/g, '');
    let score = 0;
    for (const t of tokens) {
      const idx = bare.indexOf(t);
      if (idx === 0) score += 120;                                   // νガンダム 开头
      else if (idx > 0 && /[\s]/.test(bare[idx - 1])) score += 100;   // 前面是空格
      else if (idx > 0 && /[-‐ー]/.test(bare[idx - 1])) score += 70;  // Hi-ν 这种，排后面
      else if (idx > 0) score += 90;
      else if (n.includes(t)) score += 8;                             // 只在括号里命中
    }
    return score;
  }

  function searchItems(query) {
    const translated = translateZh(query);
    const tokens = normalize(translated).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];

    return window.__DATA__.filter((it) => {
      if (EXCLUDE_GRADES[it.g]) return false;
      if (ACCESSORY_RE.test(it.n)) return false;
      if (LIMITED_RE.test(it.n)) return false;
      const hay = normalize(`${it.n} ${it.c || ''} ${it.g || ''} ${it.s || ''}`);
      return tokens.every((t) => hay.includes(t));
    })
      .map((it) => ({ it, score: relevance(it.n, tokens) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const ga = GRADE_ORDER[a.it.g] ?? 5;
        const gb = GRADE_ORDER[b.it.g] ?? 5;
        if (ga !== gb) return ga - gb;
        return (a.it.p ?? 0) - (b.it.p ?? 0);
      })
      .slice(0, 60)
      .map((x) => x.it);
  }

  function gradeOf(suan) {
    if (suan <= 4.5) return { key: 'good', zh: '好价', say: '低于 4.5 算，可以下手。' };
    if (suan <= 5.5) return { key: 'normal', zh: '正常', say: '正常区间，不着急可以再等等。' };
    if (suan <= 6.5) return { key: 'high', zh: '偏高', say: '偏高了，不是急用建议再等。' };
    return { key: 'bad', zh: '很贵', say: '明显贵了，除非绝版或急用，否则别买。' };
  }

  function fmtJpy(v) {
    return v == null ? '—' : '¥' + Number(v).toLocaleString('ja-JP');
  }

  function fmtCny(v) {
    if (v == null) return '—';
    const d = Number.isInteger(v) ? 0 : v >= 1000 ? 0 : 1;
    return '¥' + Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---- 历史（localStorage） ---- */
  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem('jiaojia-history') || '{}');
    } catch {
      return {};
    }
  }

  function saveHistory(h) {
    try {
      localStorage.setItem('jiaojia-history', JSON.stringify(h));
    } catch {
      /* 隐私模式下可能写不了，忽略 */
    }
  }

  /* ---- 渲染 ---- */

  function cardOf(it) {
    const tags = [];
    if (it.g) {
      const c = GRADE_COLOR[it.g] || '#8a8f98';
      tags.push(`<span class="spec spec-grade" style="color:${c};border-color:${c}44">${esc(it.g)}</span>`);
    }
    if (it.s) tags.push(`<span class="spec">${esc(it.s)}</span>`);
    if (it.c) tags.push(`<span class="spec">${esc(it.c)}</span>`);

    return `<article class="card" data-id="${esc(it.id)}" data-price="${it.p}">
      <div class="card-head">
        <div class="specs">${tags.join('')}</div>
        <div class="card-price">
          <div class="jpy">${fmtJpy(it.p)}</div>
          <div class="cny">≈ ${fmtCny(it.p * fx)}</div>
        </div>
      </div>
      <h3 class="card-name">${esc(it.n)}</h3>
      <div class="card-meta">${esc(it.r || '发售日未标')} · 官方定价</div>

      <div class="calc">
        <span class="calc-label">你看到</span>
        <div class="calc-field">
          <span class="calc-cur">¥</span>
          <input class="calc-input" type="number" inputmode="decimal" min="1" step="1" placeholder="现价">
          <select class="calc-sel">
            <option value="CNY">人民币</option>
            <option value="JPY">日元</option>
          </select>
        </div>
        <button class="calc-btn" type="button">核价</button>
      </div>

      <div class="calc-out"></div>
    </article>`;
  }

  function render(items) {
    const list = $('list');
    if (items.length === 0) {
      list.innerHTML = `<div class="empty">
        <p><b>没查到这一款。</b></p>
        <p>官方库是日文原名，试试 <b>νガンダム</b>、<b>ユニコーン</b>，或直接用型号 <b>RX-93</b>。</p>
      </div>`;
      return;
    }

    const more = items.length > shown ? `<button class="more" type="button">还有 ${items.length - shown} 条，继续加载</button>` : '';
    list.innerHTML = items.slice(0, shown).map(cardOf).join('') + more;
    bindCards();

    const btn = list.querySelector('.more');
    if (btn) {
      btn.addEventListener('click', () => {
        shown += PAGE;
        render(allItems);
      });
    }
  }

  function bindCards() {
    document.querySelectorAll('.card').forEach((card) => {
      const input = card.querySelector('.calc-input');
      const sel = card.querySelector('.calc-sel');
      const run = () => doCheck(card, input.value, sel.value);
      card.querySelector('.calc-btn').addEventListener('click', run);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') run();
      });
    });
  }

  function doCheck(card, rawPrice, currency) {
    const out = card.querySelector('.calc-out');
    const price = Number(rawPrice);
    if (!price || price <= 0) {
      out.innerHTML = '<div class="err">先填你看到的价格</div>';
      return;
    }

    const msrpJpy = Number(card.dataset.price);
    const id = card.dataset.id;

    const cny = currency === 'JPY' ? price * fx : price;
    const msrpCny = msrpJpy * fx;
    const suan = cny / (msrpJpy / 100);
    const g = gradeOf(suan);
    const color = VERDICT_COLOR[g.key];
    const vs = Math.round(((cny / msrpCny) - 1) * 1000) / 10;

    // 记一条历史，用来判断涨跌
    const history = loadHistory();
    const list = history[id] || [];
    const prev = list.length ? list[list.length - 1] : null;
    list.push({ at: new Date().toISOString(), cny: Math.round(cny * 100) / 100, suan: Math.round(suan * 100) / 100 });
    history[id] = list.slice(-40);
    saveHistory(history);

    let trend = '<span class="trend first">首次记录，再核一次就能看涨跌</span>';
    if (prev) {
      const diff = Math.round((suan - prev.suan) * 100) / 100;
      const dir = diff > 0.05 ? 'up' : diff < -0.05 ? 'down' : 'flat';
      const label = dir === 'up' ? '比上次涨' : dir === 'down' ? '比上次降' : '与上次持平';
      trend = `<span class="trend ${dir}">${label} ${Math.abs(diff).toFixed(2)} 算</span>`;
    }

    const best = list.length > 1
      ? `<span class="best">历史最低 ${Math.min(...list.map((x) => x.suan)).toFixed(1)} 算</span>`
      : '';

    out.innerHTML = `<div class="res">
      <div class="res-main">
        <span class="res-suan" style="color:${color}">${suan.toFixed(1)}<span>算</span></span>
        <span class="res-grade" style="color:${color}">${esc(g.zh)}</span>
        <span class="res-say">${esc(g.say)}</span>
      </div>
      <div class="res-detail">
        <span>官价 ${fmtJpy(msrpJpy)} → 折合 ${fmtCny(msrpCny)}</span>
        <span class="dot">·</span>
        <span>你看到 ${fmtCny(cny)}</span>
        <span class="dot">·</span>
        <span style="color:${color}">比官价${vs > 0 ? '贵' : '便宜'} ${Math.abs(vs)}%</span>
      </div>
      <div class="res-extra">${trend}${best}</div>
    </div>`;
  }

  /* ---- 事件 ---- */

  function submit(q) {
    const query = String(q || '').trim();
    if (!query) return;
    allItems = searchItems(query);
    shown = PAGE;
    $('status').textContent = allItems.length ? `「${query}」命中 ${allItems.length} 条` : `「${query}」命中 0 条`;
    render(allItems);
  }

  document.getElementById('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    submit($('q').value);
  });

  document.querySelector('.hotline').addEventListener('click', (e) => {
    const btn = e.target.closest('.hot');
    if (!btn) return;
    $('q').value = btn.dataset.q;
    submit(btn.dataset.q);
  });

  $('dbInfo').textContent = `收录 ${window.__DATA__.length.toLocaleString('zh-CN')} 条`;
  $('fxValue').textContent = `${fx.toFixed(4)} CNY`;

  // 支持 file:///.../jiaojia.html#q=独角兽 直接带着搜索词打开
  const hashQ = decodeURIComponent((location.hash.match(/q=([^&]*)/) || [])[1] || '');
  if (hashQ) {
    $('q').value = hashQ;
    submit(hashQ);
  }

  // 汇率：能联网就换成实时值，连不上就用内置的
  fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,JPY')
    .then((r) => r.json())
    .then((d) => {
      if (d?.rates?.JPY && d?.rates?.CNY) {
        fx = d.rates.CNY / d.rates.JPY;
        fxNote = d.date || '实时';
        $('fxValue').textContent = `${fx.toFixed(4)} CNY`;
        $('fxDate').textContent = fxNote;
        if (allItems.length) render(allItems);
      }
    })
    .catch(() => {
      $('fxDate').textContent = '内置汇率（未联网）';
    });
})();
