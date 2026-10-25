const $ = (id) => document.getElementById(id);

const el = {
  form: $('searchForm'),
  q: $('q'),
  go: $('goBtn'),
  fxValue: $('fxValue'),
  fxNote: $('fxNote'),
  status: $('status'),
  result: $('result'),
  platforms: $('platforms'),
  platBtns: $('platBtns'),
  hotline: $('hotline')
};

const GRADE_COLOR = { good: '#3dd6c4', normal: '#d8d2c4', high: '#f5a623', bad: '#ff5a5a' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtCny(v) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  const digits = Number.isInteger(n) ? 0 : Math.abs(n) >= 1000 ? 0 : 1;
  return `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function gradeOf(suan) {
  if (suan === null || suan === undefined) return null;
  if (suan <= 4.5) return { key: 'good', zh: '好价' };
  if (suan <= 5.5) return { key: 'normal', zh: '正常' };
  if (suan <= 6.5) return { key: 'high', zh: '偏高' };
  return { key: 'bad', zh: '很贵' };
}

function agoText(iso) {
  if (!iso) return '刚刚确认';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return '刚刚确认';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚确认';
  if (mins < 60) return `${mins} 分钟前更新`;
  return `${Math.floor(mins / 60)} 小时前更新`;
}

/* ---------- 渲染 ---------- */

const GRADE_TAG_COLOR = {
  HG: '#8a8f98',
  RG: '#3dd6c4',
  MG: '#6ea8fe',
  PG: '#ff6b35',
  EG: '#8a8f98',
  FG: '#8a8f98',
  SD: '#a78bfa'
};

function specTags(spec) {
  if (!spec) return '';
  const out = [];
  if (spec.grade) {
    const c = GRADE_TAG_COLOR[spec.grade] ?? '#8a8f98';
    out.push(`<span class="spec spec-grade" style="color:${c};border-color:${c}44">${esc(spec.grade)}</span>`);
  }
  if (spec.scale) out.push(`<span class="spec">${esc(spec.scale)}</span>`);
  if (spec.code) out.push(`<span class="spec">${esc(spec.code)}</span>`);
  return out.join('');
}

function renderRows(data) {
  const rows = data.results.map((r) => {
    const g = gradeOf(r.suan);
    const color = r.sanity === 'high' ? GRADE_COLOR.high : g ? GRADE_COLOR[g.key] : 'var(--faint)';
    const gradeText = r.sanity === 'high' ? '疑似限定' : r.sanity === 'low' ? '价格偏低' : g ? g.zh : '无官价对照';

    const stock = r.available
      ? '<span class="pill ok">有货</span>'
      : '<span class="pill out">缺货</span>';
    const cond = r.condition === 'used' ? '<span class="pill used">二手</span>' : '';

    return `<article class="row">
      <div class="row-main">
        <div class="row-spec">${specTags(r.spec)}</div>
        <div class="row-title">${esc(r.title)}</div>
        <div class="row-meta">
          <span class="src">${esc(r.sourceName)}</span>
          ${stock}${cond}
          <span>${agoText(r.liveAt)}</span>
        </div>
      </div>
      <div class="row-num">
        <div class="cny">${fmtCny(r.cny)}</div>
        <div class="orig">¥${Number(r.price).toLocaleString('ja-JP')} JPY</div>
      </div>
      <div class="row-suan">
        <div class="suan" style="color:${color}">${r.suan ? r.suan.toFixed(1) : '—'}<span>算</span></div>
        <div class="grade">${gradeText}</div>
      </div>
      <div class="row-acts">
        ${r.kitId ? `<button class="row-ap" type="button" data-kit="${esc(r.kitId)}" data-title="${esc(r.title)}">核价</button>` : ''}
        <a class="row-go" href="${esc(r.url)}" target="_blank" rel="noopener">打开</a>
      </div>
    </article>`;
  }).join('');

  return `<div class="rows">${rows}</div>`;
}

/* ---------- 核价 ---------- */

function renderAppraisePanel(kitId, title) {
  return `<div class="ap-panel" data-panel="${esc(kitId)}">
    <div class="ap-row">
      <span class="ap-label">你看到的价格</span>
      <div class="ap-field">
        <span class="ap-cur">¥</span>
        <input class="ap-input" type="number" inputmode="decimal" min="1" step="1" placeholder="比如 230" data-kit="${esc(kitId)}">
        <select class="ap-sel" data-kit="${esc(kitId)}">
          <option value="CNY">人民币</option>
          <option value="JPY">日元</option>
        </select>
      </div>
      <button class="ap-btn" type="button" data-kit="${esc(kitId)}" data-title="${esc(title)}">核价</button>
    </div>
    <div class="ap-out" data-out="${esc(kitId)}"></div>
  </div>`;
}

function renderVerdict(d) {
  const g = d.grade;
  const color = GRADE_COLOR[g?.key ?? 'normal'];
  const trend = d.trend
    ? `<div class="ap-trend ${d.trend.direction}">
        ${d.trend.direction === 'up' ? '比上次涨了' : d.trend.direction === 'down' ? '比上次降了' : '跟上一次持平'}
        ${Math.abs(d.trend.diffSuan).toFixed(2)} 算（${d.trend.diffPct > 0 ? '+' : ''}${d.trend.diffPct}%）
      </div>`
    : `<div class="ap-trend first">第一次记录这只。以后再核，就能看出是涨还是降。</div>`;

  const best = d.bestEver && d.historyCount > 1
    ? `<div class="ap-best">历史最低 ${d.bestEver.suan.toFixed(1)} 算（¥${d.bestEver.cny}）</div>`
    : '';

  return `<div class="ap-card">
    <div class="ap-head">
      <div class="ap-suan" style="color:${color}">${d.suan.toFixed(1)}<span>算</span></div>
      <div class="ap-verdict">
        <div class="ap-grade" style="color:${color}">${g?.zh ?? ''}</div>
        <div class="ap-say">${g?.verdict ?? ''}</div>
      </div>
    </div>

    <div class="ap-math">
      <span>官方定价 <b>¥${Number(d.msrpJpy).toLocaleString('ja-JP')}</b> 円</span>
      <span class="ap-arrow">→</span>
      <span>折合 <b>¥${d.msrpCny.toFixed(1)}</b></span>
      <span class="ap-sep">·</span>
      <span>你看到 <b>¥${d.seen.cny}</b></span>
      <span class="ap-sep">·</span>
      <span style="color:${color}">比官价 ${d.vsMsrpPct > 0 ? '贵' : '便宜'} ${Math.abs(d.vsMsrpPct)}%</span>
    </div>

    ${trend}
    ${best}
  </div>`;
}

async function doAppraise(kitId, title, price, currency) {
  const out = document.querySelector(`[data-out="${kitId}"]`);
  if (!out) return;

  if (!price || Number(price) <= 0) {
    out.innerHTML = '<div class="ap-err">先填你看到的价格</div>';
    return;
  }

  out.innerHTML = '<div class="ap-loading">核价中…</div>';

  try {
    const res = await fetch('/api/appraise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kitId, price: Number(price), currency })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

    if (data.suan === null || data.suan === undefined) {
      out.innerHTML = `<div class="ap-err">这款没有官方日元定价（国模 / KO），算不了几算。</div>`;
      return;
    }
    out.innerHTML = renderVerdict(data);
  } catch (err) {
    out.innerHTML = `<div class="ap-err">核价失败：${esc(err.message)}</div>`;
  }
}

function renderSummary(data) {
  const k = data.matchedKit;
  const results = data.results;
  const multi = (k?.specs?.length ?? 1) > 1;

  const head = `<div class="sumline">
    ${k ? `匹配 <b>${esc(k.brandZh)} ${esc(k.familyZh)}</b>` : `按 <b>${esc(data.usedQuery)}</b> 检索`}
    ${multi ? `<span class="sep">·</span>${k.specs.length} 个规格` : ''}
    <span class="sep">·</span>候选 ${data.candidateCount ?? 0} 条
    <span class="sep">·</span>实时确认 ${results.length} 条
    <span class="sep">·</span>${data.elapsedMs} ms
  </div>`;

  if (results.length === 0) return head;

  // 多规格时不同价位的绝对值不可比，改看谁的几算最优；
  // 但「价格偏低 / 疑似限定」的不参与，那种数字会误导
  const healthy = results.filter((r) => r.sanity === 'ok' || r.sanity === 'na');
  const pool = healthy.length > 0 ? healthy : results;
  const best = pool.reduce((a, b) => ((a.suan ?? 99) <= (b.suan ?? 99) ? a : b));
  if (!best?.msrpJpy || best.suan === null || best.suan === undefined) return head;

  const g = gradeOf(best.suan);
  const color = GRADE_COLOR[g?.key ?? 'normal'];

  return `${head}
  <div class="bench">
    <div class="bench-cell">
      <div class="bench-label">官方定价 · ${esc(best.spec?.grade ?? '')} ${esc(best.spec?.scale ?? '')}</div>
      <div class="bench-value">¥${Number(best.msrpJpy).toLocaleString('ja-JP')}</div>
      <div class="bench-sub">折合 ${fmtCny(best.msrpCny)}</div>
    </div>
    <div class="bench-arrow">→</div>
    <div class="bench-cell">
      <div class="bench-label">${multi ? '几算最优的一条' : '此刻最低'}</div>
      <div class="bench-value" style="color:${color}">${fmtCny(best.cny)}</div>
      <div class="bench-sub">${best.suan.toFixed(1)} 算 · ${g ? g.zh : ''}</div>
    </div>
    <div class="bench-gap" style="color:${color}">
      ${best.vsFx === null || best.vsFx === undefined ? '—' : `${best.vsFx > 0 ? '+' : ''}${best.vsFx}%`}
      <span>相对汇率价</span>
    </div>
  </div>`;
}

function renderPlatforms(keyword) {
  const q = encodeURIComponent(keyword);
  el.platBtns.innerHTML = [
    { name: '拼多多', url: `https://mobile.yangkeduo.com/search_result.html?search_key=${q}`, note: '需登录' },
    { name: '京东', url: `https://search.jd.com/Search?keyword=${q}&enc=utf-8`, note: '需登录' },
    { name: '淘宝', url: `https://s.taobao.com/search?q=${q}`, note: '需登录' }
  ]
    .map((p) => `<a class="plat" href="${esc(p.url)}" target="_blank" rel="noopener">${p.name} <small>${p.note}</small></a>`)
    .join('');
  el.platforms.hidden = false;
  el.platforms.dataset.keyword = keyword;
}

function fullNameOf(kit) {
  if (!kit) return '';
  return kit.nameZh.startsWith(kit.brandZh) ? kit.nameZh : `${kit.brandZh} ${kit.nameZh}`;
}

function renderEmpty(data) {
  const k = data.matchedKit;
  const isNonBandai = k && !(k.specs ?? []).some((s) => s.msrpJpy);

  if (isNonBandai) {
    return `<div class="empty">
      <p><b>${esc(k.brandZh)} ${esc(k.familyZh)}</b> 是国模 / KO，日本站没有货源。</p>
      <p>用下面国内平台的按钮直接搜，看到的就是实时价。</p>
    </div>`;
  }

  return `<div class="empty">
    <p><b>日本站现在没有这款的通贩现货。</b></p>
    <p>限定版、透明版已被过滤掉，它们的价格不代表行情。</p>
    <p>换个体别名再试，或者点下面国内平台自己看。</p>
  </div>`;
}

/* ---------- 查询 ---------- */

async function search(keyword) {
  const q = keyword.trim();
  if (!q) return;

  el.go.disabled = true;
  el.go.textContent = '查询中';
  el.status.textContent = '正在抓取实时报价…';
  el.platforms.hidden = true;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

    el.fxValue.textContent = data.fx.jpyCny ? `${data.fx.jpyCny.toFixed(4)} CNY` : '—';
    el.fxNote.textContent = data.fx.stale ? '兜底汇率' : (data.fx.date ?? '');
    el.fxNote.className = data.fx.stale ? 'fx-note warn' : 'fx-note';

    el.status.textContent = '';
    el.result.innerHTML = data.count > 0
      ? renderSummary(data) + renderRows(data)
      : renderEmpty(data);

    bindAppraise();
    renderPlatforms(q);
    history.replaceState(null, '', `?q=${encodeURIComponent(q)}`);
  } catch (err) {
    el.status.innerHTML = `<span class="err">查询失败：${esc(err.message)}</span>`;
    el.result.innerHTML = '';
  } finally {
    el.go.disabled = false;
    el.go.textContent = '查价';
  }
}

/* ---------- 事件 ---------- */

function bindAppraise() {
  el.result.querySelectorAll('.row-ap').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kitId = btn.dataset.kit;
      const title = btn.dataset.title;
      const row = btn.closest('.row');

      const existing = document.querySelector(`[data-panel="${kitId}"]`);
      document.querySelectorAll('.ap-panel').forEach((p) => p.remove());
      if (existing) return;

      row.insertAdjacentHTML('afterend', renderAppraisePanel(kitId, title));
      const panel = document.querySelector(`[data-panel="${kitId}"]`);
      const input = panel.querySelector('.ap-input');
      const select = panel.querySelector('.ap-sel');

      const run = () => doAppraise(kitId, title, input.value, select.value);
      panel.querySelector('.ap-btn').addEventListener('click', run);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') run();
      });
      input.focus();
    });
  });
}

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  search(el.q.value);
});

el.hotline.addEventListener('click', (e) => {
  const btn = e.target.closest('.hot');
  if (!btn) return;
  el.q.value = btn.dataset.q;
  search(btn.dataset.q);
});

const initial = new URLSearchParams(location.search).get('q');
if (initial) {
  el.q.value = initial;
  search(initial);
}

// 调试：?demo=appraise 自动展开第一行核价面板，方便截图核对排版
if (new URLSearchParams(location.search).get('demo') === 'appraise') {
  setTimeout(() => {
    const btn = document.querySelector('.row-ap');
    if (!btn) return;
    btn.click();
    setTimeout(() => {
      const input = document.querySelector('.ap-input');
      const go = document.querySelector('.ap-btn');
      if (input && go) {
        input.value = '230';
        go.click();
      }
    }, 150);
  }, 1500);
}
