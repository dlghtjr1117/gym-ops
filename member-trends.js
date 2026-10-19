/* member-trends.js - 회원 관리 맨 위 "월별 회원 현황" 대시보드 (2026-10-19)
   월별 회원 수 / 신규 등록 / 재등록률 / 이탈률을 숫자 + 선 그래프로 보여줌. 지표 분석(metrics.html)과 같은
   계산(computeMonthlyMetrics)을 그대로 써서 두 화면 숫자가 항상 같음. 외부 라이브러리 없음(순수 SVG).
   사용: MemberTrends.mount(document.getElementById('memberTrends'))  — 지점장 전용(트레이너 화면에선 안 불러옴) */
(function () {
  const CSS = `
  :root { --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --mx-muted:#898781; --mx-grid:#e1e0d9; }
  :root[data-theme="dark"] { --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --mx-grid:#2c2c2a; }
  .mx-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
  .mx-head h2 { margin:0; }
  .mx-seg { display:inline-flex; border:1px solid var(--slate-200); border-radius:9px; padding:2px; background:var(--slate-50); }
  .mx-seg button { border:0; background:transparent; padding:5px 12px; border-radius:7px; font:inherit; font-size:12.5px; font-weight:600; color:var(--slate-500); cursor:pointer; }
  .mx-seg button.on { background:var(--surface); color:var(--slate-900); box-shadow:0 1px 2px rgba(0,0,0,.08); }
  @media (max-width: 900px) { .mx-grid2 { grid-template-columns: 1fr; } }
  .mx-top { display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .mx-chip { display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:650; padding:3px 9px; border-radius:999px; white-space:nowrap; }
  .mx-chip.up { background:#dcfce7; color:#15803d; } .mx-chip.down { background:#fee2e2; color:#b91c1c; } .mx-chip.flat { background:var(--slate-50); color:var(--slate-500); border:1px solid var(--slate-200); }
  :root[data-theme="dark"] .mx-chip.up { background:#14532d; color:#86efac; } :root[data-theme="dark"] .mx-chip.down { background:#5b1a1a; color:#fca5a5; }
  .mx-tip b.big { font-size:15px; letter-spacing:-.02em; margin:0; }
  @media (max-width: 900px) { .mx-grid { grid-template-columns: 1fr; } }
  .mx-card { background:var(--surface); border:1px solid var(--slate-200); border-radius:12px; padding:16px 16px 12px; min-width:0; }
  .mx-card h3 { margin:0; font-size:14px; font-weight:650; }
  .mx-card .mx-sub { font-size:12px; color:var(--slate-500); margin:2px 0 8px; }
  .mx-legend { display:flex; gap:14px; flex-wrap:wrap; font-size:12px; color:var(--slate-700); margin:6px 0 4px; }
  .mx-legend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px; vertical-align:-1px; }
  .mx-box { position:relative; }
  .mx-box svg { display:block; width:100%; height:auto; overflow:visible; }
  .mx-box text { font-family: inherit; }
  .mx-tip { position:absolute; pointer-events:none; z-index:5; min-width:128px; padding:8px 11px; border-radius:9px; font-size:12px; line-height:1.5; background:var(--surface); border:1px solid var(--slate-300); box-shadow:0 8px 24px rgba(0,0,0,.14); display:none; white-space:nowrap; }
  .mx-tip b { display:block; font-size:12.5px; margin-bottom:2px; }
  .mx-tip span.k { color:var(--slate-500); }
  .mx-tip i { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:6px; }
  .mx-note { font-size:11.5px; color:var(--slate-500); margin-top:6px; }
  .mx-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  @media (max-width: 900px) { .mx-grid2 { grid-template-columns:1fr; } }
  .mt-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
  .mt-head h2 { margin:0; display:flex; align-items:center; gap:8px; }
  .mt-head h2 svg { width:20px; height:20px; stroke:var(--indigo-600); fill:none; stroke-width:1.9; stroke-linecap:round; stroke-linejoin:round; }
  .mt-head .mt-sub { font-size:12.5px; color:var(--slate-500); font-weight:400; margin-left:2px; }
  .mt-tiles { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:14px; }
  @media (max-width: 1100px) { .mt-tiles { grid-template-columns:1fr 1fr; } }
  @media (max-width: 560px) { .mt-tiles { grid-template-columns:1fr; } }
  .mt-tile { background:var(--surface); border:1px solid var(--slate-200); border-radius:14px; padding:16px 18px; display:flex; flex-direction:column; gap:6px; min-width:0; }
  .mt-tile .tl { display:flex; align-items:center; gap:8px; font-size:12.5px; font-weight:600; color:var(--slate-500); }
  .mt-tile .tl .ic { width:28px; height:28px; border-radius:9px; background:var(--accent-soft); color:var(--indigo-600); display:grid; place-items:center; flex:none; }
  .mt-tile .tl svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.9; stroke-linecap:round; stroke-linejoin:round; }
  .mt-tile .tv { font-size:28px; font-weight:800; letter-spacing:-.02em; color:var(--slate-900); font-variant-numeric:tabular-nums; line-height:1.15; margin-top:4px; }
  .mt-tile .tv small { font-size:14px; font-weight:600; color:var(--slate-500); margin-left:2px; }
  .mt-tile .ts { font-size:11.5px; color:var(--slate-500); min-height:16px; }
  .mt-card-sub { font-size:12px; color:var(--slate-500); margin:2px 0 8px; }
  .mt-err { padding:14px; color:var(--slate-500); font-size:13px; }
  `;
  const ICONS = {
    members: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20.5v-.5a6 6 0 0 1 6-6h1a6 6 0 0 1 6 6v.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M21.5 20.5v-.5a6 6 0 0 0-4-5.6"/>',
    new: '<circle cx="10" cy="8" r="3.5"/><path d="M3 20.5v-.5a6 6 0 0 1 6-6h2"/><path d="M18 14v6M15 17h6"/>',
    renew: '<path d="M20 12a8 8 0 0 1-14 5.3"/><path d="M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
    churn: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5M15 12H3"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>'
  };
  const pad2 = n => String(n).padStart(2, '0');
  const monthStrOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  const addM = (s, n) => { const [y, m] = s.split('-').map(Number); return monthStrOf(new Date(y, m - 1 + n, 1)); };
  const monthLabel = s => { const [y, m] = s.split('-').map(Number); return `${y}년 ${m}월`; };
  const monthShort = s => `${Number(s.split('-')[1])}월`;
  function niceMax(v, steps) {
    if (!(v > 0)) return steps;
    const raw = v / steps, pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow, nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nf * pow * steps;
  }
  // 마우스를 올린 달 찾기 + 세로 기준선 + 말풍선
  function attachChartHover(box, n, xAt, W, tipHtml) {
    const svg = box.querySelector('svg'); if (!svg) return;
    const tip = document.createElement('div'); tip.className = 'mx-tip'; box.appendChild(tip);
    const guide = svg.querySelector('.mx-guide');
    function show(clientX) {
      const r = svg.getBoundingClientRect();
      const vx = (clientX - r.left) / r.width * W;
      let best = 0, bd = 1e9;
      for (let i = 0; i < n; i++) { const d = Math.abs(xAt(i) - vx); if (d < bd) { bd = d; best = i; } }
      if (guide) { guide.setAttribute('x1', xAt(best)); guide.setAttribute('x2', xAt(best)); guide.style.display = ''; }
      tip.innerHTML = tipHtml(best); tip.style.display = 'block';
      const px = xAt(best) / W * r.width;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(r.width - tw, px + 12 + tw > r.width ? px - tw - 12 : px + 12)) + 'px';
      tip.style.top = '8px';
    }
    function hide() { tip.style.display = 'none'; if (guide) guide.style.display = 'none'; }
    svg.addEventListener('pointermove', e => show(e.clientX));
    svg.addEventListener('pointerdown', e => show(e.clientX));
    svg.addEventListener('pointerleave', hide);
  }

  // 선+연한 면 그래프 한 장 (월별 회원 수 / 신규 등록 / 재등록률 / 이탈률 공통).
  // opts: { vals[], isRate, fmt(v), tip(i) → 말풍선 아랫줄 글, hollowLast(집계중이면 마지막 점을 속 빈 점으로), label }
  function drawAreaChart(el, months, opts) {
    const vals = opts.vals, n = months.length, isRate = !!opts.isRate;
    const W = window.innerWidth < 620 ? 360 : 520, H = 220, L = 42, R = 16, T = 22, B = 28;
    const nums = vals.filter(v => v !== null && v !== undefined);
    const maxV = isRate ? niceMax(Math.max(0.2, ...nums), 4) : niceMax(Math.max(4, ...nums), 4);
    const xAt = i => L + (n === 1 ? (W - L - R) / 2 : i / (n - 1) * (W - L - R));
    const yAt = v => T + (1 - v / maxV) * (H - T - B);
    const axis = v => isRate ? `${Math.round(v * 100)}%` : `${Math.round(v)}`;
    let g = '';
    for (let k = 0; k <= 4; k++) { const v = maxV * k / 4; g += `<line x1="${L}" x2="${W - R}" y1="${yAt(v)}" y2="${yAt(v)}" stroke="var(--mx-grid)"/><text x="${L - 8}" y="${yAt(v) + 4}" text-anchor="end" font-size="11" fill="var(--mx-muted)">${axis(v)}</text>`; }
    const step = n > 8 ? 2 : 1;
    months.forEach((m, i) => { if ((n - 1 - i) % step === 0) g += `<text x="${xAt(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--mx-muted)">${monthShort(m.monthStr)}</text>`; });
    // 값이 없는 달(null)에서 선을 끊음
    let marks = '', seg = [];
    const flush = () => {
      if (seg.length > 1) {
        const pts = seg.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
        marks += `<polygon points="${seg[0][0]},${yAt(0)} ${pts} ${seg[seg.length - 1][0]},${yAt(0)}" fill="var(--indigo-600)" fill-opacity="0.10"/><polyline points="${pts}" fill="none" stroke="var(--indigo-600)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      }
      seg = [];
    };
    vals.forEach((v, i) => { if (v === null || v === undefined) flush(); else seg.push([xAt(i), yAt(v)]); });
    flush();
    // 최고점 + 마지막 값만 직접 표기
    let mi = -1; nums.length && vals.forEach((v, i) => { if (v !== null && v !== undefined && (mi < 0 || v > vals[mi])) mi = i; });
    const li = vals.length - 1;
    if (mi >= 0 && mi !== li && vals[mi] > 0) marks += `<circle cx="${xAt(mi)}" cy="${yAt(vals[mi])}" r="3.5" fill="var(--indigo-600)" stroke="var(--surface)" stroke-width="2"/><text x="${xAt(mi)}" y="${yAt(vals[mi]) - 10}" text-anchor="${mi === 0 ? 'start' : 'middle'}" font-size="11.5" font-weight="700" fill="var(--slate-900)">최고 ${opts.fmt(vals[mi])}</text>`;
    if (vals[li] !== null && vals[li] !== undefined) {
      const hollow = opts.hollowLast;
      marks += `<circle cx="${xAt(li)}" cy="${yAt(vals[li])}" r="4.5" fill="${hollow ? 'var(--surface)' : 'var(--indigo-600)'}" stroke="${hollow ? 'var(--indigo-600)' : 'var(--surface)'}" stroke-width="2"/><text x="${xAt(li)}" y="${yAt(vals[li]) - 11}" text-anchor="end" font-size="11.5" font-weight="700" fill="var(--slate-900)">${opts.fmt(vals[li])}</text>`;
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.label}">${g}${marks}<line class="mx-guide" y1="${T}" y2="${H - B}" stroke="var(--slate-300)" stroke-dasharray="3 3" style="display:none"/></svg>`;
    attachChartHover(el, n, xAt, W, i => `<span class="k">${monthLabel(months[i].monthStr)}</span><b class="big">${vals[i] === null || vals[i] === undefined ? '-' : opts.fmt(vals[i])}</b><span class="k">${opts.tip(i)}</span>`);
  }

  // 오른쪽 위 증감 뱃지: 지난 달 대비. higherIsBetter=false(이탈률)면 올라가면 빨강
  function deltaChip(cur, prev, { isRate = false, higherIsBetter = true, unit = '' } = {}) {
    if (cur === null || cur === undefined || prev === null || prev === undefined) return '';
    const diff = isRate ? (cur - prev) * 100 : (prev !== 0 ? (cur - prev) / prev * 100 : null);
    if (diff === null) return '';
    if (Math.abs(diff) < 0.05) return '<span class="mx-chip flat">지난 달과 같아요</span>';
    const good = higherIsBetter ? diff > 0 : diff < 0;
    return `<span class="mx-chip ${good ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'} 지난 달 대비 ${diff > 0 ? '+' : '-'}${Math.abs(diff).toFixed(1)}${isRate ? '%p' : '%'}</span>`;
  }


  let raw = null, rawEarliest = null, months = 6, root = null;
  async function ensureRaw(list) {
    if (raw && rawEarliest && list[0] >= rawEarliest) return;
    rawEarliest = list[0];
    raw = await fetchMetricsRawData(list[0]);
  }
  function tile(id, title, icon) {
    return `<div class="mt-tile"><div class="tl"><span class="ic"><svg viewBox="0 0 24 24">${ICONS[icon]}</svg></span>${title}</div>` +
      `<div class="tv" id="mtV_${id}">-</div><div class="ts" id="mtC_${id}"></div></div>`;
  }
  function card(id, title) {
    return `<div class="mx-card"><div class="mx-top"><h3>${title}</h3></div><div class="mt-card-sub" id="mxSub_${id}">불러오는 중...</div>` +
      `<div class="mx-box" id="mx_${id}"></div><div class="mx-note" id="mxNote_${id}"></div></div>`;
  }
  function mount(el) {
    root = el;
    if (!document.getElementById('mt-style')) { const st = document.createElement('style'); st.id = 'mt-style'; st.textContent = CSS; document.head.appendChild(st); }
    el.innerHTML = `
      <div class="mt-head"><h2><svg viewBox="0 0 24 24">${ICONS.chart}</svg>월별 회원 현황 <span class="mt-sub" id="mtSub"></span></h2>
        <div class="mx-seg" id="mtRange"><button type="button" data-n="6" class="on">6개월</button><button type="button" data-n="12">12개월</button></div></div>
      <div class="mt-tiles">${tile('members', '이용 중인 회원', 'members')}${tile('new', '이번 달 신규 등록', 'new')}${tile('renew', '재등록률', 'renew')}${tile('churn', '이탈률', 'churn')}</div>
      <div class="mx-grid2">${card('members', '월별 회원 수')}${card('new', '월별 신규 등록')}${card('renew', '월별 재등록률')}${card('churn', '월별 이탈률')}</div>`;
    el.querySelector('#mtRange').addEventListener('click', e => {
      const b = e.target.closest('button[data-n]'); if (!b) return;
      months = Number(b.dataset.n);
      el.querySelectorAll('#mtRange button').forEach(x => x.classList.toggle('on', x === b));
      load();
    });
    window.addEventListener('resize', (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => { if (last) draw(last); }, 200); }; })());
    load();
  }
  let last = null;
  async function load() {
    try {
      const end = monthStrOf(new Date());
      const list = []; for (let i = months - 1; i >= 0; i--) list.push(addM(end, -i));
      await ensureRaw(list);
      last = list.map(m => computeMonthlyMetrics(m, raw));
      draw(last);
    } catch (err) {
      console.error('월별 회원 현황 오류', err);
      root.querySelector('#mtSub').textContent = '';
      ['members', 'new', 'renew', 'churn'].forEach(id => { const b = root.querySelector('#mx_' + id); if (b) b.innerHTML = `<div class="mt-err">불러오지 못했어요: ${(err && err.message) || err}</div>`; });
    }
  }
  function draw(ms) {
    const lastM = ms[ms.length - 1], prevM = ms.length >= 2 ? ms[ms.length - 2] : null;
    const range = `${monthLabel(ms[0].monthStr)} – ${monthLabel(lastM.monthStr)}`;
    const pend = lastM.pending > 0;
    const pctF = v => `${(v * 100).toFixed(1)}%`;
    root.querySelector('#mtSub').textContent = `${range} · 지표 분석과 같은 기준`;
    const cfgs = [
      { id: 'members', vals: ms.map(m => m.activeMemberCount), fmt: v => `${v}명`, isRate: false, label: '월별 회원 수',
        big: `${lastM.activeMemberCount}<small>명</small>`, sub: `이용 중인 회원 수 · ${range}`, chip: deltaChip(lastM.activeMemberCount, prevM && prevM.activeMemberCount),
        tip: i => `신규 ${ms[i].newMemberCount}명 · 만료 예정 ${ms[i].totalCohort}건` },
      { id: 'new', vals: ms.map(m => m.newMemberCount), fmt: v => `${v}명`, isRate: false, label: '월별 신규 등록',
        big: `${lastM.newMemberCount}<small>명</small>`, sub: `그 달 새로 등록한 회원 수 · ${range}`, chip: deltaChip(lastM.newMemberCount, prevM && prevM.newMemberCount),
        tip: i => `총 회원 ${ms[i].activeMemberCount}명 중 ${ms[i].newRate === null ? '-' : pctF(ms[i].newRate)}` },
      { id: 'renew', vals: ms.map(m => m.renewalRate), fmt: pctF, isRate: true, label: '월별 재등록률',
        big: lastM.renewalRate === null ? '-' : pctF(lastM.renewalRate), sub: `만료 예정 회원 중 재등록한 비율 · ${range}`, chip: deltaChip(lastM.renewalRate, prevM && prevM.renewalRate, { isRate: true }), hollowLast: pend,
        tip: i => `만료 예정 ${ms[i].totalCohort}건 중 재등록 ${ms[i].renewed}${ms[i].pending > 0 ? ` · 집계중 ${ms[i].pending}` : ''}` },
      { id: 'churn', vals: ms.map(m => m.churnRate), fmt: pctF, isRate: true, label: '월별 이탈률',
        big: lastM.churnRate === null ? '-' : pctF(lastM.churnRate), sub: `만료 후 30일 안에 재등록하지 않은 비율 · ${range}`, chip: deltaChip(lastM.churnRate, prevM && prevM.churnRate, { isRate: true, higherIsBetter: false }), hollowLast: pend,
        tip: i => `만료 예정 ${ms[i].totalCohort}건 중 이탈 ${ms[i].churned}${ms[i].pending > 0 ? ` · 집계중 ${ms[i].pending}` : ''}` }
    ];
    cfgs.forEach(c => {
      root.querySelector('#mtV_' + c.id).innerHTML = c.big;
      root.querySelector('#mtC_' + c.id).innerHTML = c.chip || '<span style="color:var(--slate-400)">지난 달 비교 데이터 없음</span>';
      root.querySelector('#mxSub_' + c.id).textContent = c.sub;
      drawAreaChart(root.querySelector('#mx_' + c.id), ms, c);
    });
    const note = pend ? `속이 빈 점 = ${monthLabel(lastM.monthStr)}은 아직 집계중(만료 후 30일이 안 지난 ${lastM.pending}건)이라 숫자가 더 바뀔 수 있어요.` : '';
    root.querySelector('#mxNote_renew').textContent = note;
    root.querySelector('#mxNote_churn').textContent = note;
  }
  window.MemberTrends = { mount };
})();
