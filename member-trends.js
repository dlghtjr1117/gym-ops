/* member-trends.js - 회원 관리 맨 위 "월별 회원 현황" 대시보드 (2026-10-19, 10-20 바디코디 기준으로 재작성)
   이용 회원 수 / 신규 등록 / 재등록률 / 이탈률을 숫자 + 선 그래프로 보여줌. 외부 라이브러리 없음(순수 SVG).
   ⚠ 숫자는 앱 DB의 "현재 만료일"로 과거를 역산하지 않고, 바디코디(오픈API)가 직접 계산한 값을
     bodycodi-trends.json 에 담아 그대로 보여줘요. (앱 DB로 역산하면 재등록한 회원의 만료일이 뒤로 밀려서
     과거 달 재등록률이 0~6%, 이탈률이 100%처럼 엉터리로 나옴)
   사용: MemberTrends.mount(document.getElementById('memberTrends'))  — 지점장 전용 */
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
  .mt-def { margin-top:14px; font-size:12.5px; color:var(--slate-600); }
  .mt-def summary { cursor:pointer; color:var(--slate-500); font-weight:600; }
  .mt-def ul { margin:8px 0 6px 18px; padding:0; line-height:1.7; } .mt-def p { margin:8px 0; }
  .mt-tile .ts .mx-chip { margin-right:4px; }
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



  let data = null, nMonths = 6, root = null, last = null;
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
      <div class="mt-tiles">${tile('members', '유효 회원', 'members')}${tile('new', '이번 달 신규 등록', 'new')}${tile('renew', '재등록률', 'renew')}${tile('churn', '이탈률', 'churn')}</div>
      <div class="mx-grid2">${card('members', '월별 이용 회원 수')}${card('new', '월별 신규 등록')}${card('renew', '월별 재등록률')}${card('churn', '월별 이탈률')}</div>
      <details class="mt-def"><summary>이 숫자는 어떻게 계산했나요?</summary><div id="mtDef"></div></details>`;
    el.querySelector('#mtRange').addEventListener('click', e => {
      const b = e.target.closest('button[data-n]'); if (!b) return;
      nMonths = Number(b.dataset.n);
      el.querySelectorAll('#mtRange button').forEach(x => x.classList.toggle('on', x === b));
      if (data) draw();
    });
    window.addEventListener('resize', (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => { if (data) draw(); }, 200); }; })());
    load();
  }
  async function load() {
    try {
      const res = await fetch('bodycodi-trends.json?v=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('bodycodi-trends.json 파일을 찾지 못했어요 (' + res.status + ')');
      data = await res.json();
      draw();
    } catch (err) {
      console.error('월별 회원 현황 오류', err);
      root.querySelector('#mtSub').textContent = '';
      ['members', 'new', 'renew', 'churn'].forEach(id => { const b = root.querySelector('#mx_' + id); if (b) b.innerHTML = `<div class="mt-err">불러오지 못했어요: ${(err && err.message) || err}</div>`; });
    }
  }
  const dayDiff = s => Math.floor((Date.now() - Date.parse(s + 'T00:00:00+09:00')) / 86400000);
  function draw() {
    const all = data.months.map(x => Object.assign({ monthStr: x.m }, x));
    const ms = all.slice(-nMonths);
    const range = `${monthLabel(ms[0].monthStr)} – ${monthLabel(ms[ms.length - 1].monthStr)}`;
    const pctF = v => `${(v * 100).toFixed(1)}%`;
    const asOf = data.asOf, age = dayDiff(asOf);
    const asOfTxt = `${Number(asOf.slice(5, 7))}월 ${Number(asOf.slice(8, 10))}일`;
    root.querySelector('#mtSub').innerHTML = `바디코디 기준 · ${asOfTxt} 계산` + (age > 40 ? ` <b style="color:#dc2626">· ${age}일 전 숫자예요, 새로 계산이 필요해요</b>` : '');
    const cur = all[all.length - 1], prev = all[all.length - 2];
    const meas = all.filter(x => x.renewalRate !== undefined);
    const m1 = meas[meas.length - 1], m0 = meas[meas.length - 2];
    const V = data.validMembers;
    // ---- 숫자 카드 ----
    const set = (id, big, ts) => { root.querySelector('#mtV_' + id).innerHTML = big; root.querySelector('#mtC_' + id).innerHTML = ts; };
    set('members', `${V.total}<small>명</small>`, `<span>이용 중 ${V.usableNow} · 홀딩 ${V.holding} · 이용 예정 ${V.future} (${asOfTxt} 기준)</span>`);
    set('new', `${cur.newMembers}<small>명</small>`, `<span>${cur.partial ? '이번 달 진행 중' : monthShort(cur.monthStr)} · 지난 달 ${prev.newMembers}명</span>`);
    set('renew', m1 ? pctF(m1.renewalRate) : '-', m1 ? `${m0 ? deltaChip(m1.renewalRate, m0.renewalRate, { isRate: true }) + ' ' : ''}<span>${monthShort(m1.monthStr)} 만료 회원 기준</span>` : '');
    set('churn', m1 ? pctF(m1.churnRate) : '-', m1 ? `${m0 ? deltaChip(m1.churnRate, m0.churnRate, { isRate: true, higherIsBetter: false }) + ' ' : ''}<span>${monthShort(m1.monthStr)} 만료 회원 기준</span>` : '');
    // ---- 그래프 ----
    const cfgs = [
      { id: 'members', vals: ms.map(m => m.visitors === undefined ? null : m.visitors), fmt: v => `${v}명`, isRate: false, label: '월별 이용 회원 수',
        sub: `그 달에 한 번이라도 방문한 회원(출입·수업 출석) · ${range}`, tip: i => `신규 등록 ${ms[i].newMembers}명` },
      { id: 'new', vals: ms.map(m => m.newMembers), fmt: v => `${v}명`, isRate: false, label: '월별 신규 등록', hollowLast: !!cur.partial,
        sub: `그 달 새로 등록한 회원 수(결제 기준) · ${range}`, tip: i => ms[i].partial ? `이번 달 진행 중(${asOfTxt}까지)` : `이 달 새로 결제한 회원` },
      { id: 'renew', vals: ms.map(m => m.renewalRate === undefined ? null : m.renewalRate), fmt: pctF, isRate: true, label: '월별 재등록률',
        sub: `그 달 만료된 이용권 중 30일 안에 다시 이어진 비율 · ${range}`, tip: i => `만료 ${ms[i].expiries}건 중 재등록 ${ms[i].renewed}건` },
      { id: 'churn', vals: ms.map(m => m.churnRate === undefined ? null : m.churnRate), fmt: pctF, isRate: true, label: '월별 이탈률',
        sub: `그 달 만료 후 30일 안에 이어지지 않은 비율 · ${range}`, tip: i => `만료 ${ms[i].expiries}건 중 이어지지 않음 ${ms[i].expiries - ms[i].renewed}건` }
    ];
    cfgs.forEach(c => {
      root.querySelector('#mxSub_' + c.id).textContent = c.sub;
      drawAreaChart(root.querySelector('#mx_' + c.id), ms, c);
    });
    const lastMeas = m1 ? monthLabel(m1.monthStr) : '';
    const note = m1 && ms[ms.length - 1].monthStr > m1.monthStr ? `${monthShort(m1.monthStr)} 다음 달부터는 만료 후 30일이 지나야 집계돼서 비어 있어요.` : '';
    root.querySelector('#mxNote_renew').textContent = note;
    root.querySelector('#mxNote_churn').textContent = note;
    root.querySelector('#mxNote_new').textContent = cur.partial ? `${monthShort(cur.monthStr)}은 ${asOfTxt}까지 숫자라 속이 빈 점으로 표시했어요.` : '';
    const o = data.renewalOverall;
    root.querySelector('#mtDef').innerHTML = `
      <p>모든 숫자는 <b>바디코디가 직접 계산한 값</b>이에요(앱 안에서 다시 계산하지 않아요).</p>
      <ul>
        <li><b>유효 회원</b>: 지금 이용 가능·홀딩·이용 예정 이용권을 1개 이상 가진 회원(바디코디 회원검색 '유효회원'과 같은 기준).</li>
        <li><b>월별 이용 회원</b>: 그 달에 출입 체크인이나 수업 출석이 한 번이라도 있는 회원 수.</li>
        <li><b>신규 등록</b>: 바디코디 '월간 매출 보고'의 신규등록 인원(그 달 결제일 기준).</li>
        <li><b>재등록률</b>: 그 달에 끝난 이용권(락커·운동복 제외) 중, 끝난 뒤 30일 안에 같은 종류 이용권이 이어진 비율. 최근 12개월(${o.window.replace('~', ' ~ ')}) 전체는 <b>${pctF(o.rate)}</b>(만료 ${o.expiries.toLocaleString()}건 중 ${o.renewed.toLocaleString()}건).</li>
        <li><b>이탈률</b>: 100% − 재등록률. 이용권 단위라서 헬스·PT를 따로 쓰는 회원은 각각 셉니다.</li>
      </ul>
      <p>⚠ 탈퇴 처리된 회원은 바디코디에서 조회되지 않아 재등록률이 실제보다 약간 높게(이탈률은 낮게) 나올 수 있어요.</p>`;
  }
  window.MemberTrends = { mount };
})();
