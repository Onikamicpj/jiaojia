const $ = (id) => document.getElementById(id);

const el = {
  form: $('searchForm'),
  q: $('q'),
  go: $('goBtn'),
  fxValue: $('fxValue'),
  dbInfo: $('dbInfo'),
  status: $('status'),
  list: $('list')
};

const GRADE_COLOR = { HG: '#8a8f98', RG: '#3dd6c4', MG: '#6ea8fe', PG: '#ff6b35', EG: '#8a8f98', FG: '#8a8f98', SD: '#a78bfa' };
const VERDICT_COLOR = { good: '#3dd6c4', normal: '#d8d2c4', high: '#f5a623', bad: '#ff5a5a' };

const PAGE = 24;
let allItems = [];
let shown = PAGE;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtJpy(v) {
  return v === null || v === undefined ? '—' : `¥${Number(v).toLocaleString('ja-JP')}`;
}

function fmtCny(v) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  const digits = Number.isInteger(n) ? 0 : n >= 1000 ? 0 : 1;
  return `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function gradeOf(suan) {
  if (suan === null || suan === undefined) return null;
  if (suan <= 4.5) return { key: 'good', zh: '好价', say: '低于 4.5 算，可以下手。' };
  if (suan <= 5.5) return { key: 'normal', zh: '正常', say: '正常区间，不着急可以再等等。' };
  if (suan <= 6.5) return { key: 'high', zh: '偏高', say: '偏高了，不是急用建议再等。' };
  return { key: 'bad', zh: '很贵', say: '明显贵了，除非绝版或急用，否则别买。' };
}

/* ---------- 卡片 ---------- */

function cardOf(item) {
  const tags = [];
  if (item.grade) {
    const c = GRADE_COLOR[item.grade] ?? '#8a8f98';
    tags.push(`<span class="spec spec-grade" style="color:${c};border-color:${c}44">${esc(item.grade)}</span>`);
  }
  if (item.scale) tags.push(`<span class="spec">${esc(item.scale)}</span>`);
  if (item.code) tags.push(`<span class="spec">${esc(item.code)}</span>`);

  return `<article class="card" data-id="${esc(item.id)}">
    <div class="card-head">
      <div class="specs">${tags.join('')}</div>
      <div class="card-price">
        <div class="jpy">${fmtJpy(item.price)}</div>
        <div class="cny">≈ ${fmtCny(item.cny)}</div>
      </div>
    </div>

    <h3 class="card-name">${esc(item.name)}</h3>
    <div class="card-meta">${esc(item.released ?? '发售日未标')} · 官方定价</div>

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

function bindCards() {
  el.list.querySelectorAll('.card').forEach((card) => {
    const input = card.querySelector('.calc-input');
    const sel = card.querySelector('.calc-sel');
    card.querySelector('.calc-btn').addEventListener('click', () => check(card, input.value, sel.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') check(card, input.value, sel.value);
    });
  });
}

function render(items) {
  if (items.length === 0) {
    el.list.innerHTML = `<div class="empty">
      <p><b>没查到这一款。</b></p>
      <p>官方库是日文原名，试试：<b>νガンダム</b>、<b>ユニコーン</b>、<b>ストライクフリーダム</b>，或者直接用型号 <b>RX-93</b>。</p>
    </div>`;
    return;
  }

  const moreBtn = items.length > shown ? `<button class="more" type="button">还有 ${items.length - shown} 条，继续加载</button>` : '';
  el.list.innerHTML = items.slice(0, shown).map(cardOf).join('') + moreBtn;
  bindCards();

  const more = el.list.querySelector('.more');
  if (more) {
    more.addEventListener('click', () => {
      shown += PAGE;
      render(allItems);
    });
  }
}

/* ---------- 核价 ---------- */

function renderCheck(out, d) {
  const g = d.grade;
  const color = VERDICT_COLOR[g?.key ?? 'normal'];

  const trend = d.trend
    ? `<span class="trend ${d.trend.direction}">${d.trend.direction === 'up' ? '比上次涨' : d.trend.direction === 'down' ? '比上次降' : '与上次持平'} ${Math.abs(d.trend.diffSuan).toFixed(2)} 算</span>`
    : '<span class="trend first">首次记录，再核一次就能看涨跌</span>';

  const best = d.bestEver && d.historyCount > 1
    ? `<span class="best">历史最低 ${d.bestEver.suan.toFixed(1)} 算</span>`
    : '';

  out.innerHTML = `<div class="res">
    <div class="res-main">
      <span class="res-suan" style="color:${color}">${d.suan.toFixed(1)}<span>算</span></span>
      <span class="res-grade" style="color:${color}">${esc(g?.zh ?? '')}</span>
      <span class="res-say">${esc(g?.say ?? '')}</span>
    </div>
    <div class="res-detail">
      <span>官价 ${fmtJpy(d.msrpJpy)} → 折合 ${fmtCny(d.msrpCny)}</span>
      <span class="dot">·</span>
      <span>你看到 ${fmtCny(d.seen.cny)}</span>
      <span class="dot">·</span>
      <span style="color:${color}">比官价${d.vsMsrpPct > 0 ? '贵' : '便宜'} ${Math.abs(d.vsMsrpPct)}%</span>
    </div>
    <div class="res-extra">${trend}${best}</div>
  </div>`;
}

async function check(card, price, currency) {
  const out = card.querySelector('.calc-out');
  const id = card.dataset.id;

  if (!price || Number(price) <= 0) {
    out.innerHTML = '<div class="err">先填你看到的价格</div>';
    return;
  }

  out.innerHTML = '<div class="loading">核价中…</div>';

  try {
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: id, price: Number(price), currency })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    renderCheck(out, data);
  } catch (err) {
    out.innerHTML = `<div class="err">核价失败：${esc(err.message)}</div>`;
  }
}

/* ---------- 查询 ---------- */

async function search(keyword) {
  const q = keyword.trim();
  if (!q) return;

  el.go.disabled = true;
  el.go.textContent = '查询中';
  el.status.textContent = '在官方价库里找…';

  try {
    const res = await fetch(`/api/official?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

    el.fxValue.textContent = data.fx?.jpyCny ? `${data.fx.jpyCny.toFixed(4)} CNY` : '—';
    if (data.meta) el.dbInfo.textContent = `收录 ${Number(data.meta.count).toLocaleString('zh-CN')} 条`;

    allItems = data.items ?? [];
    shown = PAGE;

    el.status.textContent = allItems.length
      ? `「${q}」命中 ${allItems.length} 条${allItems.length > PAGE ? `（先显示 ${PAGE} 条）` : ''}`
      : `「${q}」命中 0 条`;

    render(allItems);
    history.replaceState(null, '', `?q=${encodeURIComponent(q)}`);
  } catch (err) {
    el.status.innerHTML = `<span class="err">查询失败：${esc(err.message)}</span>`;
    el.list.innerHTML = '';
  } finally {
    el.go.disabled = false;
    el.go.textContent = '查原价';
  }
}

/* ---------- 事件 ---------- */

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  search(el.q.value);
});

document.querySelector('.hotline').addEventListener('click', (e) => {
  const btn = e.target.closest('.hot');
  if (!btn) return;
  el.q.value = btn.dataset.q;
  search(btn.dataset.q);
});

const initial = new URLSearchParams(location.search).get('q');
if (initial) {
  el.q.value = initial;
  search(initial);
} else {
  fetch('/api/official?q=__init__')
    .then((r) => r.json())
    .then((d) => {
      if (d.meta) el.dbInfo.textContent = `收录 ${Number(d.meta.count).toLocaleString('zh-CN')} 条`;
    })
    .catch(() => {});
}

// 调试：?demo=260 自动对第一条核价，方便截图核对排版
const demo = new URLSearchParams(location.search).get('demo');
if (demo) {
  setTimeout(() => {
    const card = document.querySelector('.card');
    if (!card) return;
    const input = card.querySelector('.calc-input');
    input.value = demo;
    card.querySelector('.calc-btn').click();
  }, 1200);
}
