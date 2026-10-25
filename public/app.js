const state = {
  data: null,
  brand: 'all',
  q: ''
};

const el = {
  fxValue: document.getElementById('fxValue'),
  fxNote: document.getElementById('fxNote'),
  brandChips: document.getElementById('brandChips'),
  list: document.getElementById('list'),
  statline: document.getElementById('statline'),
  q: document.getElementById('q'),
  refreshBtn: document.getElementById('refreshBtn')
};

const BRAND_CLASS = { bandai: 'bandai', daban: 'ko', dragonmomoko: 'ko', motornuclear: 'cn', infinitenova: 'cn', jianghunji: 'cn' };
const BRAND_COLOR = { bandai: '#3dd6c4', daban: '#ff6b35', dragonmomoko: '#ff6b35', motornuclear: '#a78bfa', infinitenova: '#a78bfa', jianghunji: '#a78bfa' };
const GRADE_COLOR = { good: '#3dd6c4', normal: '#d8d2c4', high: '#f5a623', bad: '#ff5a5a' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtCny(v) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  const digits = Number.isInteger(n) ? 0 : Math.abs(n) >= 100 ? 0 : 1;
  return `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function fmtJpy(v) {
  if (!v) return '—';
  return `¥${Number(v).toLocaleString('ja-JP')}`;
}

function fmtSuan(v) {
  if (v === null || v === undefined) return '—';
  return Number(v).toFixed(1);
}

function shortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------- 渲染 ---------- */

function renderFx() {
  const fx = state.data.fx;
  el.fxValue.textContent = fx.jpyCny ? `1 円 = ${fx.jpyCny.toFixed(4)}` : '—';
  if (fx.stale) {
    el.fxNote.textContent = '离线兜底汇率';
    el.fxNote.className = 'fx-note warn';
  } else {
    el.fxNote.textContent = `${fx.date ?? ''} · ${shortDate(fx.fetchedAt)}${fx.cached ? ' · 缓存' : ''}`;
    el.fxNote.className = 'fx-note';
  }
}

function renderChips() {
  const brands = state.data.brands ?? [];
  const items = [{ id: 'all', zh: '全部' }, ...brands];
  el.brandChips.innerHTML = items
    .map((b) => `<button class="chip${state.brand === b.id ? ' active' : ''}" data-brand="${esc(b.id)}" type="button">${esc(b.zh)}</button>`)
    .join('');

  el.brandChips.querySelectorAll('.chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.brand = btn.dataset.brand;
      renderChips();
      renderList();
    });
  });
}

function matchesQuery(view, q) {
  if (!q) return true;
  const k = view.kit;
  const hay = [k.nameZh, k.nameEn, k.nameJa, k.code, k.brandZh, k.line, ...(k.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

function quoteRows(view) {
  const rows = view.quotes
    .slice()
    .sort((a, b) => (a.cny ?? Infinity) - (b.cny ?? Infinity))
    .map((q) => {
      const status = q.available === false
        ? '<span class="pill out">缺货</span>'
        : q.condition === 'used'
          ? '<span class="pill used">二手</span>'
          : '<span class="pill">现货</span>';
      const name = q.url
        ? `<a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.sourceName)}</a>`
        : esc(q.sourceName);
      const sub = q.title
        ? `<span class="qrow-sub">${esc(q.title)}</span>`
        : '';
      const orig = q.currency === 'JPY' ? fmtJpy(q.price) : `¥${Number(q.price).toLocaleString('zh-CN')}`;
      const ratioText = q.suan
        ? `${fmtSuan(q.suan)} 算`
        : view.cloneView?.msrpCny
          ? `占原版 ${Math.round((q.cny / view.cloneView.msrpCny) * 100)}%`
          : '—';
      return `<div class="qrow">
        <div class="qrow-main">
          <div class="qrow-title">${name}${status}</div>
          ${sub}
        </div>
        <div class="qrow-price">
          <div class="qrow-cny">${fmtCny(q.cny)}</div>
          <div class="qrow-suan">${orig} · ${ratioText}</div>
        </div>
      </div>`;
    })
    .join('');

  return `<div class="qlist">${rows}</div>`;
}

function cloneBlock(view) {
  if (!view.cloneView) return '';
  const c = view.cloneView;
  const ratio = c.ratio;
  return `<div class="clone">
    <div class="clone-head">KO 对照原版</div>
    原版 ${esc(c.nameZh)}，官方定价 ${fmtJpy(c.msrpJpy)}，按当前汇率折合 ${fmtCny(c.msrpCny)}。<br>
    这只 KO 卖 ${fmtCny(view.cheapest?.cny)}，<b>只有原版的 ${ratio !== null ? ratio + '%' : '—'}</b>。
  </div>`;
}

function cardOf(view) {
  const k = view.kit;
  const brandClass = BRAND_CLASS[k.brand] ?? '';
  const color = BRAND_COLOR[k.brand] ?? 'rgba(255,255,255,.14)';
  const gradeKey = view.grade?.key ?? 'normal';
  const suanColor = GRADE_COLOR[gradeKey] ?? GRADE_COLOR.normal;

  const hasMsrp = Boolean(k.msrpJpy);
  const isKo = Boolean(k.cloneOf);
  const cny = view.cheapest?.cny ?? null;
  const clone = view.cloneView;

  const dubious = view.cheapest?.suspicion === 'low';
  const gradeLabel = !view.cheapest ? '无报价' : dubious ? '存疑' : (view.grade?.zh ?? '');
  const suanColorFinal = dubious ? '#8a8f98' : suanColor;

  // 右上角指标：万代看几算，KO 看占原版官价的比例，国模没有对照基准
  let badgeNum; let badgeUnit = ''; let badgeCap; let badgeColor; let badgeText = false;
  if (isKo && clone) {
    badgeNum = clone.ratio !== null ? clone.ratio : '—';
    badgeUnit = clone.ratio !== null ? '%' : '';
    badgeCap = '占原版官价';
    badgeColor = '#ff6b35';
  } else if (hasMsrp) {
    badgeNum = fmtSuan(view.suan);
    badgeUnit = '算';
    badgeCap = gradeLabel;
    badgeColor = suanColorFinal;
  } else {
    badgeText = true;
    badgeNum = '原创';
    badgeCap = '无对照官价';
    badgeColor = '#a78bfa';
  }

  // 对标基准：万代用自家官价，KO 用被复刻原版的官价
  const baseMsrpJpy = hasMsrp ? k.msrpJpy : clone?.msrpJpy ?? null;
  const baseMsrpCny = hasMsrp ? view.msrpCny : clone?.msrpCny ?? null;
  const ratio = baseMsrpCny && cny ? cny / baseMsrpCny : null;
  const barPct = ratio !== null ? Math.min(ratio, 2) / 2 * 100 : 0;
  const vsText = view.cheapest?.vsFx !== null && view.cheapest?.vsFx !== undefined
    ? `${view.cheapest.vsFx > 0 ? '+' : ''}${view.cheapest.vsFx}%`
    : '—';

  const metaBits = [...new Set([k.code, k.line, k.scale, k.released].filter(Boolean))].map(esc).join(' · ');
  const sourceCount = new Set(view.quotes.map((q) => q.sourceName)).size;

  const warn = view.cheapest?.suspicion === 'high'
    ? '<p class="warnline">最低价明显高于官价，多半是限定版或绝版溢价，别当行情看。</p>'
    : dubious
      ? '<p class="warnline">最低价远低于官价，可能是缺件、二手或错版，下单前问清楚。</p>'
      : '';
  const refNote = view.cheapest?.stockHint ? '<span class="refnote">缺货挂牌价</span>' : '';

  let baseLine;
  if (hasMsrp) {
    baseLine = `<div class="msrp-line">
      <span>官价 ${fmtJpy(k.msrpJpy)} ｜ 折合 ${fmtCny(view.msrpCny)}</span>
      <span>${vsText}</span>
    </div>`;
  } else if (isKo && clone) {
    baseLine = `<div class="msrp-line">
      <span>原版 ${esc(clone.nameZh)} ${fmtJpy(clone.msrpJpy)}</span>
      <span>折合 ${fmtCny(clone.msrpCny)}</span>
    </div>`;
  } else {
    baseLine = `<div class="msrp-line"><span>原创设计 · 国产套件</span><span>—</span></div>`;
  }

  return `<article class="card" data-id="${esc(k.id)}" style="--stripe:${color}">
    <div class="card-head">
      <div style="min-width:0">
        <div class="kit-tags">
          <span class="tag ${brandClass}">${esc(k.brandZh)}</span>
          <span class="tag">${esc(k.line ?? '')}</span>
        </div>
        <h3 class="kit-name">${esc(k.nameZh)}</h3>
        <p class="kit-meta">${metaBits}</p>
      </div>
      <div class="suan-badge">
        <div class="suan-num${badgeText ? ' as-text' : ''}" style="color:${badgeColor}">${badgeNum}<span class="suan-unit">${badgeUnit}</span></div>
        <span class="suan-cap">${esc(badgeCap)}</span>
      </div>
    </div>

    <div class="price-row">
      <span class="price-main"><span class="cur">¥</span>${cny !== null ? cny.toLocaleString('zh-CN', { maximumFractionDigits: 0 }) : '—'}</span>
      <span class="price-sub">${view.cheapest ? `最低价 · ${esc(view.cheapest.sourceName)}` : '暂无数据'}</span>
    </div>

    ${warn}
    ${baseLine}
    ${baseMsrpCny ? `<div class="bar"><div class="bar-fill" style="width:${barPct}%;background:${badgeColor};opacity:.85"></div></div>` : ''}

    <div class="src-line">
      <span class="src-dot"></span>
      <span>${sourceCount} 个来源 · ${view.quoteCount} 条报价</span>
      <span class="spacer"></span>
      ${refNote}
    </div>

    <button class="expand" type="button">展开报价对比</button>

    <div class="detail">
      ${view.quotes.length ? quoteRows(view) : '<p style="color:var(--faint);font-size:12px;margin:0">这个源还没抓到报价。</p>'}
      ${cloneBlock(view)}
    </div>
  </article>`;
}

function renderList() {
  const q = state.q.trim().toLowerCase();
  const items = state.data.kits
    .filter((v) => state.brand === 'all' || v.kit.brand === state.brand)
    .filter((v) => matchesQuery(v, q));

  const withQuotes = items.filter((v) => v.quoteCount > 0).length;
  el.statline.textContent = `${items.length} 款套件 · ${withQuotes} 款有报价 · 更新于 ${shortDate(state.data.meta.quotesFetchedAt)}`;

  if (items.length === 0) {
    el.list.innerHTML = '<div class="empty">没找到。换个关键词试试。</div>';
    return;
  }

  el.list.innerHTML = items.map(cardOf).join('');

  el.list.querySelectorAll('.card').forEach((card) => {
    card.querySelector('.expand').addEventListener('click', () => {
      card.classList.toggle('open');
      const btn = card.querySelector('.expand');
      btn.textContent = card.classList.contains('open') ? '收起' : '展开报价对比';
    });
  });

  // 调试用：?open=all 直接展开全部，方便截图检查表格排版
  if (new URLSearchParams(location.search).get('open') === 'all') {
    el.list.querySelectorAll('.card').forEach((c) => {
      c.classList.add('open');
      c.querySelector('.expand').textContent = '收起';
    });
  }
}

/* ---------- 数据 ---------- */

async function loadState() {
  const res = await fetch('/api/state', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  state.data = await res.json();
  renderFx();
  renderChips();
  renderList();
}

el.q.addEventListener('input', (e) => {
  state.q = e.target.value;
  renderList();
});

// 支持 ?q=大班 这样的分享链接
const initialQ = new URLSearchParams(location.search).get('q');
if (initialQ) {
  state.q = initialQ;
  el.q.value = initialQ;
}

el.refreshBtn.addEventListener('click', async () => {
  el.refreshBtn.disabled = true;
  el.refreshBtn.textContent = '抓取中…';
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const payload = await res.json();
    if (payload.state) {
      state.data = payload.state;
      renderFx();
      renderChips();
      renderList();
    }
  } catch (err) {
    console.error(err);
  } finally {
    el.refreshBtn.disabled = false;
    el.refreshBtn.textContent = '抓取最新';
  }
});

loadState().catch((err) => {
  el.list.innerHTML = `<div class="empty">载入失败：${esc(err.message)}</div>`;
});
