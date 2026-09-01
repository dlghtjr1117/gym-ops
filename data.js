// Supabase REST(PostgREST)를 라이브러리 설치 없이 fetch로 호출하는 공용 데이터 함수 모음
// config.js, auth.js 가 먼저 로드되어 있어야 합니다

// 매 요청 전에 access_token이 만료되지 않았는지 확인하고, 만료됐으면 자동으로 갱신해서 헤더를 만듦
// (getValidAccessToken은 auth.js에 정의되어 있고, auth.js가 이 파일보다 먼저 로드되어야 함)
async function authHeaders() {
  const token = await getValidAccessToken();
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`
  };
}

const CATEGORY_LABEL = {
  membership_new: '신규 회원권',
  membership_renewal: '회원권 재등록',
  pt_new: '신규 PT',
  pt_renewal: 'PT 재등록',
  group_pt_new: '신규 그룹PT',
  group_pt_renewal: '그룹PT 재등록',
  locker: '락커',
  clothes: '운동복',
  day_pass: '일일권',
  membership_transfer: '양도',
  uncategorized: '미분류(확인필요)',
  etc: '기타'
};

// 매출 한 건을 화면에 보여줄 때 쓸 "종목" 이름을 가장 구체적인 걸로 뽑아줌.
// 1) products.html 카탈로그 상품이 연결돼 있으면(수기 매출 입력 시 상품을 골라 등록한 경우) 그 이름을 그대로,
// 2) 연결된 상품이 없어도 POS 판매내역 엑셀 가져오기로 등록된 매출이면 메모에 남겨둔 원본 상품명(예:
//    "헬스이용권 6개월", "락커 3개월")을 정리해서 보여줌 - 이런 매출은 카테고리만 보면 "신규 회원권"처럼
//    뭉뚱그려져서 몇 개월짜리인지 안 보이는데, 메모의 원문에는 그 정보가 남아있어서 다시 뽑아낼 수 있음,
// 3) 그것도 없으면 마지막으로 카테고리 이름(예: "신규 회원권")을 보여줌
function saleDisplayItemName(sale) {
  if (sale.product && sale.product.name) return sale.product.name;
  if (sale.memo && sale.memo.includes('[엑셀 가져오기]')) {
    let text = sale.memo.replace('[엑셀 가져오기]', '').trim();
    text = text.split('· 판매번호')[0].trim();
    text = text
      .replace(/\s*\((환불|미수금)\)\s*$/, '')
      .replace(/^\([^)]+\)/, '')       // 맨 앞 지점명 태그, 예: (평산)
      .replace(/\((FC|PT)\)/, '')      // (FC)/(PT) 태그
      .replace(/외\s*\d+\s*건/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text;
  }
  return CATEGORY_LABEL[sale.category] || sale.category;
}

// 센터 매출(center-sales.html)에서 매출을 4갈래(PT/회원권/올바른(그룹PT)/기타)로 나눌 때 쓰는 기준.
// "올바른"은 지점장님이 쓰시는 그룹PT 상품 이름이라, 그룹PT 매출 카테고리를 그대로 그 항목으로 씀.
// 기타는 신규/재등록 구분이 없는 항목들(락커·운동복·일일권·양도)을 한데 모음.
const CENTER_SALES_BUCKETS = {
  pt: ['pt_new', 'pt_renewal'],
  membership: ['membership_new', 'membership_renewal'],
  group_pt: ['group_pt_new', 'group_pt_renewal'],
  etc: ['locker', 'clothes', 'day_pass', 'membership_transfer', 'uncategorized', 'etc']
};

// 매출을 FC(헬스이용권·그룹PT·운동복·락커)/PT(개인PT)로 나눌 때 쓰는 기준.
// PT만 명시적으로 판별하고, 나머지 전부를 FC로 취급해서 "총매출 = FC매출 + PT총매출"이 항상 맞도록 함
const PT_SALE_CATEGORIES = ['pt_new', 'pt_renewal'];

// 등록 처리 시 항목별로 회원 테이블의 어느 만료일 컬럼을 갱신할지 매핑
const CATEGORY_TO_MEMBER_FIELD = {
  membership_new: 'membership_end_date',
  membership_renewal: 'membership_end_date',
  pt_new: 'pt_end_date',
  pt_renewal: 'pt_end_date',
  group_pt_new: 'group_pt_end_date',
  group_pt_renewal: 'group_pt_end_date',
  locker: 'locker_end_date',
  clothes: 'workout_clothes_end_date'
};

// API 응답이 실패(res.ok=false)일 때, 화면에 실제 원인이 보이도록 서버가 준 에러 내용을 최대한 담아서 던짐
async function throwApiError(res, fallbackMsg) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body.message || body.hint || body.details || JSON.stringify(body);
  } catch (e) {
    try { detail = await res.text(); } catch (e2) { /* ignore */ }
  }
  throw new Error(`${fallbackMsg} (HTTP ${res.status}${detail ? ': ' + detail : ''})`);
}

// ---- 회원(members) ----
async function fetchMembers() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/members?select=*,trainer:profiles(name)&order=created_at.desc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '회원 목록을 불러오지 못했습니다.');
  return res.json();
}

// 이름 또는 전화번호 뒷자리 일부로 회원을 찾는 공용 검색 매칭 함수 (검색어가 없으면 false —
// "타이핑하기 전엔 아무것도 안 보여주는" 드롭다운 검색 UI용. 회원 관리 표의 "검색하면 필터링,
// 비어있으면 전체 표시"용 matchesSearch와는 용도가 달라서 별도 함수로 둠)
// PT 스케줄 예약 화면, PT 회원 관리 "회원 연결" 등에서 공용으로 씀
function matchesMemberSearch(m, query) {
  const q = (query || '').trim();
  if (!q) return false;
  const qDigits = q.replace(/[^0-9]/g, '');
  const nameMatch = m.name && m.name.toLowerCase().includes(q.toLowerCase());
  const phoneDigits = (m.phone || '').replace(/[^0-9]/g, '');
  const phoneMatch = qDigits.length > 0 && phoneDigits.includes(qDigits);
  return nameMatch || phoneMatch;
}

async function fetchTrainers() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?role=eq.trainer&select=id,name&order=name.asc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '트레이너 목록을 불러오지 못했습니다.');
  return res.json();
}

// 회원 삭제: 그 회원을 참조하는 다른 테이블 행이 있으면(외래키 제약) 회원만 단독으로는
// 못 지우기 때문에, 회원을 지우기 전에 딸린 기록들을 먼저 정리함.
// - pt_leads(PT 리드): 이 회원으로 "등록전환"된 리드가 있으면 매출/회원을 참조 중이라 못 지움
//   → 리드 자체는 남기고 연결(converted_member_id/converted_sale_id)만 풀어줌
// - pt_care_logs(PT 회원 관리), pt_bookings(PT 스케줄), tm_logs(연락 기록), sales(매출):
//   이 회원의 기록이라 매출/TM처럼 회원과 함께 지움
// - tasks(업무 리스트): 업무 자체는 지우지 않고 회원 연결만 풀어줌(단순히 참고용 태그였을 뿐이라)
// (연락 기록/매출/PT 관리·스케줄 기록까지 같이 지워진다는 걸 호출하는 쪽에서 사용자에게 미리 안내해야 함)
async function deleteMember(id) {
  const leadRes = await fetch(`${SUPABASE_URL}/rest/v1/pt_leads?converted_member_id=eq.${id}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify({ converted_member_id: null, converted_sale_id: null })
  });
  if (!leadRes.ok) await throwApiError(leadRes, '회원 삭제에 실패했습니다. (PT 리드 연결 해제 실패)');

  const careRes = await fetch(`${SUPABASE_URL}/rest/v1/pt_care_logs?member_id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders()
  });
  if (!careRes.ok) await throwApiError(careRes, '회원 삭제에 실패했습니다. (PT 회원 관리 기록 삭제 실패)');

  const bookingRes = await fetch(`${SUPABASE_URL}/rest/v1/pt_bookings?member_id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders()
  });
  if (!bookingRes.ok) await throwApiError(bookingRes, '회원 삭제에 실패했습니다. (PT 스케줄 기록 삭제 실패)');

  const taskRes = await fetch(`${SUPABASE_URL}/rest/v1/tasks?member_id=eq.${id}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify({ member_id: null })
  });
  if (!taskRes.ok) await throwApiError(taskRes, '회원 삭제에 실패했습니다. (업무 연결 해제 실패)');

  const tmRes = await fetch(`${SUPABASE_URL}/rest/v1/tm_logs?member_id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders()
  });
  if (!tmRes.ok) await throwApiError(tmRes, '회원 삭제에 실패했습니다. (연락 기록 삭제 실패)');

  const saleRes = await fetch(`${SUPABASE_URL}/rest/v1/sales?member_id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders()
  });
  if (!saleRes.ok) await throwApiError(saleRes, '회원 삭제에 실패했습니다. (매출 기록 삭제 실패)');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/members?id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders()
  });
  if (!res.ok) await throwApiError(res, '회원 삭제에 실패했습니다.');
}

// 전화번호로 기존 회원 찾기 (엑셀 업로드 시 신규/업데이트 구분용)
async function findMemberByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/members?phone=eq.${encodeURIComponent(normalized)}&select=id&limit=1`,
    { headers: await authHeaders() }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

async function updateMember(id, member) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/members?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(member)
  });
  if (!res.ok) await throwApiError(res, '회원 정보 수정에 실패했습니다.');
  return res.json();
}

async function addMember(member) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/members`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(member)
  });
  if (!res.ok) await throwApiError(res, '회원 등록에 실패했습니다.');
  return res.json();
}

// ---- 매출(sales) ----
// 정렬 기준을 sale_date(날짜)만 쓰면, 같은 날짜에 여러 건이 몰릴 때(오늘 하루에 15건 넘게 등록되는 경우 등)
// 그 안에서의 순서가 보장되지 않아서 방금 등록한 매출이 15건 제한에 밀려 안 보일 수 있음
// -> created_at(등록된 실제 시각)까지 같이 정렬 기준으로 줘서 "날짜가 같으면 최근에 등록한 순"이 되도록 보장
async function fetchRecentSales(limit = 10) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sales?select=*,member:members(name),staff:profiles(name)&order=sale_date.desc,created_at.desc&limit=${limit}`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '매출 내역을 불러오지 못했습니다.');
  return res.json();
}

// 대시보드 매출 보고(일간/주간/월간)용: [startDate, endDate) 범위(끝날짜는 미포함)의 매출을 전부 가져옴
// 날짜는 'YYYY-MM-DD' 문자열로 넘기면 됨 (예: 일간이면 오늘과 내일)
// member에 assigned_trainer_id, product에 name까지 같이 가져오는 건 센터 매출(center-sales.html)에서
// "배정 트레이너"·"종목명"을 보여주기 위함 (대시보드 등 기존 화면은 이 필드들을 안 써도 그대로 동작함)
async function fetchSalesInRange(startDate, endDate) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sales?select=*,member:members(name,assigned_trainer_id),staff:profiles(name),product:products(name)` +
    `&sale_date=gte.${startDate}&sale_date=lt.${endDate}&order=sale_date.desc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '매출 보고를 불러오지 못했습니다.');
  return res.json();
}

async function fetchThisMonthTotal() {
  const now = new Date();
  const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sales?select=amount&sale_date=gte.${firstDay}`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '매출 합계를 불러오지 못했습니다.');
  const rows = await res.json();
  return { total: rows.reduce((sum, r) => sum + Number(r.amount), 0), count: rows.length };
}

// 이번 달 재등록 확률: "이번 달에 남긴 TM 기록 중 '재등록' 상태로 남긴 비율"로 계산함
// (등록 처리를 하면 회원의 만료일 자체가 새 날짜로 덮어써지기 때문에, 원래 언제 만료 예정이었는지는
//  더 이상 알 수 없음 -> 대신 이번 달에 실제로 발생한 TM 상태 기록들 중 재등록으로 마무리된 비율로 대체)
async function fetchThisMonthRenewalRate() {
  const now = new Date();
  const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tm_logs?select=status&contact_date=gte.${firstDay}`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '이번 달 재등록 현황을 불러오지 못했습니다.');
  const rows = await res.json();
  const total = rows.length;
  const renewed = rows.filter(r => r.status === 'renewed').length;
  return { total, renewed, rate: total > 0 ? Math.round((renewed / total) * 100) : null };
}

// 등록/저장 등이 성공했을 때 화면 위쪽에 잠깐 떴다가 자동으로 사라지는 완료 알림
// (여러 화면에서 재사용할 수 있게 공용 함수로 둠 - style.css의 .toast/@keyframes toast-pop과 함께 동작)
function showToast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = type === 'danger' ? 'toast toast-danger' : 'toast'; // 삭제처럼 "주의가 필요한" 알림은 빨간색으로 구분
  el.textContent = message;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// 숫자를 0에서 목표값까지 부드럽게 증가시켜 보여줌 (대시보드/만료회원 페이지 히어로 카드에서 공통으로 사용)
function animateCount(el, target, duration = 700) {
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(target * eased).toLocaleString('ko-KR');
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// 이번 달 재등록 확률 원형 그래프 채우기 (renewalRingFg / renewalRateValue id를 가진 화면 어디서든 재사용)
function setRenewalRing(rate) {
  const circumference = 2 * Math.PI * 52; // r=52
  const fg = document.getElementById('renewalRingFg');
  fg.style.strokeDasharray = `${circumference}`;
  if (rate === null) {
    fg.style.strokeDashoffset = `${circumference}`;
    document.getElementById('renewalRateValue').textContent = '-';
    return;
  }
  const offset = circumference * (1 - rate / 100);
  requestAnimationFrame(() => { fg.style.strokeDashoffset = `${offset}`; });
  animateCount(document.getElementById('renewalRateValue'), rate);
}

async function addSale(sale) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sales`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(sale)
  });
  if (!res.ok) await throwApiError(res, '매출 등록에 실패했습니다.');
  return res.json();
}

// 여러 건을 한 번에 등록 (장바구니 방식 이용권 판매: PostgREST는 배열을 그대로 보내면 일괄 insert됨)
async function addSales(salesArray) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sales`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(salesArray)
  });
  if (!res.ok) await throwApiError(res, '매출 등록에 실패했습니다.');
  return res.json();
}

// 잘못 등록한 매출 삭제 (지점장만 가능 - RLS로도 막혀있음)
async function deleteSale(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sales?id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders()
  });
  if (!res.ok) await throwApiError(res, '매출 삭제에 실패했습니다.');
}

// 공용 페이지네이션: containerEl 안에 "◀ N / M ▶"을 그려주고, 버튼을 누르면 onChange(새페이지)를 호출함
// (회원 목록, 만료회원·TM 목록처럼 길어질 수 있는 표에서 한 번에 15개씩만 보여줄 때 공통으로 사용)
function renderPagination(containerEl, currentPage, totalItems, pageSize, onChange) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems === 0) { containerEl.innerHTML = ''; return; }
  containerEl.innerHTML = `
    <button type="button" class="report-nav-arrow" data-dir="prev" ${currentPage <= 1 ? 'disabled' : ''}>◀</button>
    <div class="muted" style="min-width:64px; text-align:center;">${currentPage} / ${totalPages}</div>
    <button type="button" class="report-nav-arrow" data-dir="next" ${currentPage >= totalPages ? 'disabled' : ''}>▶</button>
  `;
  containerEl.querySelector('[data-dir="prev"]').addEventListener('click', () => onChange(Math.max(1, currentPage - 1)));
  containerEl.querySelector('[data-dir="next"]').addEventListener('click', () => onChange(Math.min(totalPages, currentPage + 1)));
}

// HTML 속성(title 등)에 안전하게 넣기 위한 최소 이스케이프
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatWon(n) {
  return Number(n).toLocaleString('ko-KR') + '원';
}

// 매출 결제수단
const PAYMENT_METHOD_LABEL = { card: '카드', cash: '현금', transfer: '계좌이체', kiosk: '키오스크' };

// 날짜까지 남은 일수 계산 (음수면 이미 지남)
function daysRemaining(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(dateStr + 'T00:00:00');
  return Math.round((end - today) / 86400000);
}

// 만료일을 D-n 뱃지로 표시 (임박도에 따라 색 다르게)
function remainingBadge(dateStr) {
  const d = daysRemaining(dateStr);
  if (d === null) return '<span class="muted">-</span>';
  if (d < 0) return `<span class="badge badge-red">만료 D+${Math.abs(d)}</span>`;
  if (d <= 7) return `<span class="badge badge-red">D-${d}</span>`;
  if (d <= 14) return `<span class="badge badge-amber">D-${d}</span>`;
  return `<span class="badge badge-green">D-${d}</span>`;
}

// ---- 만료 회원 + TM(연락) 기록 ----
const TM_STATUS_LABEL = {
  not_contacted: '미연락',
  in_progress: '고민중',
  renewed: '재등록',
  rolled_over: '이월',
  declined: '거부',
  re_registration_planned: '재등록 예정',
  no_answer: '부재중'
};
const TM_STATUS_BADGE = {
  not_contacted: 'badge-red',
  in_progress: 'badge-amber',
  renewed: 'badge-green',
  rolled_over: 'badge-slate',
  declined: 'badge-red',
  re_registration_planned: 'badge-blue',
  no_answer: 'badge-orange'
};
// 만료회원·TM 페이지에서 직접 고를 수 있는 TM 상태 (표시 순서 그대로)
const EDITABLE_TM_STATUSES = ['renewed', 're_registration_planned', 'in_progress', 'no_answer', 'rolled_over', 'declined'];

// 만료일(회원권 또는 PT) 이 오늘 기준 daysAhead일 이내이거나 이미 지난 회원 목록
// 각 회원에 딸린 tm_logs(연락 기록)도 같이 가져와서, 가장 최근 기록으로 현재 상태를 판단
async function fetchExpiringMembers(daysAhead = 14) {
  const limitDate = new Date();
  limitDate.setDate(limitDate.getDate() + daysAhead);
  const limitStr = limitDate.toISOString().slice(0, 10);

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/members?select=*,trainer:profiles(name),tm_logs(id,status,contact_date,memo,created_at)` +
    `&status=neq.left&or=(membership_end_date.lte.${limitStr},pt_end_date.lte.${limitStr})` +
    `&order=membership_end_date.asc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '만료 예정 회원을 불러오지 못했습니다.');
  const members = await res.json();
  return members.map(m => {
    const logs = (m.tm_logs || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const latest = logs[0] || null;
    const nearestDate = [m.membership_end_date, m.pt_end_date].filter(Boolean).sort()[0] || null;
    return { ...m, latestTm: latest, nearestExpiry: nearestDate };
  });
}

// 만료 예정/만료 항목이 될 수 있는 카테고리 (만료회원·TM 페이지의 상품 필터 탭 + 상품 관리/매출 입력의
// 카테고리 탭·라벨에서 공용으로 사용). "기타"는 회원 만료일과 연결되지 않는 1회성 상품(양도비 등)이라
// field가 없음 - field가 없으면 만료 추적/재등록 통계에서는 자동으로 제외되고, 라벨 표시용으로만 쓰임
const EXPIRY_CATEGORIES = [
  { key: 'membership', field: 'membership_end_date', label: '헬스이용권' },
  { key: 'group_pt', field: 'group_pt_end_date', label: '그룹PT' },
  { key: 'pt', field: 'pt_end_date', label: '개인PT' },
  { key: 'locker', field: 'locker_end_date', label: '락커' },
  { key: 'clothes', field: 'workout_clothes_end_date', label: '운동복' },
  { key: 'etc', field: null, label: '기타' }
];

// ---- 이용권(상품) 관리 ----
// 자유 텍스트로 종목명을 입력하던 걸 대신해서, 지점장이 미리 정해둔 상품 목록에서 골라
// 가격/기간/횟수를 자동으로 채울 수 있게 함 (오타로 인한 통계 오류 방지 + 입력 실수 감소)
async function fetchProducts(activeOnly = false) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products?select=*${activeOnly ? '&active=is.true' : ''}&order=category.asc,name.asc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '이용권 상품 목록을 불러오지 못했습니다.');
  return res.json();
}

async function addProduct(product) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/products`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(product)
  });
  if (!res.ok) await throwApiError(res, '상품 등록에 실패했습니다.');
  return res.json();
}

async function updateProduct(id, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(patch)
  });
  if (!res.ok) await throwApiError(res, '상품 수정에 실패했습니다.');
  return res.json();
}

// 상품 카테고리 -> 매출 "항목" 매핑 (상품을 팔 때 매출 카테고리를 자동으로 맞춰줌.
// 재등록으로 기본값을 잡아두고, 신규로 파는 거면 화면에서 직접 "신규 ○○"로 바꾸면 됨)
const PRODUCT_CATEGORY_TO_SALE_CATEGORY = {
  membership: 'membership_renewal', group_pt: 'group_pt_renewal', pt: 'pt_renewal', locker: 'locker', clothes: 'clothes', etc: 'etc'
};

// 상품을 하나 골랐을 때, 회원 등록/수정 폼에 채워 넣을 필드값들을 계산 (종목명 + 만료일 + PT 횟수)
// EXPIRY_CATEGORIES의 field(만료일 컬럼)를 그대로 재사용해서 카테고리별로 다른 컬럼에 매핑함
function computeProductFill(product, baseDateStr) {
  const cat = EXPIRY_CATEGORIES.find(c => c.key === product.category);
  if (!cat) return {};
  const out = {};
  if (cat.field && product.duration_days != null) {
    const base = baseDateStr ? new Date(baseDateStr + 'T00:00:00') : new Date();
    base.setDate(base.getDate() + Number(product.duration_days));
    out[cat.field] = base.toISOString().slice(0, 10);
  }
  if (product.category === 'membership') out.membership_type = product.name;
  if (product.category === 'group_pt') out.group_pt_type = product.name;
  if (product.category === 'pt' && product.sessions != null) out.pt_remaining_sessions = product.sessions;
  return out;
}

// fetchExpiringMembers와 달리, 한 회원이 여러 항목(헬스이용권+그룹PT 등)이 동시에 만료 임박이면
// 항목별로 각각 한 줄(item)씩 나눠서 돌려줌 -> 만료회원·TM 페이지에서 상품별로 정확히 필터링하기 위함
async function fetchExpiringItems(daysAhead = 14) {
  const limitDate = new Date();
  limitDate.setDate(limitDate.getDate() + daysAhead);
  const limitStr = limitDate.toISOString().slice(0, 10);

  // field가 없는 카테고리(예: "기타" - 회원 만료일 컬럼과 연결 안 됨)는 만료 추적 대상이 아니므로 제외.
  // 안 걸러내면 존재하지 않는 컬럼("null")을 기준으로 필터링하게 되어 이 쿼리 자체가 HTTP 400으로 실패함
  const orClause = EXPIRY_CATEGORIES.filter(c => c.field).map(c => `${c.field}.lte.${limitStr}`).join(',');

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/members?select=*,trainer:profiles(name),tm_logs(id,status,contact_date,memo,created_at)` +
    `&status=neq.left&or=(${orClause})` +
    `&order=name.asc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '만료 예정 회원을 불러오지 못했습니다.');
  const members = await res.json();

  const items = [];
  for (const m of members) {
    const logs = (m.tm_logs || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const latestTm = logs[0] || null;
    for (const cat of EXPIRY_CATEGORIES) {
      if (!cat.field) continue;
      const endDate = m[cat.field];
      if (!endDate || endDate > limitStr) continue;
      const productLabel =
        cat.key === 'membership' ? (m.membership_type || cat.label) :
        cat.key === 'group_pt' ? (m.group_pt_type || cat.label) :
        cat.label;
      items.push({
        member: m,
        categoryKey: cat.key,
        categoryLabel: cat.label,
        productLabel,
        expiryDate: endDate,
        latestTm
      });
    }
  }
  items.sort((a, b) => (a.expiryDate < b.expiryDate ? -1 : a.expiryDate > b.expiryDate ? 1 : 0));
  return items;
}

// 등록 처리: TM 기록 남기기 + 회원 만료일(해당 항목) 갱신 + (금액 입력 시) 매출까지 한 번에 연동
async function registerRenewal({ memberId, staffId, category, newEndDate, ptRemaining, amount, memo, contactDate }) {
  const memberField = CATEGORY_TO_MEMBER_FIELD[category];
  const memberPayload = { status: 'active' };
  if (memberField && newEndDate) memberPayload[memberField] = newEndDate;
  if ((category === 'pt_new' || category === 'pt_renewal') && ptRemaining !== null && ptRemaining !== '' && ptRemaining !== undefined) {
    memberPayload.pt_remaining_sessions = Number(ptRemaining);
  }

  const results = {};
  if (Object.keys(memberPayload).length > 1) {
    results.member = await updateMember(memberId, memberPayload);
  }

  results.tmLog = await addTmLog({
    member_id: memberId,
    staff_id: staffId,
    status: 'renewed',
    contact_date: contactDate,
    memo: memo || `${CATEGORY_LABEL[category]} 등록 처리`
  });

  if (amount) {
    results.sale = await addSale({
      member_id: memberId,
      staff_id: staffId,
      category,
      amount: Number(amount),
      sale_date: contactDate,
      memo: memo || null
    });
  }

  return results;
}

// 이번 달 상품별(헬스이용권/그룹PT/개인PT) 재등록 현황 - 만료회원·TM 페이지에서 상품별로
// 남긴 TM 기록(category 컬럼)을 기준으로 실제 재등록률을 계산함.
// category 없이 저장된 옛날 기록(이 기능 추가 이전 기록)은 어느 상품인지 알 수 없어서 집계에서 제외됨.
async function fetchCategoryRenewalStats() {
  const now = new Date();
  const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tm_logs?select=status,category&contact_date=gte.${firstDay}&category=not.is.null`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '상품별 재등록 현황을 불러오지 못했습니다.');
  const rows = await res.json();

  const stats = {};
  for (const cat of EXPIRY_CATEGORIES) {
    const catRows = rows.filter(r => r.category === cat.key);
    const total = catRows.length;
    const renewed = catRows.filter(r => r.status === 'renewed').length;
    stats[cat.key] = { total, renewed, rate: total > 0 ? Math.round((renewed / total) * 100) : null };
  }
  return stats;
}

// ---- 업무(tasks) ----
const TASK_STATUS_LABEL = { todo: '할 일', in_progress: '진행중', done: '완료' };
const TASK_STATUS_BADGE = { todo: 'badge-red', in_progress: 'badge-amber', done: 'badge-green' };
const EDITABLE_TASK_STATUSES = ['todo', 'in_progress', 'done'];

// 업무 배정 대상 선택용: 트레이너뿐 아니라 지점장 본인도 자기 업무를 만들 수 있어야 하므로 전체 직원을 가져옴
async function fetchStaff() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=id,name,role&order=name.asc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '직원 목록을 불러오지 못했습니다.');
  return res.json();
}

async function fetchTasks() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tasks?select=*,assignee:profiles(id,name),member:members(name)&order=due_date.asc.nullslast,created_at.desc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '업무 목록을 불러오지 못했습니다.');
  return res.json();
}

async function addTask(task) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tasks`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(task)
  });
  if (!res.ok) await throwApiError(res, '업무 등록에 실패했습니다.');
  return res.json();
}

// 업무 내용(담당자/할 일/반복 설정/마감일)을 수정. 등록할 때 반복(매일·매주) 설정을
// 잘못 했거나 나중에 바꾸고 싶을 때, 새로 지우고 다시 만들 필요 없이 그 자리에서 고칠 수 있게 함
async function updateTask(id, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tasks?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(patch)
  });
  if (!res.ok) await throwApiError(res, '업무 수정에 실패했습니다.');
  return res.json();
}

async function updateTaskStatus(id, status) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tasks?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify({ status })
  });
  if (!res.ok) await throwApiError(res, '업무 상태 변경에 실패했습니다.');
  return res.json();
}

// ---- 업무 리스트 반복 기능 (마이크로소프트 투두 스타일) ----
// tasks 테이블에 repeat_type/repeat_weekday/last_completed_at 컬럼을 추가해서 지원함.
// "매일"/"매주 ○요일" 반복 업무는 실제로 서버에서 리셋해주는 게 아니라, 화면에서
// last_completed_at이 "이번 주기(오늘/이번 주)" 안에 있는지를 계산해서 보여주는 방식
// -> 주기가 지나면 DB값은 그대로여도 자동으로 다시 미체크 상태로 보임
const REPEAT_TYPE_LABEL = { none: '반복 없음', daily: '매일', weekly: '매주' };
const WEEKDAY_LABELS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토'];

// 업무 완료 체크: 체크하면 status를 done으로, last_completed_at을 지금 시각으로 저장.
// 해제하면 둘 다 초기화(todo/null). 반복 업무는 last_completed_at 기준으로 "이번 주기 완료 여부"를
// 다시 계산하기 때문에, 체크 시점의 status 값 자체는 반복 업무에서는 참고용일 뿐임
async function toggleTaskDone(id, done) {
  const patch = { status: done ? 'done' : 'todo', last_completed_at: done ? new Date().toISOString() : null };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tasks?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(patch)
  });
  if (!res.ok) await throwApiError(res, '업무 상태 변경에 실패했습니다.');
  return res.json();
}

function isSameLocalDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// 월요일 시작 기준 그 주의 시작 시각(00:00)을 구함
function startOfWeek(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay(); // 0=일 ... 6=토
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function isSameWeek(a, b) {
  return startOfWeek(a).getTime() === startOfWeek(b).getTime();
}

// 이 업무가 "이번 주기(반복 없음=한 번 완료하면 계속 완료 / 매일=오늘 / 매주=이번 주)" 기준으로
// 완료 처리됐는지 계산. 반복 업무는 주기가 지나면 DB값은 그대로여도 여기서 자동으로 false가 됨
function isTaskDone(item, refDate = new Date()) {
  if (item.repeat_type === 'none' || !item.repeat_type) {
    // 반복 없음: last_completed_at으로 체크했거나(신규), 예전 방식대로 status만 done인 경우(기존 업무) 모두 완료로 인정
    return !!item.last_completed_at || item.status === 'done';
  }
  if (!item.last_completed_at) return false;
  const completed = new Date(item.last_completed_at);
  if (item.repeat_type === 'daily') return isSameLocalDate(completed, refDate);
  if (item.repeat_type === 'weekly') return isSameWeek(completed, refDate);
  return false;
}

// 다음(또는 이번) 마감일 라벨 - 반복 없음이면 등록할 때 지정한 마감일을 그대로 보여줌
function taskDueLabel(item, refDate = new Date()) {
  if (item.repeat_type === 'daily') {
    return `매일 · ${refDate.getMonth() + 1}월 ${refDate.getDate()}일 (${WEEKDAY_SHORT[refDate.getDay()]})`;
  }
  if (item.repeat_type === 'weekly' && item.repeat_weekday !== null && item.repeat_weekday !== undefined) {
    const date = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
    const diff = (item.repeat_weekday - date.getDay() + 7) % 7;
    date.setDate(date.getDate() + diff);
    return `매주 ${WEEKDAY_LABELS[item.repeat_weekday]} · ${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY_SHORT[date.getDay()]})`;
  }
  return item.due_date ? `마감 ${item.due_date}` : '마감일 없음';
}

async function addTmLog(log) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tm_logs`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(log)
  });
  if (!res.ok) await throwApiError(res, 'TM 기록 등록에 실패했습니다.');
  return res.json();
}

// 전화번호 표기를 숫자만 남겨서 통일 (하이픈/공백 표기 차이로 인해 업로드할 때마다
// 같은 사람이 새 회원으로 중복 등록되는 것을 방지). 엑셀에서 숫자 형식 셀로 저장된
// 전화번호는 맨 앞 0이 사라지는 경우가 많아 그 경우도 보정함.
function normalizePhone(phone) {
  if (!phone) return null;
  let digits = phone.toString().replace(/[^0-9]/g, '');
  if (!digits) return null;
  if (digits.length === 10 && !digits.startsWith('0')) digits = '0' + digits;
  return digits;
}

// ---- 전체 데이터 백업 (홈 화면의 "데이터 백업" 버튼에서 사용, 지점장 전용) ----
// 회원/매출/TM기록/업무/상품/직원 테이블을 전부 그대로 내려받아서 엑셀 파일로 만들 수 있게 해줌.
// Claude(이 세션)나 코드가 아니라 실제 데이터베이스(Supabase)가 원본이므로, 이 백업은
// "혹시 몰라 손으로 들고 있는 사본"의 역할 — 정기적으로(특히 큰 변경 후) 눌러서 저장해두면 됨.
async function fetchAllDataForBackup() {
  const headers = await authHeaders();
  async function getRows(path, fallbackMsg) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
    if (!res.ok) await throwApiError(res, fallbackMsg);
    return res.json();
  }

  const [members, sales, tmLogs, tasks, products, staff] = await Promise.all([
    getRows('members?select=*,trainer:profiles(name)&order=created_at.asc', '회원 데이터를 불러오지 못했습니다.'),
    getRows('sales?select=*,member:members(name),staff:profiles(name)&order=sale_date.asc', '매출 데이터를 불러오지 못했습니다.'),
    getRows('tm_logs?select=*,member:members(name),staff:profiles(name)&order=contact_date.asc', 'TM 기록 데이터를 불러오지 못했습니다.'),
    getRows('tasks?select=*,assignee:profiles(name),member:members(name)&order=created_at.asc', '업무 데이터를 불러오지 못했습니다.'),
    getRows('products?select=*&order=category.asc,name.asc', '이용권 상품 데이터를 불러오지 못했습니다.'),
    getRows('profiles?select=id,name,role&order=name.asc', '직원 데이터를 불러오지 못했습니다.')
  ]);

  // 엑셀 셀에 [object Object]로 찍히지 않도록, 중첩된 트레이너/회원/직원 객체는 이름 컬럼으로 평평하게 펴줌
  function flatten(rows, nestedKeyToColumn) {
    return rows.map(row => {
      const out = { ...row };
      Object.keys(nestedKeyToColumn).forEach(nestedKey => {
        out[nestedKeyToColumn[nestedKey]] = row[nestedKey] ? row[nestedKey].name : '';
        delete out[nestedKey];
      });
      return out;
    });
  }

  return {
    members: flatten(members, { trainer: '담당트레이너' }),
    sales: flatten(sales, { member: '회원명', staff: '담당직원' }),
    tmLogs: flatten(tmLogs, { member: '회원명', staff: '담당직원' }),
    tasks: flatten(tasks, { assignee: '담당자', member: '대상회원' }),
    products,
    staff
  };
}

// ---- PT 관리 (기존 엑셀 "주간 PT 시트"를 대체) ----
// 리드 진행 단계: 상담중 -> OT예정 -> OT완료(등록대기) -> 등록완료 / 이번주에 못 끝나면 이월 / 연락두절 등은 미스
const PT_LEAD_STAGE_LABEL = {
  in_progress: '상담중',
  ot_scheduled: 'OT예정',
  ot_done: 'OT완료',
  registered: '등록완료',
  rolled_over: '이월',
  missed: '미스'
};
const PT_LEAD_STAGE_BADGE = {
  in_progress: 'badge-amber',
  ot_scheduled: 'badge-blue',
  ot_done: 'badge-slate',
  registered: 'badge-green',
  rolled_over: 'badge-slate',
  missed: 'badge-red'
};
// 리드 단계 탭에 표시할 순서
const PT_LEAD_STAGE_ORDER = ['in_progress', 'ot_scheduled', 'ot_done', 'registered', 'rolled_over', 'missed'];
// 아직 성사/미스로 끝나지 않은(=파이프라인에 살아있는) 단계 - "예상 매출" 합계 계산에 사용
const PT_LEAD_OPEN_STAGES = ['in_progress', 'ot_scheduled', 'ot_done', 'rolled_over'];

// Date -> 'YYYY-MM-DD' (로컬 기준. toISOString은 UTC라 자정 근처에서 하루 밀릴 수 있어 직접 계산함)
function formatDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// 이번 주 월요일 / 이번 달 1일 문자열 (PT 목표 조회·설정 기준일로 사용)
function thisWeekStartStr(refDate = new Date()) { return formatDateStr(startOfWeek(refDate)); }
function thisMonthStartStr(refDate = new Date()) { return `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}-01`; }

async function fetchPtLeads() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pt_leads?select=*,trainer:profiles(id,name)&order=created_at.desc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, 'PT 리드 목록을 불러오지 못했습니다.');
  return res.json();
}

async function addPtLead(lead) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_leads`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(lead)
  });
  if (!res.ok) await throwApiError(res, 'PT 리드 등록에 실패했습니다.');
  return res.json();
}

async function updatePtLead(id, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_leads?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(patch)
  });
  if (!res.ok) await throwApiError(res, 'PT 리드 수정에 실패했습니다.');
  return res.json();
}

async function deletePtLead(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_leads?id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders()
  });
  if (!res.ok) await throwApiError(res, 'PT 리드 삭제에 실패했습니다.');
}

// 리드를 실제 회원 등록 + 매출로 전환("등록 전환" 버튼)했을 때, 그 회원/매출 기록을
// pt_leads 행에 연결해서 남겨둠 (회원 생성/매출 생성 자체는 addMember/addSales를 그대로 재사용)
async function convertPtLead(leadId, { memberId, saleId }) {
  return updatePtLead(leadId, {
    stage: 'registered',
    converted_member_id: memberId || null,
    converted_sale_id: saleId || null
  });
}

// ---- PT 매출 목표(주간/월간, 트레이너별) ----
async function fetchPtTargets() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pt_targets?select=*,trainer:profiles(id,name)&order=period_start.desc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, 'PT 목표를 불러오지 못했습니다.');
  return res.json();
}

// trainer_id+period_type+period_start가 이미 있으면 덮어쓰기(upsert) - migration_18의 unique 제약을 이용
async function upsertPtTarget(target) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_targets?on_conflict=trainer_id,period_type,period_start`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify(target)
  });
  if (!res.ok) await throwApiError(res, 'PT 목표 저장에 실패했습니다.');
  return res.json();
}

// ---- 센터 매출(center-sales.html): 월별 FC 목표 (PT 목표는 pt_targets를 그대로 합산해서 씀) ----
async function fetchCenterTarget(monthStr) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/center_targets?select=*&month=eq.${monthStr}`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '센터 목표를 불러오지 못했습니다.');
  const rows = await res.json();
  return rows[0] || null;
}

async function upsertCenterTarget(monthStr, fcTargetAmount) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/center_targets?on_conflict=month`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify({ month: monthStr, fc_target_amount: fcTargetAmount })
  });
  if (!res.ok) await throwApiError(res, '센터 목표 저장에 실패했습니다.');
  return res.json();
}

// PT 잔여횟수가 적어 재등록 케어(상담)가 필요한 회원 목록 (기본: 잔여 3회 이하, 재원중인 회원만)
// + 잔여횟수와 상관없이 트레이너가 직접 "PT 회원 관리" 시트에 추가한(pt_care_pinned=true) 회원도 함께 포함
async function fetchPtCareMembers(threshold = 3) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/members?select=*,trainer:profiles(name)` +
    `&status=neq.left` +
    `&or=(and(pt_remaining_sessions.lte.${threshold},pt_remaining_sessions.not.is.null),pt_care_pinned.eq.true)` +
    `&order=pt_remaining_sessions.asc.nullslast`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, 'PT 케어 대상 회원을 불러오지 못했습니다.');
  return res.json();
}

// 회원의 PT 케어 메모(집중 포인트/단기·장기 계획/재등록 예상 시기·금액·확률) 저장
async function updateMemberPtCare(id, patch) {
  return updateMember(id, patch);
}

// ---- PT 회원 관리 월별 기록(pt_care_logs) ----
// "잔여횟수 적은 회원 자동 표시"가 아니라, 트레이너가 매달 직접 입력해서 쌓아가는 방식
// member_id가 연결된 행은 실제 회원의 개인PT 잔여횟수(members.pt_remaining_sessions)를 함께 가져와서,
// PT 스케줄에서 출석 체크로 잔여횟수가 바뀌면 이 화면에도 그대로(실시간) 반영되게 함.
// member_id가 비어있는(연결 안 된) 옛날 행은 이 행 자체에 저장된 pt_remaining_sessions 값을 그대로 씀
async function fetchPtCareLogs() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pt_care_logs?select=*,member:member_id(id,name,phone,pt_remaining_sessions)&order=period_month.desc,created_at.asc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, 'PT 회원 관리 기록을 불러오지 못했습니다.');
  return res.json();
}

async function addPtCareLog(log) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_care_logs`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(log)
  });
  if (!res.ok) await throwApiError(res, 'PT 회원 관리 기록 추가에 실패했습니다.');
  return res.json();
}

async function updatePtCareLog(id, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_care_logs?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(patch)
  });
  if (!res.ok) await throwApiError(res, 'PT 회원 관리 기록 수정에 실패했습니다.');
  return res.json();
}

async function deletePtCareLog(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_care_logs?id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders()
  });
  if (!res.ok) await throwApiError(res, 'PT 회원 관리 기록 삭제에 실패했습니다.');
}

// pt.html의 "주차별 매출 기록"이 쓰는 monthStr과 같은 'YYYY-MM' 형식 (pt_care_logs.period_month가 이 형식)
function thisPeriodMonthStr(refDate = new Date()) { return `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}`; }

// 회원 관리(members.html)에서 개인PT가 포함된 회원을 등록하면서 담당 트레이너를 같이 지정했을 때,
// 그 트레이너가 PT 관리 > PT 회원 관리 탭에서 매번 "+ PT 회원 추가"로 직접 찾아 넣지 않아도 되도록
// 자동으로 연동된 행을 만들어줌 (member_id로 바로 연결되어 있어서 잔여횟수도 실시간으로 따라감).
// 이번 달에 같은 회원이 그 트레이너 시트에 이미 있으면 중복으로 만들지 않고 그 행을 그대로 씀.
async function ensurePtCareLogForMember(memberId, memberName, trainerId) {
  const monthStr = thisPeriodMonthStr();
  const all = await fetchPtCareLogs();
  const dup = all.find(l => l.member_id === memberId && l.trainer_id === trainerId && l.period_month === monthStr);
  if (dup) return dup;
  const rows = await addPtCareLog({
    trainer_id: trainerId,
    period_month: monthStr,
    member_id: memberId,
    name: memberName,
    pt_expected_renewal_month: null,
    pt_remaining_sessions: null,
    pt_session_focus: null,
    pt_short_term_plan: null,
    pt_long_term_plan: null,
    pt_expected_sessions: null,
    pt_expected_amount: null,
    renewal_stage: 'in_progress',
    pt_expected_probability: null
  });
  return rows[0];
}

// 회원의 담당 트레이너가 바뀌었을 때, 그 회원의 "이번 달" PT 회원 관리 기록만 새 트레이너 시트로
// 옮겨줌 (트레이너 항목만 바꿔치기 - 적어뒀던 메모/계획 등은 그대로 유지됨). 지난 달까지의 기록은
// 그때 실제로 담당했던 트레이너의 이력이므로 건드리지 않고 그대로 둠.
// 새 트레이너 시트에 이미 이번 달 같은 회원 기록이 있으면(중복 방지), 잘못 배정됐던 옛 기록은 대신 지움.
async function movePtCareLogToNewTrainer(memberId, newTrainerId) {
  if (!newTrainerId) return 0; // "미지정"으로 바꾸는 경우는 pt_care_logs.trainer_id가 NOT NULL이라 옮길 수 없음 - 그대로 둠
  const monthStr = thisPeriodMonthStr();
  const all = await fetchPtCareLogs();
  const misassigned = all.filter(l => l.member_id === memberId && l.period_month === monthStr && l.trainer_id !== newTrainerId);
  if (misassigned.length === 0) return 0;
  const alreadyThere = all.find(l => l.member_id === memberId && l.period_month === monthStr && l.trainer_id === newTrainerId);
  for (const row of misassigned) {
    if (alreadyThere) {
      await deletePtCareLog(row.id);
    } else {
      await updatePtCareLog(row.id, { trainer_id: newTrainerId });
    }
  }
  return misassigned.length;
}

// ---- 직원(profiles) - 직원 관리 화면 ----
// 지점장이면 RLS 덕분에 전체 직원이 조회되고, 트레이너면 본인 행만 조회됨
async function fetchProfiles() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=id,name,role,phone,created_at&order=created_at.asc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '직원 목록을 불러오지 못했습니다.');
  return res.json();
}

// 직원 권한(트레이너 <-> 지점장) 변경. RLS 정책상 지점장만 성공함 (migration_25 필요)
async function updateProfileRole(id, role) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Prefer': 'return=minimal' },
    body: JSON.stringify({ role })
  });
  if (!res.ok) await throwApiError(res, '권한 변경에 실패했습니다.');
}

// ---- OT 연락 미응답 기록 (pt_ot_no_response) - PT 관리 > OT 관리 탭 하단 ----
async function fetchPtOtNoResponse() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pt_ot_no_response?select=*&order=period_month.desc,created_at.asc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, 'OT 미응답 기록을 불러오지 못했습니다.');
  return res.json();
}

async function addPtOtNoResponse(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_ot_no_response`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(row)
  });
  if (!res.ok) await throwApiError(res, 'OT 미응답 기록 추가에 실패했습니다.');
  return res.json();
}

async function updatePtOtNoResponse(id, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_ot_no_response?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(patch)
  });
  if (!res.ok) await throwApiError(res, 'OT 미응답 기록 수정에 실패했습니다.');
  return res.json();
}

async function deletePtOtNoResponse(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_ot_no_response?id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders()
  });
  if (!res.ok) await throwApiError(res, 'OT 미응답 기록 삭제에 실패했습니다.');
}

// ---- 미팅 기록일지(meetings.html) ----
async function fetchMeetingLogs() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/meeting_logs?select=*,author:author_id(id,name)&order=meeting_date.desc,created_at.desc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '미팅 기록을 불러오지 못했습니다.');
  return res.json();
}

async function addMeetingLog(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/meeting_logs`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(row)
  });
  if (!res.ok) await throwApiError(res, '미팅 기록 등록에 실패했습니다.');
  return res.json();
}

async function updateMeetingLog(id, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/meeting_logs?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(patch)
  });
  if (!res.ok) await throwApiError(res, '미팅 기록 수정에 실패했습니다.');
  return res.json();
}

async function deleteMeetingLog(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/meeting_logs?id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders()
  });
  if (!res.ok) await throwApiError(res, '미팅 기록 삭제에 실패했습니다.');
}

// 녹음한 오디오(Blob)를 Supabase Edge Function("transcribe-summarize")으로 보내서
// 전사(transcript)+요약(summary)을 받아옴. Edge Function 배포와 OPENAI_API_KEY 설정이
// 먼저 되어 있어야 동작함 (AI_MEETING_SETUP.md 참고)
async function transcribeAndSummarize(audioBlob) {
  const token = await getValidAccessToken();
  const form = new FormData();
  form.append('audio', audioBlob, 'recording.webm');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-summarize`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`
    },
    body: form
  });
  if (!res.ok) await throwApiError(res, 'AI 정리에 실패했습니다.');
  return res.json(); // { transcript, summary }
}

// ---- PT 스케줄(schedule.html) ----
// start_at 기준으로 [startStr, endStr) 구간(보통 1주일치)의 예약을 가져옴. 회원의 이름·전화번호·
// PT 잔여횟수를 같이 받아와야 화면에 바로 표시할 수 있어서 members를 조인해서 가져옴
async function fetchPtBookings(trainerId, startStr, endStr) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pt_bookings?trainer_id=eq.${trainerId}&start_at=gte.${startStr}&start_at=lt.${endStr}` +
    `&select=*,member:member_id(id,name,phone,pt_remaining_sessions),trainer:trainer_id(id,name)` +
    `&order=start_at.asc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, 'PT 스케줄을 불러오지 못했습니다.');
  return res.json();
}

async function addPtBooking(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_bookings`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(row)
  });
  if (!res.ok) await throwApiError(res, '예약 등록에 실패했습니다.');
  return res.json();
}

async function updatePtBooking(id, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_bookings?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(patch)
  });
  if (!res.ok) await throwApiError(res, '예약 상태 변경에 실패했습니다.');
  return res.json();
}

async function deletePtBooking(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pt_bookings?id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders()
  });
  if (!res.ok) await throwApiError(res, '예약 삭제에 실패했습니다.');
}
