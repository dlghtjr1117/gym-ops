/* ⭐ PT 3회차 만족도 조사 (연락 센터의 "만족도 조사" 탭)
 *
 * - PT를 새로 등록하고 수업을 3회 받은 회원이 자동으로 "조사 대상"에 올라와요 (migration_99의 pt_survey_candidates 함수가 계산)
 * - 회원을 누르면 질문 리스트가 열리고, 직원은 답변만 적으면 돼요
 * - 답변은 그때의 질문 글과 함께 보관돼서, 나중에 질문을 바꿔도 예전 기록은 그대로예요
 * - 질문은 지점장만 추가·수정·순서 변경·삭제할 수 있어요
 *
 * contact-center.html에서 PtSurvey.init({...}) → PtSurvey.load() → PtSurvey.render(listArea, chipRow) 순서로 써요.
 * 필요한 전역: SUPABASE_URL, authHeaders, fetchAllRows, throwApiError, showToast, escapeHtml (data.js)
 */
(function () {
  'use strict';
  const esc = (s) => escapeHtml(String(s === null || s === undefined ? '' : s));
  const SCORE_LABEL = { 1: '매우 불만족', 2: '불만족', 3: '보통', 4: '만족', 5: '매우 만족' };
  const STATUS_LABEL = { answered: '조사 완료', no_answer: '부재중', on_hold: '나중에 다시', declined: '거절' };

  let ctx = null;
  let questions = [], candidates = [], responses = [];
  let loaded = false, loadError = '', setupMissing = false;
  let sub = 'todo';                 // todo | later | done
  let trainerFilter = 'mine';       // mine | all | <trainer_id>
  let windowDays = 30;              // 3번째 수업이 N일 이내인 회원만
  let includeRenewal = false;       // 재등록도 포함?
  let searchText = '';

  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 무시 */ } }
  windowDays = [14, 30, 60, 90].includes(Number(lsGet('ptsv_days', '30'))) ? Number(lsGet('ptsv_days', '30')) : 30;
  includeRenewal = lsGet('ptsv_renewal', '0') === '1';

  function addDays(str, n) { const d = new Date(str + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function diffDays(a, b) { return Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000); }
  const md = (s) => { if (!s) return ''; const [, m, d] = String(s).slice(0, 10).split('-'); return `${Number(m)}/${Number(d)}`; };

  // ------------------------------------------------------------------ 스타일
  function injectStyle() {
    if (document.getElementById('ptsvStyle')) return;
    const st = document.createElement('style'); st.id = 'ptsvStyle';
    st.textContent = `
      .sv-card { background: var(--surface); border: 1px solid var(--slate-200); border-radius: 14px; margin-bottom: 14px; overflow: hidden; }
      .sv-card .sv-head { padding: 14px 18px; border-bottom: 1px solid var(--slate-200); font-weight: 700; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
      .sv-card .sv-head small { font-weight: 400; color: var(--slate-500); font-size: 12.5px; }
      .sv-row { display: grid; grid-template-columns: 1.3fr 1fr 1.2fr 1.3fr auto; gap: 12px; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--slate-200); }
      .sv-row:last-child { border-bottom: 0; }
      .sv-row.sv-hd { padding: 9px 18px; font-size: 12px; color: var(--slate-500); background: var(--slate-50, rgba(100,116,139,.06)); font-weight: 600; }
      .sv-name { font-weight: 700; font-size: 15px; color: var(--slate-900); }
      .sv-sub { font-size: 12px; color: var(--slate-500); margin-top: 2px; }
      .sv-pill { display: inline-block; font-size: 11.5px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: rgba(99,102,241,.12); color: var(--indigo-600, #4f46e5); }
      .sv-pill.warn { background: rgba(245,158,11,.15); color: #b45309; } .sv-pill.ok { background: rgba(16,185,129,.14); color: #047857; } .sv-pill.red { background: rgba(239,68,68,.13); color: #b91c1c; }
      .sv-empty { padding: 34px 18px; text-align: center; color: var(--slate-500); line-height: 1.7; }
      .sv-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .sv-bar select, .sv-bar input { padding: 4px 8px; border: 1px solid var(--slate-300); border-radius: 7px; background: var(--surface); color: var(--slate-900); font: inherit; font-size: 12.5px; }
      .sv-note { margin: 0 2px 12px; font-size: 12.5px; color: var(--slate-500); line-height: 1.6; }
      .sv-q { padding: 14px 0; border-bottom: 1px dashed var(--slate-200); }
      .sv-q:last-of-type { border-bottom: 0; }
      .sv-q .qt { font-weight: 700; font-size: 14.5px; margin-bottom: 8px; line-height: 1.5; }
      .sv-q .qt i { font-style: normal; color: var(--slate-400, #94a3b8); margin-right: 6px; }
      .sv-score { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
      .sv-score button { min-width: 44px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--slate-300); background: var(--surface); color: var(--slate-700, #334155); font: inherit; font-weight: 700; cursor: pointer; }
      .sv-score button.on { background: #4f46e5; border-color: #4f46e5; color: #fff; }
      .sv-ta { width: 100%; min-height: 56px; resize: vertical; padding: 9px 11px; border: 1px solid var(--slate-300); border-radius: 10px; font: inherit; background: var(--surface); color: var(--slate-900); box-sizing: border-box; }
      .sv-res { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 10px; }
      .sv-res label { padding: 7px 12px; border: 1px solid var(--slate-300); border-radius: 999px; cursor: pointer; font-size: 13px; font-weight: 600; }
      .sv-res input { display: none; } .sv-res label.on { background: rgba(79,70,229,.12); border-color: #4f46e5; color: #4f46e5; }
      .sv-ed { display: grid; grid-template-columns: 28px 1fr 118px auto; gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--slate-200); }
      .sv-ed textarea { min-height: 44px; }
      .sv-ed .ic { border: 1px solid var(--slate-300); background: var(--surface); border-radius: 7px; cursor: pointer; padding: 3px 7px; color: var(--slate-600); }
      @media (max-width: 760px) { .sv-row { grid-template-columns: 1fr; gap: 6px; } .sv-row.sv-hd { display: none; } .sv-ed { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------------ 데이터
  async function load() {
    injectStyle();
    loadError = ''; setupMissing = false;
    try {
      const headers = await authHeaders();
      const qRes = await fetchAllRows('pt_survey_questions?select=*&order=position.asc,created_at.asc', headers);
      if (qRes.error) { setupMissing = true; throw new Error('pt_survey_questions'); }
      questions = qRes.rows;
      const rRes = await fetchAllRows('pt_survey_responses?select=*,member:member_id(id,name,phone),trainer:trainer_id(name),staff:staff_id(name)&order=created_at.desc,id.asc', headers);
      if (rRes.error) { setupMissing = true; throw new Error('pt_survey_responses'); }
      responses = rRes.rows;
      const cRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pt_survey_candidates`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_days: Math.max(windowDays, 90), p_include_renewal: includeRenewal })
      });
      if (!cRes.ok) { setupMissing = true; throw new Error('pt_survey_candidates'); }
      candidates = await cRes.json();
      loaded = true;
    } catch (e) {
      if (!setupMissing) loadError = e.message || String(e);
    }
    notifyCount();
  }

  // 한 PT 등록 건(sale_id)의 가장 최근 답변
  function latestResp(c) { return responses.find(r => r.member_id === c.member_id && (r.sale_id === c.sale_id)) || null; }

  function buckets() {
    const today = ctx.today;
    const todo = [], later = [];
    candidates.forEach(c => {
      if (c.third_date < addDays(today, -windowDays)) return;           // 3회차 도달한 지 오래된 건은 제외
      const r = latestResp(c);
      if (r && (r.status === 'answered' || r.status === 'declined')) return;
      const item = { c, r, due: r && r.next_contact_date ? r.next_contact_date : null };
      if (r && r.next_contact_date && r.next_contact_date > today) later.push(item); else todo.push(item);
    });
    const done = [];
    const seen = new Set();
    responses.forEach(r => {            // 최신순이므로 첫 번째가 최신
      const k = r.member_id + '|' + (r.sale_id || r.id);
      if (seen.has(k)) return; seen.add(k);
      if (r.status === 'answered' || r.status === 'declined') done.push(r);
    });
    todo.sort((a, b) => (a.due || '0') < (b.due || '0') ? -1 : (a.c.third_date < b.c.third_date ? -1 : 1));
    later.sort((a, b) => a.due < b.due ? -1 : 1);
    return { todo, later, done };
  }

  function ownerPass(trainerId) {
    if (trainerFilter === 'all') return true;
    if (trainerFilter === 'mine') return ctx.isManager ? true : (trainerId === ctx.me.id);
    return trainerId === trainerFilter;
  }
  function searchPass(name, phone) {
    const q = searchText.trim().toLowerCase(); if (!q) return true;
    const qd = q.replace(/\D/g, '');
    return String(name || '').toLowerCase().includes(q) || (qd && String(phone || '').replace(/\D/g, '').includes(qd));
  }

  function notifyCount() { try { ctx && ctx.onCount && ctx.onCount(pendingCount()); } catch (e) { /* 무시 */ } }
  function pendingCount() {
    if (!loaded) return 0;
    return buckets().todo.filter(x => ctx.isManager || x.c.trainer_id === ctx.me.id).length;
  }

  // ------------------------------------------------------------------ 목록 화면
  function trainerOptions() {
    const map = {};
    candidates.forEach(c => { if (c.trainer_id) map[c.trainer_id] = c.trainer_name || '담당 미상'; });
    responses.forEach(r => { if (r.trainer_id && r.trainer) map[r.trainer_id] = r.trainer.name; });
    return Object.entries(map).sort((a, b) => a[1].localeCompare(b[1], 'ko'));
  }

  function render(listArea, chipRow) {
    injectStyle();
    if (setupMissing) {
      chipRow.innerHTML = '';
      listArea.innerHTML = `<div class="sv-card"><div class="sv-empty">⚠ <b>만족도 조사 기능을 처음 쓰려면 한 번만 설정이 필요해요.</b><br/>Supabase SQL Editor에서 <code>migration_99_pt_survey.sql</code> 파일 내용을 실행해주세요.<br/>실행하고 이 페이지를 새로고침하면 바로 쓸 수 있어요.</div></div>`;
      return;
    }
    if (loadError) { chipRow.innerHTML = ''; listArea.innerHTML = `<div class="sv-card"><div class="sv-empty">불러오지 못했어요: ${esc(loadError)}</div></div>`; return; }
    if (!loaded) { chipRow.innerHTML = ''; listArea.innerHTML = '<div class="sv-card"><div class="sv-empty">불러오는 중...</div></div>'; return; }

    const b = buckets();
    const f = (x) => ownerPass(x.c.trainer_id) && searchPass(x.c.member_name, x.c.member_phone);
    const todo = b.todo.filter(f), later = b.later.filter(f);
    const done = b.done.filter(r => ownerPass(r.trainer_id) && searchPass(r.member && r.member.name, r.member && r.member.phone));
    const tOpts = trainerOptions();
    const tabs = [['todo', `조사 대상 (${todo.length})`], ['later', `다시 연락 예정 (${later.length})`], ['done', `✅ 완료 보관함 (${done.length})`]];
    chipRow.innerHTML = tabs.map(([k, l]) => `<button class="filter-tab ${sub === k ? 'active' : ''}" data-svsub="${k}">${l}</button>`).join('') +
      `<span class="sv-bar" style="margin-left:auto;">
        <select id="svTrainer"><option value="mine" ${trainerFilter === 'mine' ? 'selected' : ''}>${ctx.isManager ? '전체 트레이너' : '내 담당 회원'}</option>${ctx.isManager ? '' : `<option value="all" ${trainerFilter === 'all' ? 'selected' : ''}>전체 트레이너</option>`}${tOpts.map(([id, n]) => `<option value="${esc(id)}" ${trainerFilter === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <select id="svDays">${[14, 30, 60, 90].map(n => `<option value="${n}" ${n === windowDays ? 'selected' : ''}>3회차 후 ${n}일 이내</option>`).join('')}</select>
        <select id="svRenew"><option value="0" ${!includeRenewal ? 'selected' : ''}>신규 등록만</option><option value="1" ${includeRenewal ? 'selected' : ''}>신규 + 재등록</option></select>
        ${ctx.isManager ? '<button class="btn btn-secondary" id="svEditQ" style="width:auto;padding:5px 12px;font-size:12.5px;">✏️ 질문 편집</button>' : ''}
      </span>`;

    let html = '';
    if (sub === 'todo' || sub === 'later') {
      const list = sub === 'todo' ? todo : later;
      html += `<p class="sv-note">PT를 등록하고 수업을 <b>3회</b> 받은 회원이 자동으로 올라와요. 회원을 눌러 질문 리스트를 열고 <b>답변만 적으면</b> 완료 보관함에 저장돼요. (3회차에 도달한 지 ${windowDays}일이 지나면 목록에서 빠져요)</p>`;
      if (!list.length) {
        html += `<div class="sv-card"><div class="sv-empty">${sub === 'todo' ? '🎉 지금 조사할 회원이 없어요.<br/>PT 수업이 3회 진행된 회원이 생기면 여기에 자동으로 나타나요.' : '다시 연락하기로 잡아둔 회원이 없어요.'}</div></div>`;
      } else {
        html += `<div class="sv-card"><div class="sv-row sv-hd"><div>회원</div><div>담당 트레이너</div><div>PT 등록 · 진행</div><div>${sub === 'todo' ? '3회차 도달' : '다시 연락일'}</div><div></div></div>` + list.map(x => {
          const c = x.c, ago = diffDays(ctx.today, c.third_date);
          const st = x.r ? `<span class="sv-pill warn">${esc(STATUS_LABEL[x.r.status] || '')}${x.r.next_contact_date ? ' · ' + md(x.r.next_contact_date) : ''}</span>` : '';
          const lateTag = sub === 'todo' && x.due && x.due < ctx.today ? '<span class="sv-pill red">밀림</span>' : '';
          return `<div class="sv-row">
            <div><div class="sv-name">${esc(c.member_name)} ${lateTag}</div><div class="sv-sub">${esc(c.member_phone || '')}</div></div>
            <div>${esc(c.trainer_name || '-')}</div>
            <div>${md(c.sale_date)} 등록 · <b>${c.attended_count}회</b> 출석${c.pt_remaining_sessions != null ? `<div class="sv-sub">남은 ${c.pt_remaining_sessions}회</div>` : ''}</div>
            <div>${sub === 'todo' ? `${md(c.third_date)} <span class="sv-sub" style="display:inline;">(${ago <= 0 ? '오늘' : ago + '일 전'})</span> ${st}` : `${md(x.due)} ${st}`}</div>
            <div><button class="btn btn-primary" data-svopen="${esc(c.member_id)}|${esc(c.sale_id)}" style="width:auto;padding:7px 14px;font-size:13px;">조사하기</button></div>
          </div>`;
        }).join('') + '</div>';
      }
    } else {
      if (!done.length) html += '<div class="sv-card"><div class="sv-empty">아직 완료된 조사가 없어요.</div></div>';
      else {
        const scoreAvg = (r) => { const s = (r.answers || []).filter(a => a.kind === 'score' && a.score).map(a => a.score); return s.length ? (s.reduce((a, b) => a + b, 0) / s.length) : null; };
        html += `<div class="sv-card"><div class="sv-row sv-hd"><div>회원</div><div>담당 트레이너</div><div>조사일 · 직원</div><div>평균 점수 / 상태</div><div></div></div>` + done.map(r => {
          const av = scoreAvg(r);
          return `<div class="sv-row">
            <div><div class="sv-name">${esc(r.member ? r.member.name : '(삭제된 회원)')}</div><div class="sv-sub">${esc(r.member ? r.member.phone || '' : '')}</div></div>
            <div>${esc(r.trainer ? r.trainer.name : '-')}</div>
            <div>${md(r.contact_date)} · ${esc(r.staff ? r.staff.name : '-')}</div>
            <div>${r.status === 'declined' ? '<span class="sv-pill red">조사 거절</span>' : (av !== null ? `<span class="sv-pill ok">평균 ${av.toFixed(1)}점</span>` : '<span class="sv-pill ok">조사 완료</span>')}</div>
            <div><button class="btn btn-secondary" data-svview="${esc(r.id)}" style="width:auto;padding:6px 12px;font-size:12.5px;">답변 보기</button></div>
          </div>`;
        }).join('') + '</div>';
      }
    }
    listArea.innerHTML = html;
  }

  // ------------------------------------------------------------------ 조사 모달
  function overlay() {
    let ov = document.getElementById('svModal');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'svModal'; ov.className = 'modal-overlay'; ov.style.display = 'none';
      ov.innerHTML = '<div class="modal-box" id="svBox" style="max-width:640px; max-height:90vh; overflow:auto;"></div>';
      document.body.appendChild(ov);
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeModal(); });
    }
    return ov;
  }
  function closeModal() { overlay().style.display = 'none'; }
  function openModal(html) { const ov = overlay(); document.getElementById('svBox').innerHTML = html; ov.style.display = ''; return document.getElementById('svBox'); }

  function openSurvey(c, existing) {
    const snapshot = existing && existing.answers && existing.answers.length;
    const qs = snapshot
      ? existing.answers.map(a => ({ id: a.qid, question: a.question, kind: a.kind || 'text' }))
      : questions.filter(q => q.active).map(q => ({ id: q.id, question: q.question, kind: q.kind }));
    const ans = {};
    (existing && existing.answers || []).forEach(a => { ans[a.qid] = { score: a.score || null, answer: a.answer || '' }; });
    const status0 = existing ? existing.status : 'answered';
    const who = existing && existing.member ? existing.member : { name: c.member_name, phone: c.member_phone };
    const trainerName = existing ? (existing.trainer && existing.trainer.name) : c.trainer_name;
    const box = openModal(`
      <div class="modal-header"><div><h3>⭐ PT 만족도 조사 · ${esc(who.name)}</h3>
        <div class="muted" style="font-size:12.5px;">${who.phone ? `<a href="tel:${esc(String(who.phone).replace(/\D/g, ''))}">${esc(who.phone)}</a> · ` : ''}담당 ${esc(trainerName || '-')}${c ? ` · ${md(c.sale_date)} 등록 · ${c.attended_count}회 출석` : ''}</div></div>
        <button class="modal-close" id="svClose" type="button">×</button></div>
      ${qs.length ? '' : '<p class="muted">질문이 아직 없어요. 지점장이 "질문 편집"에서 질문을 추가해주세요.</p>'}
      <div id="svQs">${qs.map((q, i) => `
        <div class="sv-q" data-qid="${esc(q.id)}" data-kind="${esc(q.kind)}">
          <div class="qt"><i>Q${i + 1}</i>${esc(q.question)}</div>
          ${q.kind === 'score' ? `<div class="sv-score">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-score="${n}" class="${ans[q.id] && ans[q.id].score === n ? 'on' : ''}" title="${SCORE_LABEL[n]}">${n}</button>`).join('')}<span class="muted" style="align-self:center;font-size:12px;">1 매우 불만족 ~ 5 매우 만족</span></div>` : ''}
          <textarea class="sv-ta" placeholder="${q.kind === 'score' ? '이유나 한 줄 의견 (선택)' : '회원님 답변을 적어주세요'}">${esc(ans[q.id] ? ans[q.id].answer : '')}</textarea>
        </div>`).join('')}</div>
      <div style="margin-top:12px; font-weight:700; font-size:13.5px;">연락 결과</div>
      <div class="sv-res" id="svRes">
        ${[['answered', '✅ 통화 완료 (답변 저장)'], ['no_answer', '📵 부재중 (내일 다시)'], ['on_hold', '⏳ 나중에 다시'], ['declined', '🚫 조사 거절']].map(([k, l]) => `<label class="${status0 === k ? 'on' : ''}"><input type="radio" name="svStatus" value="${k}" ${status0 === k ? 'checked' : ''}/>${l}</label>`).join('')}
      </div>
      <div id="svNextRow" style="display:${status0 === 'on_hold' ? '' : 'none'}; margin-bottom:8px;"><label class="muted" style="font-size:12.5px;">다시 연락할 날짜 </label><input type="date" id="svNext" value="${esc(existing && existing.next_contact_date || addDays(ctx.today, 3))}" class="sv-ta" style="width:auto;min-height:0;padding:6px 9px;"/></div>
      <textarea class="sv-ta" id="svMemo" placeholder="메모 (선택) — 전체 느낌, 후속 조치 등" style="min-height:48px;">${esc(existing && existing.memo || '')}</textarea>
      <div id="svMsg" style="color:#dc2626; font-size:12.5px; margin-top:6px; display:none;"></div>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:14px;">
        <button class="btn btn-secondary" id="svCancel" type="button" style="width:auto;">닫기</button>
        <button class="btn btn-primary" id="svSave" type="button" style="width:auto;">저장</button>
      </div>`);
    box.querySelector('#svClose').onclick = box.querySelector('#svCancel').onclick = closeModal;
    box.querySelectorAll('.sv-score button').forEach(btn => btn.addEventListener('click', () => {
      const wrap = btn.parentElement, on = btn.classList.contains('on');
      wrap.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      if (!on) btn.classList.add('on');
    }));
    box.querySelectorAll('#svRes input').forEach(inp => inp.addEventListener('change', () => {
      box.querySelectorAll('#svRes label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
      box.querySelector('#svNextRow').style.display = inp.value === 'on_hold' && inp.checked ? '' : 'none';
    }));
    box.querySelector('#svSave').onclick = async () => {
      const status = box.querySelector('#svRes input:checked').value;
      const msg = box.querySelector('#svMsg'); msg.style.display = 'none';
      const answers = [...box.querySelectorAll('.sv-q')].map(el => {
        const sc = el.querySelector('.sv-score button.on');
        return { qid: el.dataset.qid, question: el.querySelector('.qt').textContent.replace(/^Q\d+/, ''), kind: el.dataset.kind, score: sc ? Number(sc.dataset.score) : null, answer: el.querySelector('textarea').value.trim() };
      });
      if (status === 'answered' && !answers.some(a => a.answer || a.score)) { msg.textContent = '답변을 한 가지라도 적어주세요. (연락이 안 됐다면 결과를 "부재중"으로 바꿔주세요)'; msg.style.display = ''; return; }
      let next = null;
      if (status === 'no_answer') next = addDays(ctx.today, 1);
      if (status === 'on_hold') { next = box.querySelector('#svNext').value; if (!next) { msg.textContent = '다시 연락할 날짜를 골라주세요.'; msg.style.display = ''; return; } }
      const body = {
        status, answers: status === 'answered' ? answers : (existing ? answers : []), memo: box.querySelector('#svMemo').value.trim() || null,
        next_contact_date: next, contact_date: ctx.today, staff_id: ctx.me.id, updated_at: new Date().toISOString()
      };
      const btn = box.querySelector('#svSave'); btn.disabled = true;
      try {
        const headers = { ...(await authHeaders()), 'Prefer': 'return=representation' };
        let row;
        if (existing) {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_survey_responses?id=eq.${existing.id}&select=*,member:member_id(id,name,phone),trainer:trainer_id(name),staff:staff_id(name)`, { method: 'PATCH', headers, body: JSON.stringify(body) });
          if (!res.ok) await throwApiError(res, '저장하지 못했어요.');
          row = (await res.json())[0];
          responses = responses.map(r => r.id === existing.id ? row : r);
        } else {
          body.member_id = c.member_id; body.sale_id = c.sale_id; body.trainer_id = c.trainer_id || null;
          const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_survey_responses?select=*,member:member_id(id,name,phone),trainer:trainer_id(name),staff:staff_id(name)`, { method: 'POST', headers, body: JSON.stringify(body) });
          if (!res.ok) await throwApiError(res, '저장하지 못했어요.');
          row = (await res.json())[0];
          responses.unshift(row);
        }
        closeModal();
        showToast(status === 'answered' ? '답변을 저장했어요. 완료 보관함에서 다시 볼 수 있어요.' : status === 'declined' ? '조사 거절로 기록했어요.' : '다시 연락하기로 기록했어요.');
        notifyCount(); ctx.rerender();
      } catch (err) { msg.textContent = err.message || String(err); msg.style.display = ''; btn.disabled = false; }
    };
  }

  // ------------------------------------------------------------------ 질문 편집 (지점장)
  function openEditor() {
    const draw = () => {
      const box = openModal(`
        <div class="modal-header"><div><h3>✏️ 만족도 질문 편집</h3><div class="muted" style="font-size:12.5px;">바꾸는 즉시 저장돼요. 이미 저장된 답변에는 그때의 질문이 그대로 남아요. 빼고 싶은 질문은 "사용 안 함"으로 두면 돼요.</div></div>
          <button class="modal-close" id="svClose" type="button">×</button></div>
        <div id="svEdList">${questions.map((q, i) => `
          <div class="sv-ed" data-id="${esc(q.id)}">
            <div style="display:flex;flex-direction:column;gap:2px;"><button class="ic" data-mv="-1" ${i === 0 ? 'disabled' : ''}>▲</button><button class="ic" data-mv="1" ${i === questions.length - 1 ? 'disabled' : ''}>▼</button></div>
            <textarea class="sv-ta" data-f="question">${esc(q.question)}</textarea>
            <div><select data-f="kind" class="sv-ta" style="min-height:0;padding:6px;"><option value="text" ${q.kind === 'text' ? 'selected' : ''}>글 답변</option><option value="score" ${q.kind === 'score' ? 'selected' : ''}>5점 + 의견</option></select>
              <label style="font-size:12px;display:block;margin-top:5px;"><input type="checkbox" data-f="active" ${q.active ? 'checked' : ''}/> 사용</label></div>
            <button class="ic" data-del="1" title="삭제">🗑</button>
          </div>`).join('') || '<p class="muted">질문이 없어요. 아래에서 추가해주세요.</p>'}</div>
        <div style="display:flex;gap:8px;margin-top:14px;justify-content:space-between;">
          <button class="btn btn-secondary" id="svAddQ" style="width:auto;">➕ 질문 추가</button>
          <button class="btn btn-primary" id="svDone" style="width:auto;">완료</button></div>`);
      const hdr = async () => ({ ...(await authHeaders()), 'Prefer': 'return=representation', 'Content-Type': 'application/json' });
      box.querySelector('#svClose').onclick = box.querySelector('#svDone').onclick = () => { closeModal(); ctx.rerender(); };
      box.querySelector('#svAddQ').onclick = async () => {
        const pos = questions.length ? Math.max(...questions.map(q => q.position)) + 1 : 1;
        const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_survey_questions`, { method: 'POST', headers: await hdr(), body: JSON.stringify({ position: pos, question: '새 질문을 입력해주세요', kind: 'text', active: true }) });
        if (!res.ok) return showToast('추가하지 못했어요.', 'error');
        questions.push((await res.json())[0]); draw();
      };
      box.querySelectorAll('.sv-ed').forEach(row => {
        const id = row.dataset.id, q = questions.find(x => x.id === id);
        const patch = async (obj) => {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_survey_questions?id=eq.${id}`, { method: 'PATCH', headers: await hdr(), body: JSON.stringify(obj) });
          if (!res.ok) { showToast('저장하지 못했어요. 지점장 계정인지 확인해주세요.', 'error'); return false; }
          Object.assign(q, obj); return true;
        };
        row.querySelectorAll('[data-f]').forEach(el => el.addEventListener('change', () => {
          const f = el.dataset.f; patch({ [f]: f === 'active' ? el.checked : el.value.trim() || q[f] });
        }));
        row.querySelector('[data-del]').onclick = async () => {
          if (!confirm('이 질문을 삭제할까요? (이미 저장된 답변 기록은 그대로 남아요)')) return;
          const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_survey_questions?id=eq.${id}`, { method: 'DELETE', headers: await hdr() });
          if (!res.ok) return showToast('삭제하지 못했어요.', 'error');
          questions = questions.filter(x => x.id !== id); draw();
        };
        row.querySelectorAll('[data-mv]').forEach(btn => btn.onclick = async () => {
          const i = questions.findIndex(x => x.id === id), j = i + Number(btn.dataset.mv);
          if (j < 0 || j >= questions.length) return;
          const a = questions[i], b = questions[j];
          const pa = a.position, pb = b.position === a.position ? a.position + Number(btn.dataset.mv) : b.position;
          await Promise.all([
            fetch(`${SUPABASE_URL}/rest/v1/pt_survey_questions?id=eq.${a.id}`, { method: 'PATCH', headers: await hdr(), body: JSON.stringify({ position: pb }) }),
            fetch(`${SUPABASE_URL}/rest/v1/pt_survey_questions?id=eq.${b.id}`, { method: 'PATCH', headers: await hdr(), body: JSON.stringify({ position: pa }) })
          ]);
          a.position = pb; b.position = pa;
          questions.sort((x, y) => x.position - y.position); draw();
        });
      });
    };
    draw();
  }

  // ------------------------------------------------------------------ 이벤트 (contact-center가 listArea/chipRow에 위임으로 연결)
  function handleClick(e) {
    const t = e.target;
    const sb = t.closest('[data-svsub]'); if (sb) { sub = sb.dataset.svsub; ctx.rerender(); return true; }
    const op = t.closest('[data-svopen]');
    if (op) {
      const [mid, sid] = op.dataset.svopen.split('|');
      const c = candidates.find(x => x.member_id === mid && x.sale_id === sid); if (!c) return true;
      openSurvey(c, latestResp(c) && latestResp(c).status !== 'answered' && latestResp(c).status !== 'declined' ? null : latestResp(c));
      return true;
    }
    const vw = t.closest('[data-svview]');
    if (vw) { const r = responses.find(x => x.id === vw.dataset.svview); if (r) openSurvey(candidates.find(x => x.member_id === r.member_id && x.sale_id === r.sale_id) || null, r); return true; }
    if (t.closest('#svEditQ')) { openEditor(); return true; }
    return false;
  }
  async function handleChange(e) {
    const id = e.target.id;
    if (id === 'svTrainer') { trainerFilter = e.target.value; ctx.rerender(); return true; }
    if (id === 'svDays') { windowDays = Number(e.target.value); lsSet('ptsv_days', String(windowDays)); ctx.rerender(); return true; }
    if (id === 'svRenew') { includeRenewal = e.target.value === '1'; lsSet('ptsv_renewal', includeRenewal ? '1' : '0'); await load(); ctx.rerender(); return true; }
    return false;
  }

  window.PtSurvey = {
    init(c) { ctx = c; if (!ctx.isManager) trainerFilter = 'mine'; },
    load, render, handleClick, handleChange, pendingCount,
    setSearch(s) { searchText = s || ''; }
  };
})();
