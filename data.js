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

// "매출 입력"·대시보드의 "최근 매출 내역" 표에서 쓰는 "항목" 표시용 - 카테고리만 보여주면(예: "회원권 재등록")
// 일일입장권인지 12개월권인지 구체적으로 뭘 팔았는지 안 보여서, saleDisplayItemName()으로 구체적인 상품명을
// 알 수 있으면 "상품명(카테고리)" 형태로(예: "일일입장권(회원권 재등록)") 같이 보여줌. 구체적인 이름을
// 못 찾아서 결국 카테고리 이름으로 떨어지는 경우(saleDisplayItemName의 3번째 폴백)는 괄호를 중복으로
// 안 붙이고 카테고리 이름만 그대로 보여줌.
function saleDisplayItemWithCategory(sale) {
  const itemName = saleDisplayItemName(sale);
  const categoryLabel = CATEGORY_LABEL[sale.category] || sale.category;
  if (itemName && itemName !== categoryLabel) return `${itemName}(${categoryLabel})`;
  return categoryLabel;
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

// Supabase(PostgREST)는 요청에 limit/offset을 안 주면 서버 기본 설정상 최대 반환 행수(보통 1000행)에서
// "에러 없이 조용히" 잘려서 돌아옴. 회원 수가 적을 땐 문제가 안 되다가, 어느 시점부터 전체 행수가
// 그 기준을 넘으면 뒤쪽 데이터(예: 새로 대량 등록한 회원들 중 일부)가 화면에서 통째로 안 보이게 됨 -
// 실제로 바디코디 회원 1,734명을 일괄 등록한 뒤 이 문제가 발생해서(회원 검색에 안 뜨는 회원 존재) 추가함.
// 결과가 빈 배열로 끝날 때까지 반복 조회해서 실제 전체 행을 다 가져옴.
async function fetchAllRows(pathWithQuery, headers) {
  const pageSize = 1000;
  let offset = 0;
  let all = [];
  const sep = pathWithQuery.includes('?') ? '&' : '?';
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathWithQuery}${sep}limit=${pageSize}&offset=${offset}`, { headers });
    if (!res.ok) return { error: res };
    const page = await res.json();
    all = all.concat(page);
    if (page.length === 0) break;
    offset += page.length;
  }
  return { rows: all };
}

// ---- 회원(members) ----
async function fetchMembers() {
  const { rows, error } = await fetchAllRows('members?select=*,trainer:profiles(name)&order=created_at.desc', await authHeaders());
  if (error) await throwApiError(error, '회원 목록을 불러오지 못했습니다.');
  return rows;
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
  // product:products(name)까지 같이 가져와야 "항목" 칸에 saleDisplayItemWithCategory()로 "일일입장권(회원권
  // 재등록)"처럼 구체적인 상품명을 같이 보여줄 수 있음(상품 연결 없이 직접 입력한 매출은 그냥 null로 옴)
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sales?select=*,member:members(name),staff:profiles(name),product:products(name)&order=sale_date.desc,created_at.desc&limit=${limit}`,
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

// ---- 미수금(분할 결제) ----
// "정상가로 등록은 하되, 오늘은 계약금만 받고 잔금은 나중에 받는" 경우를 위한 기능. sales 테이블
// 자체는 항상 "그날 실제로 받은 금액"만 기록하도록 그대로 두고(카드/현금 매출 집계가 항상 실제 입금액과
// 일치하도록), 아직 못 받은 나머지 금액만 receivables 테이블에 따로 남겨둠. 나중에 잔금을 받으면 그
// 시점에 새 매출(sales)이 하나 더 생기고(그날의 실제 매출로 잡힘), receivables의 paid_amount가 그만큼
// 올라가서 다 받으면 자동으로 완결(settled) 처리됨. 회원 관리(members.html)의 신규 등록·재등록 화면
// 양쪽에서 공통으로 씀.

async function fetchOpenReceivablesByMember(memberId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/receivables?member_id=eq.${memberId}&status=eq.open&order=created_at.asc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '미수금 내역을 불러오지 못했습니다.');
  return res.json();
}

// 회원 목록 화면에서 "미수금 있음" 뱃지를 보여주기 위한 가벼운 조회 - member_id만 받아서 Set으로 씀
async function fetchOpenReceivableMemberIds() {
  const { rows, error } = await fetchAllRows('receivables?select=member_id&status=eq.open', await authHeaders());
  if (error) return new Set(); // 뱃지 하나 못 띄운다고 회원 목록 전체가 깨지면 안 되므로 조용히 빈 Set 반환
  return new Set(rows.map(r => r.member_id));
}

async function addReceivable(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/receivables`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) await throwApiError(res, '미수금 등록에 실패했습니다.');
  return res.json();
}

// 미수금 잔금을 지금 받음 - 오늘 매출로 새 sales 건을 하나 만들고(실제로 돈이 들어온 시점 기준),
// receivables의 paid_amount를 그만큼 올림. 다 받으면(paid_amount >= total_amount) status를 'settled'로 바꿈.
// amount가 남은 잔금보다 적으면(또 한 번 나눠 받는 경우) receivables는 그대로 'open'으로 남아있음.
async function collectReceivablePayment(receivable, { amount, paymentMethod, staffId, saleDate, memo }) {
  const saleRows = await addSale({
    member_id: receivable.member_id,
    staff_id: staffId,
    category: receivable.category || 'membership_renewal',
    product_id: receivable.product_id || null,
    amount,
    sale_date: saleDate,
    payment_method: paymentMethod,
    memo: memo || `미수금 잔금 결제 (${receivable.item_name})`
  });
  const newPaid = Number(receivable.paid_amount) + Number(amount);
  const settled = newPaid >= Number(receivable.total_amount);
  const patch = { paid_amount: newPaid, status: settled ? 'settled' : 'open' };
  if (settled) patch.settled_at = new Date().toISOString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/receivables?id=eq.${receivable.id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify(patch)
  });
  if (!res.ok) await throwApiError(res, '미수금 상태 업데이트에 실패했습니다.');
  const updatedRows = await res.json();
  return { sale: saleRows[0], receivable: updatedRows[0] };
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

// 금액 입력칸(class="money-input")은 타이핑하는 대로 1,000단위 콤마가 자동으로 붙게 함
// ("금액 칸도 0,000 형태로 통일해달라"는 요청으로 추가함, 2026-09-05). type="number"는
// 브라우저가 콤마 있는 값을 아예 입력 불가 처리해버려서, 이 칸들은 type="text"로 바꾸고
// 여기서 직접 숫자만 남겨 다시 콤마를 넣어줌. 나중에 표를 다시 그려서(PT 관리 주차별 시트처럼)
// 이 클래스의 입력칸이 새로 생기더라도 매번 따로 연결할 필요 없도록, 문서 전체에 이벤트
// 위임(delegation)을 걸어서 한 번만 등록해두면 새로 생기는 칸에도 자동으로 적용됨.
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.classList || !el.classList.contains('money-input')) return;
  const caretFromEnd = el.value.length - el.selectionStart;
  const digits = el.value.replace(/[^0-9]/g, '');
  const formatted = digits ? Number(digits).toLocaleString('ko-KR') : '';
  el.value = formatted;
  const pos = Math.max(0, formatted.length - caretFromEnd);
  el.setSelectionRange(pos, pos);
});

// money-input 칸에서 실제 숫자 값만 뽑아냄(콤마 제거) - 비어있으면 null.
// id 문자열이나 input 엘리먼트 둘 다 받을 수 있음.
function moneyInputValue(elOrId) {
  const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  if (!el) return null;
  const digits = String(el.value || '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}

// money-input 칸에 값을 코드로 채워 넣을 때(수정 화면 열 때 등) 콤마 형식으로 넣어줌.
function setMoneyInputValue(elOrId, n) {
  const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  if (!el) return;
  el.value = (n === null || n === undefined || n === '') ? '' : Number(n).toLocaleString('ko-KR');
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
// monthStr('YYYY-MM')을 넘기면 그 달만, 안 넘기면 실제 오늘이 속한 달을 기준으로 함
// (원래는 gte만 있고 상한이 없어서 "이번 달 이후 전부"를 가져오는 셈이었는데, 대시보드에서 매출 보고
// 화살표로 지난 달을 돌아볼 때 그 달 하나만 정확히 집계되도록 lt(다음 달 1일)도 같이 넣음)
async function fetchCategoryRenewalStats(monthStr) {
  let y, m;
  if (monthStr) {
    [y, m] = monthStr.split('-').map(Number);
  } else {
    const now = new Date();
    y = now.getFullYear();
    m = now.getMonth() + 1;
  }
  const firstDay = `${y}-${String(m).padStart(2, '0')}-01`;
  const nextMonthDate = new Date(y, m, 1); // m은 1~12라 그대로 넣으면 다음 달 1일이 됨
  const nextMonthFirstDay = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tm_logs?select=status,category&contact_date=gte.${firstDay}&contact_date=lt.${nextMonthFirstDay}&category=not.is.null`,
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
// "매일"/"매주 ○요일"/"매월 ○째 주 ○요일" 반복 업무는 실제로 서버에서 리셋해주는 게 아니라, 화면에서
// last_completed_at이 "이번 주기(오늘/이번 주/이번 달)" 안에 있는지를 계산해서 보여주는 방식
// -> 주기가 지나면 DB값은 그대로여도 자동으로 다시 미체크 상태로 보임
const REPEAT_TYPE_LABEL = { none: '반복 없음', daily: '매일', weekly: '매주', monthly: '매월' };
const WEEKDAY_LABELS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토'];
// 매월 반복에서 "몇째 주"인지 - 마지막 주는 매달 4주/5주가 왔다갔다 하므로 숫자(5)가 아니라
// -1로 저장해서 "그 달의 마지막 ○요일"을 항상 정확히 가리키도록 함
const WEEK_ORDINAL_LABELS = { 1: '첫째 주', 2: '둘째 주', 3: '셋째 주', 4: '넷째 주', '-1': '마지막 주' };

// 업무 완료 체크: 체크하면 status를 done으로, last_completed_at을 지금 시각으로 저장.
// 해제하면 둘 다 초기화(todo/null). 반복 업무는 last_completed_at 기준으로 "이번 주기 완료 여부"를
// 다시 계산하기 때문에, 체크 시점의 status 값 자체는 반복 업무에서는 참고용일 뿐임
//
// last_checked_at은 별도로 관리하는 "실제로 마지막에 체크한 시각" 기록임. last_completed_at은
// 체크 해제하면 바로 null로 지워지기 때문에(이번 주기 미완료 상태로 되돌리려고), 그것만으로는
// "선생님이 마지막으로 언제 체크했었는지"를 알 수 없음 -> 그래서 체크할 때만 채우고, 해제해도
// 지우지 않는 last_checked_at을 따로 둬서 "누락되고 있는지" 파악할 수 있게 함
async function toggleTaskDone(id, done) {
  const patch = { status: done ? 'done' : 'todo', last_completed_at: done ? new Date().toISOString() : null };
  if (done) patch.last_checked_at = new Date().toISOString();
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

function isSameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

// year/month(0=1월)의 그 달에서 ordinal번째 weekday의 날짜를 구함 (ordinal이 -1이면 "마지막 ○요일")
function nthWeekdayOfMonth(year, month, weekday, ordinal) {
  if (ordinal === -1) {
    const last = new Date(year, month + 1, 0); // 그 달의 마지막 날
    const diff = (last.getDay() - weekday + 7) % 7;
    last.setDate(last.getDate() - diff);
    return last;
  }
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (ordinal - 1) * 7);
}

// 이 업무가 "이번 주기(반복 없음=한 번 완료하면 계속 완료 / 매일=오늘 / 매주=이번 주 / 매월=이번 달)" 기준으로
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
  if (item.repeat_type === 'monthly') return isSameMonth(completed, refDate);
  return false;
}

// "15:00:00" / "15:00" 같은 DB의 time 값을 "오후 3:00" 형태로 변환.
// due_time이 없는(시간 지정 안 한) 업무가 대부분이라 null이면 그냥 null을 돌려줘서 호출부에서 생략하게 함
function formatTimeLabel(timeStr) {
  if (!timeStr) return null;
  const [hh, mm] = timeStr.split(':').map(Number);
  const period = hh < 12 ? '오전' : '오후';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${period} ${h12}:${String(mm).padStart(2, '0')}`;
}

// 다음(또는 이번) 마감일 라벨 - 반복 없음이면 등록할 때 지정한 마감일을 그대로 보여줌.
// due_time이 같이 등록돼 있으면("10시 회의", "오후 3시 OO쌤 미팅" 등) 맨 뒤에 시간까지 붙여줌
function taskDueLabel(item, refDate = new Date()) {
  const timeLabel = formatTimeLabel(item.due_time);
  const withTime = (label) => timeLabel ? `${label} · ${timeLabel}` : label;
  if (item.repeat_type === 'daily') {
    return withTime(`매일 · ${refDate.getMonth() + 1}월 ${refDate.getDate()}일 (${WEEKDAY_SHORT[refDate.getDay()]})`);
  }
  if (item.repeat_type === 'weekly' && item.repeat_weekday !== null && item.repeat_weekday !== undefined) {
    const date = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
    const diff = (item.repeat_weekday - date.getDay() + 7) % 7;
    date.setDate(date.getDate() + diff);
    return withTime(`매주 ${WEEKDAY_LABELS[item.repeat_weekday]} · ${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY_SHORT[date.getDay()]})`);
  }
  if (item.repeat_type === 'monthly' && item.repeat_weekday !== null && item.repeat_weekday !== undefined && item.repeat_week_ordinal !== null && item.repeat_week_ordinal !== undefined) {
    const date = nthWeekdayOfMonth(refDate.getFullYear(), refDate.getMonth(), item.repeat_weekday, item.repeat_week_ordinal);
    const ordinalLabel = WEEK_ORDINAL_LABELS[item.repeat_week_ordinal];
    return withTime(`매월 ${ordinalLabel} ${WEEKDAY_LABELS[item.repeat_weekday]} · ${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY_SHORT[date.getDay()]})`);
  }
  return withTime(item.due_date ? `마감 ${item.due_date}` : '마감일 없음');
}

// 반복 업무를 담당자가 마지막으로 체크한 날짜 라벨. last_checked_at은 체크 해제해도 지워지지
// 않으므로(위 toggleTaskDone 주석 참고), "이번 주기 완료 여부"와 별개로 실제 체크 이력을 보여줌
function taskLastCheckedLabel(item) {
  if (!item.last_checked_at) return null;
  const d = new Date(item.last_checked_at);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_SHORT[d.getDay()]})`;
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

// 전화번호를 화면에 보여줄 때 000-0000-0000 형태로 자동으로 나오게 함(DB에는 계속 숫자만
// 저장돼있음 - normalizePhone 참고). "전화번호 형태가 다 제각각이라 통일해달라"는 요청으로 추가함
// (2026-09-05). 010 등 휴대폰(11자리)이 대부분이라 3-4-4를 기본으로 하되, 서울 지역번호(02)나
// 예전 방식 10자리 번호도 자연스럽게 나오도록 자리수별로 나눠서 처리함. 알 수 없는 자리수(외국
// 번호 등 특수한 경우)는 억지로 나누지 않고 원래 값을 그대로 보여줌.
function formatPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/[^0-9]/g, '');
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) {
    if (digits.startsWith('02')) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 9 && digits.startsWith('02')) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  return phone; // 위 패턴에 안 맞으면(자리수가 다른 특수 케이스) 원래 값 그대로 보여줌
}

// 전화번호 입력칸(m_phone/md_f_phone/l_phone)에 타이핑하는 대로 자동으로 하이픈이 붙게 함.
// 저장할 때는 어차피 normalizePhone()이 숫자만 남겨서 저장하므로, 입력 중 화면 표시만 이렇게
// 예쁘게 바꿔주면 됨(전화번호 자리마다 커서 위치가 안 튀도록, 끝에서부터 남은 글자 수를 기준으로
// 커서를 다시 맞춰줌).
function attachPhoneAutoFormat(el) {
  if (!el) return;
  el.addEventListener('input', () => {
    const caretFromEnd = el.value.length - el.selectionStart;
    const formatted = formatPhone(el.value);
    el.value = formatted;
    const pos = Math.max(0, formatted.length - caretFromEnd);
    el.setSelectionRange(pos, pos);
  });
}

// ---- 전체 데이터 백업 (홈 화면의 "데이터 백업" 버튼에서 사용, 지점장 전용) ----
// 회원/매출/TM기록/업무/상품/직원 테이블을 전부 그대로 내려받아서 엑셀 파일로 만들 수 있게 해줌.
// Claude(이 세션)나 코드가 아니라 실제 데이터베이스(Supabase)가 원본이므로, 이 백업은
// "혹시 몰라 손으로 들고 있는 사본"의 역할 — 정기적으로(특히 큰 변경 후) 눌러서 저장해두면 됨.
async function fetchAllDataForBackup() {
  const headers = await authHeaders();
  async function getRows(path, fallbackMsg) {
    // 백업 대상 테이블(특히 회원)도 행 수가 많아지면 서버 기본 반환 행수 제한에 걸릴 수 있어서
    // fetchAllRows로 전체를 다 받아옴 (위 fetchMembers()와 같은 이유)
    const { rows, error } = await fetchAllRows(path, headers);
    if (error) await throwApiError(error, fallbackMsg);
    return rows;
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

// ---- 마케팅 문의 경로 일지(pt.html "문의 경로" 탭) ----
// 예전엔 엑셀로 손으로 적던 "날짜별 문의 채널(전화/네이버톡톡/네이버예약/인스타/카카오/당근) 건수"를
// 앱으로 옮긴 것. 이름 없이 그날의 채널별 건수만 세는 방식이라 트레이너별 구분이 없는 센터 공용 집계임.
async function fetchMarketingInquiries(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDate = new Date(y, m, 1); // m은 이미 1~12라 그대로 넣으면 다음 달 1일이 됨
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-01`;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/marketing_inquiries?inquiry_date=gte.${start}&inquiry_date=lt.${end}`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '문의 경로 기록을 불러오지 못했습니다.');
  return res.json();
}

// 같은 (날짜, 카테고리, 채널) 조합이면 덮어쓰기(upsert) - migration_38의 unique 제약을 이용
async function upsertMarketingInquiry({ inquiry_date, category, channel, count, updated_by }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/marketing_inquiries?on_conflict=inquiry_date,category,channel`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify({ inquiry_date, category, channel, count, updated_by: updated_by || null, updated_at: new Date().toISOString() })
  });
  if (!res.ok) await throwApiError(res, '문의 경로 기록 저장에 실패했습니다.');
  return res.json();
}

// ---- 상담 워크인 / 미스 (대시보드 "상담 워크인 / 미스" 섹션) ----
// 문의 경로와 같은 방식(이름 없이 그날짜 건수만 집계, 센터 공용)인데, 채널이 아니라 "성공/실패" 결과만 셈
async function fetchWorkinResults(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDate = new Date(y, m, 1); // m은 이미 1~12라 그대로 넣으면 다음 달 1일이 됨
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-01`;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/workin_results?result_date=gte.${start}&result_date=lt.${end}`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '상담 워크인 기록을 불러오지 못했습니다.');
  return res.json();
}

// 같은 (날짜, 결과) 조합이면 덮어쓰기(upsert) - migration_39의 unique 제약을 이용
async function upsertWorkinResult({ result_date, result, count, updated_by }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/workin_results?on_conflict=result_date,result`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify({ result_date, result, count, updated_by: updated_by || null, updated_at: new Date().toISOString() })
  });
  if (!res.ok) await throwApiError(res, '상담 워크인 기록 저장에 실패했습니다.');
  return res.json();
}

// ---- 매출 보고 공유 링크(dashboard.html "🔗 공유 링크 만들기" -> report.html) ----
// "캡쳐해서 일일이 보내지 말고 링크로 보여줄 수 있게" 요청으로 추가. 공유 버튼을 누른 시점의 숫자를
// 그대로 jsonb 스냅샷으로 저장해두고, report.html이 로그인 없이 그 한 건만 읽어서 보여줌(실시간 X).
async function createReportShare(snapshot, created_by) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/report_shares`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify({ snapshot, created_by: created_by || null })
  });
  if (!res.ok) await throwApiError(res, '공유 링크 생성에 실패했습니다.');
  return res.json();
}

// 내가 만든 공유 링크 목록(관리/삭제용 - RLS로 본인 것만 보임)
async function fetchMyReportShares() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/report_shares?select=id,created_at&order=created_at.desc&limit=20`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '공유 링크 목록을 불러오지 못했습니다.');
  return res.json();
}

async function deleteReportShare(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/report_shares?id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders()
  });
  if (!res.ok) await throwApiError(res, '공유 링크 삭제에 실패했습니다.');
}

// report.html(로그인 없이 보는 공개 페이지) 전용 - authHeaders()(로그인 토큰 필요) 대신 공개 anon
// 키만으로 요청함. get_report_share()가 정확히 일치하는 id 하나만 돌려주는 SECURITY DEFINER 함수라
// 이 요청만으로는 다른 사람의 공유 링크를 목록으로 볼 수 없음 - id를 모르면 아무것도 못 봄.
async function fetchPublicReportShare(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_report_share`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({ share_id: id })
  });
  if (!res.ok) await throwApiError(res, '공유된 보고서를 불러오지 못했습니다.');
  return res.json(); // 없거나 삭제된 링크면 null
}

// ---- 계정 관리(accounts.html) ----
// 네이버/네이버플레이스/노션/구글 등 센터에서 같이 쓰는 서비스 계정을 모아두는 곳.
// 문의 경로/워크인과 마찬가지로 이름(트레이너) 구분 없이 센터 전체가 공용으로 보고 쓰는 표.
async function fetchServiceAccounts() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/service_accounts?select=*&order=service_name.asc`,
    { headers: await authHeaders() }
  );
  if (!res.ok) await throwApiError(res, '계정 목록을 불러오지 못했습니다.');
  return res.json();
}

async function addServiceAccount({ service_name, login_id, password, updated_by }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/service_accounts`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify({ service_name, login_id: login_id || null, password: password || null, updated_by: updated_by || null })
  });
  if (!res.ok) await throwApiError(res, '계정 등록에 실패했습니다.');
  return res.json();
}

async function updateServiceAccount(id, fields) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/service_accounts?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Prefer': 'return=representation' },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() })
  });
  if (!res.ok) await throwApiError(res, '계정 정보 수정에 실패했습니다.');
  return res.json();
}

async function deleteServiceAccount(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/service_accounts?id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders()
  });
  if (!res.ok) await throwApiError(res, '계정 삭제에 실패했습니다.');
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

// ---- 지표 분석 (metrics.html) ----
// "우리 센터 총 인원수/재등록률/신규 등록률/이탈률/객단가를 보고 이번 달엔 어떤 이벤트가 필요한지
// 알려주는 페이지"를 만들어달라는 요청으로 추가. 계산 로직은 순수 함수(computeMonthlyMetrics,
// getEventRecommendations)로 여기 data.js에 두고, metrics.html은 필요한 원본 데이터(회원/매출/TM기록)를
// fetch로 가져와서 이 함수들에 넘기기만 함 - 매달 하나씩 서버에 다시 물어보는 대신 넉넉한 기간을 한 번에
// 불러와서 클라이언트에서 여러 달을 한꺼번에 계산함(대시보드의 recentSalesAll 캐시 패턴과 동일한 방식).

// 만료 추적 카테고리(EXPIRY_CATEGORIES) 중 "핵심 회원권"만 - 락커/운동복은 부가 서비스라 이 페이지의
// 총 회원수·재등록률·이탈률 계산에서는 제외함(그것만 있고 헬스이용권/PT/그룹PT가 하나도 없는 사람을
// "회원"으로 보기엔 애매해서). 자세한 이유는 README 참고.
const METRICS_CORE_CATEGORIES = EXPIRY_CATEGORIES.filter(c => ['membership', 'group_pt', 'pt'].includes(c.key));
const METRICS_RENEWAL_SALE_CATEGORY = { membership: 'membership_renewal', group_pt: 'group_pt_renewal', pt: 'pt_renewal' };
const METRICS_NEW_SALE_CATEGORIES = ['membership_new', 'pt_new', 'group_pt_new'];
// 만료 후 이 기간(일) 안에 재등록 신호가 없으면 "이탈"로 봄 - 사용자가 직접 정한 기준
const METRICS_CHURN_GRACE_DAYS = 30;
// TM콜은 만료되기 전에 미리 하는 경우가 많아서, 만료일보다 이만큼 이전 날짜까지도 "그 만료 건에 대한
// 재등록 시도"로 인정해줌(너무 옛날 TM기록까지 엮이지 않도록 60일로 제한)
const METRICS_TM_LOOKBACK_DAYS = 60;
// 객단가(ARPU) 계산에 포함할 "FC"(헬스장 자체 상품) 카테고리 - "PT는 아예 별도라서 금액 차이도 너무
// 크게 발생하니 객단가는 헬스이용권·운동복·락커·(올바른 운동 무제한) 그룹PT만 보고 싶다"는 요청으로,
// 개인PT(가격대가 수십만~수백만원으로 완전히 다름)와 기타(양도비 등 일회성 항목)는 객단가 계산에서 뺌.
const METRICS_ARPU_CATEGORIES = ['membership', 'group_pt', 'locker', 'clothes'];

function metricsAddDaysStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 지표 계산에 필요한 원본 데이터를 한 번에 불러옴 - members는 전체, sales/tm_logs는 넉넉한 기간
// (분석 시작월의 TM_LOOKBACK만큼 이전 ~ 오늘+CHURN_GRACE만큼 이후)만 가져와서 과호출을 피함
async function fetchMetricsRawData(earliestMonthStr) {
  const [ey, em] = earliestMonthStr.split('-').map(Number);
  const rangeStart = metricsAddDaysStr(`${ey}-${String(em).padStart(2, '0')}-01`, -METRICS_TM_LOOKBACK_DAYS);
  const rangeEnd = metricsAddDaysStr(toDateStrPlain(new Date()), METRICS_CHURN_GRACE_DAYS + 31);

  const [membersRes, salesRes, tmRes] = await Promise.all([
    fetchAllRows('members?select=id,name,membership_end_date,group_pt_end_date,pt_end_date,status', await authHeaders()),
    // product_id로 연결된 상품이 있으면 그 상품의 이름/카테고리/기간(일)/횟수까지 같이 받아옴 -
    // "상품(플랜)별 등록 현황"(computeProductPlanStats)에서 "3개월권/6개월권/12개월권", "PT 10/20/30회" 같은
    // 구체적인 플랜 단위로 집계할 때 씀. 매출 입력 화면에서 상품을 안 고르고 직접 입력한 매출(주로 옛날 엑셀
    // 가져오기 건)은 product_id가 비어있어서 product가 null로 옴 - 이런 건 "상품 미연결"로 따로 집계함.
    fetchAllRows(`sales?select=id,member_id,category,amount,sale_date,product_id,product:products(id,name,category,duration_days,sessions)&sale_date=gte.${rangeStart}&sale_date=lte.${rangeEnd}`, await authHeaders()),
    fetchAllRows(`tm_logs?select=id,member_id,status,category,contact_date&contact_date=gte.${rangeStart}&contact_date=lte.${rangeEnd}`, await authHeaders())
  ]);
  if (membersRes.error) await throwApiError(membersRes.error, '회원 목록을 불러오지 못했습니다.');
  if (salesRes.error) await throwApiError(salesRes.error, '매출 내역을 불러오지 못했습니다.');
  if (tmRes.error) await throwApiError(tmRes.error, 'TM 상담 기록을 불러오지 못했습니다.');

  return {
    members: membersRes.rows.filter(m => m.status !== 'left'),
    sales: salesRes.rows,
    tmLogs: tmRes.rows
  };
}

// data.js 안에서만 쓰는 순수 날짜 포맷 함수 - 각 페이지가 이미 인라인으로 갖고 있는 toDateStr와
// 이름이 겹치지 않도록 별도 이름을 씀(둘 다 구현은 같음)
function toDateStrPlain(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// monthStr('YYYY-MM') 한 달의 지표를 계산 - fetchMetricsRawData()로 가져온 원본을 그대로 넘기면 됨.
// (1) activeMemberCount: 그 달 말일 기준, 헬스이용권/그룹PT/개인PT 중 하나라도 만료 전인 회원 수(중복 제거)
// (2) newMemberCount/newRate: 그 달 매출 중 *_new 카테고리 매출을 낸 회원 수 / 총 회원수
// (3) 재등록률/이탈률: 그 달에 만료 "예정"이었던 (회원,카테고리) 쌍을 분모로 잡고, 그 각각에 대해
//     ①만료일 기준 -14일~+30일 사이 재등록 매출이 있거나 ②관련 TM기록 status가 'renewed'면 "재등록",
//     둘 다 없이 만료 후 30일이 지났으면 "이탈", 아직 30일이 안 지났으면 "집계중"(대기)으로 셈.
//     TM콜을 안 돌린 사람도 분모에 그대로 남기 때문에(기존 대시보드의 "상품별 재등록 현황"과 다른 점),
//     TM 진행 여부와 무관하게 "실제로 몇 명이 재등록했는지"를 보여줌 - 자세한 설명은 README 참고
// (4) arpu(객단가): 그 달 "FC" 매출(헬스이용권·그룹PT·락커·운동복만, 개인PT·기타 제외) /
//     그 매출 기준으로 실제 결제한(distinct member_id) 회원 수 - METRICS_ARPU_CATEGORIES 참고
function computeMonthlyMetrics(monthStr, raw) {
  const [y, m] = monthStr.split('-').map(Number);
  const monthStart = `${monthStr}-01`;
  const monthEnd = toDateStrPlain(new Date(y, m, 0));
  const monthSales = raw.sales.filter(s => s.sale_date >= monthStart && s.sale_date <= monthEnd);

  const activeMembers = raw.members.filter(mem =>
    METRICS_CORE_CATEGORIES.some(c => mem[c.field] && mem[c.field] >= monthEnd)
  );

  const newMemberIds = new Set(
    monthSales.filter(s => METRICS_NEW_SALE_CATEGORIES.includes(s.category) && s.member_id).map(s => s.member_id)
  );

  const expiringItems = [];
  raw.members.forEach(mem => {
    METRICS_CORE_CATEGORIES.forEach(c => {
      const endDate = mem[c.field];
      if (endDate && endDate >= monthStart && endDate <= monthEnd) {
        expiringItems.push({ member: mem, categoryKey: c.key, endDate });
      }
    });
  });

  const today = toDateStrPlain(new Date());
  let renewed = 0, churned = 0, pending = 0;
  expiringItems.forEach(item => {
    const graceEnd = metricsAddDaysStr(item.endDate, METRICS_CHURN_GRACE_DAYS);
    const tmLookbackStart = metricsAddDaysStr(item.endDate, -METRICS_TM_LOOKBACK_DAYS);
    const renewalSaleCategory = METRICS_RENEWAL_SALE_CATEGORY[item.categoryKey];

    const hasRenewalSale = raw.sales.some(s =>
      s.member_id === item.member.id && s.category === renewalSaleCategory &&
      s.sale_date >= metricsAddDaysStr(item.endDate, -14) && s.sale_date <= graceEnd
    );
    const hasRenewedTm = raw.tmLogs.some(log =>
      log.member_id === item.member.id && log.status === 'renewed' &&
      (!log.category || log.category === item.categoryKey) &&
      log.contact_date >= tmLookbackStart && log.contact_date <= graceEnd
    );

    if (hasRenewalSale || hasRenewedTm) renewed++;
    else if (today > graceEnd) churned++;
    else pending++;
  });

  const totalCohort = expiringItems.length;
  // 객단가는 "FC" 매출(헬스이용권·그룹PT·락커·운동복)만 기준으로 계산 - 개인PT는 가격대가 워낙 커서
  // (수십만~수백만원) 섞으면 객단가가 실제 이용권 판매 감각과 안 맞게 튀어서 뺐음
  const arpuSales = monthSales.filter(s => METRICS_ARPU_CATEGORIES.includes(saleCategoryGroup(s)));
  const arpuRevenue = arpuSales.reduce((sum, s) => sum + Number(s.amount), 0);
  const arpuPayingMemberIds = new Set(arpuSales.filter(s => s.member_id).map(s => s.member_id));

  return {
    monthStr,
    activeMemberCount: activeMembers.length,
    newMemberCount: newMemberIds.size,
    newRate: activeMembers.length > 0 ? newMemberIds.size / activeMembers.length : null,
    totalCohort, renewed, churned, pending,
    renewalRate: totalCohort > 0 ? renewed / totalCohort : null,
    churnRate: totalCohort > 0 ? churned / totalCohort : null,
    arpuRevenue,
    payingMemberCount: arpuPayingMemberIds.size,
    arpu: arpuPayingMemberIds.size > 0 ? arpuRevenue / arpuPayingMemberIds.size : null
  };
}

// "3개월권/6개월권/12개월권", "개인PT 10/20/30/50/100회"처럼 구체적인 상품(플랜) 단위로 그 달 등록
// 건수를 보고 싶다는 요청으로 추가. "12개월권 대상 이벤트를 기획했으면 12개월권 등록이 실제로 늘어야
// 한다"처럼, 이벤트가 의도한 플랜에 실제로 효과가 있었는지 확인하는 용도.
// 상품 목록(products)은 지점장이 이용권 관리 화면에서 직접 추가/수정하므로, "3개월/6개월/12개월"을
// 코드에 미리 못박아두지 않고 실제로 팔린 상품(product_id로 연결된 상품)을 그대로 집계함.
const METRICS_PLAN_CATEGORIES = ['membership', 'group_pt', 'pt']; // 락커/운동복/기타는 "플랜"이 아니라서 제외
const METRICS_PLAN_CATEGORY_LABELS = { membership: '헬스이용권', group_pt: '그룹PT', pt: '개인PT' };

// 매출 한 건이 어느 플랜 카테고리에 속하는지 판단 - product 조인이 있으면 그 상품의 category를 그대로
// 쓰고(가장 정확함), 상품 연결이 없는 매출(주로 상품 선택 없이 직접 입력했거나 옛날 엑셀 가져오기 건)은
// sales.category 값(예: membership_renewal)의 앞부분으로 대략 판단함
function saleCategoryGroup(sale) {
  if (sale.product && sale.product.category) return sale.product.category;
  const cat = sale.category || '';
  if (cat.startsWith('membership') && cat !== 'membership_transfer') return 'membership';
  if (cat.startsWith('group_pt')) return 'group_pt';
  if (cat.startsWith('pt')) return 'pt';
  return cat;
}

// monthStr 한 달의 상품(플랜)별 등록 건수를 집계. METRICS_PLAN_CATEGORIES 각각에 대해
// { categoryKey, categoryLabel, plans: [{productId, name, sortKey, count, revenue}], unlinkedCount,
//   unlinkedRevenue, totalCount } 를 돌려줌 - plans는 duration_days(기간제) 또는 sessions(회차제) 오름차순 정렬.
// unlinkedCount/unlinkedRevenue는 product_id가 없어서 어떤 구체적 플랜인지 알 수 없는 매출 건수 - 이게
// 0이 아니면 "매출 입력할 때 상품을 안 고르고 직접 입력한 건"이 있다는 뜻이라, 그대로 화면에 보여줘서
// 지점장이 데이터 연동이 잘 안 된 건이 있는지 바로 확인할 수 있게 함.
function computeProductPlanStats(monthStr, raw) {
  const monthStart = `${monthStr}-01`;
  const [y, m] = monthStr.split('-').map(Number);
  const monthEnd = toDateStrPlain(new Date(y, m, 0));
  const monthSales = raw.sales.filter(s => s.sale_date >= monthStart && s.sale_date <= monthEnd);

  const groups = {};
  METRICS_PLAN_CATEGORIES.forEach(key => {
    groups[key] = { categoryKey: key, categoryLabel: METRICS_PLAN_CATEGORY_LABELS[key], plans: new Map(), unlinkedCount: 0, unlinkedRevenue: 0, totalCount: 0 };
  });

  monthSales.forEach(s => {
    const groupKey = saleCategoryGroup(s);
    const g = groups[groupKey];
    if (!g) return; // 락커/운동복/일일입장권/양도비/미분류 등은 "플랜" 집계 대상이 아님
    g.totalCount++;
    if (s.product_id && s.product) {
      if (!g.plans.has(s.product_id)) {
        g.plans.set(s.product_id, {
          productId: s.product_id,
          name: s.product.name,
          sortKey: s.product.duration_days != null ? s.product.duration_days : (s.product.sessions != null ? s.product.sessions : 0),
          count: 0,
          revenue: 0
        });
      }
      const p = g.plans.get(s.product_id);
      p.count++;
      p.revenue += Number(s.amount) || 0;
    } else {
      g.unlinkedCount++;
      g.unlinkedRevenue += Number(s.amount) || 0;
    }
  });

  return METRICS_PLAN_CATEGORIES.map(key => {
    const g = groups[key];
    return {
      categoryKey: g.categoryKey,
      categoryLabel: g.categoryLabel,
      plans: Array.from(g.plans.values()).sort((a, b) => a.sortKey - b.sortKey),
      unlinkedCount: g.unlinkedCount,
      unlinkedRevenue: g.unlinkedRevenue,
      totalCount: g.totalCount
    };
  });
}

// 이번 달 숫자(cur)와 전월 숫자(prev, 없을 수 있음)를 보고 어떤 이벤트가 필요한지 규칙 기반으로 추천.
// 사용자가 설명한 로직 그대로 구현: 총 회원수 적으면 신규 이벤트, 총 회원수 많으면(=안정적이면) 재등록
// 이벤트, 이탈률 높으면 이탈 방지 이벤트, 객단가 떨어지면 객단가를 높이는 이벤트. 임계값은 코드에 상수로
// 뽑아뒀으니 실제 운영해보면서 사용자 피드백에 맞춰 조정하면 됨.
const METRICS_THRESHOLDS = {
  lowRenewalRate: 0.5,      // 재등록률 50% 미만이면 "낮다"
  highChurnRate: 0.3,       // 이탈률 30% 이상이면 "높다"
  memberDeclinePct: -0.02,  // 총 회원수가 전월 대비 2% 넘게 줄면 "저조"
  arpuDeclinePct: -0.05     // 객단가가 전월 대비 5% 넘게 떨어지면 "하락"
};

function metricsPctChange(cur, prev) {
  if (prev === null || prev === undefined || prev === 0 || cur === null || cur === undefined) return null;
  return (cur - prev) / prev;
}

function getEventRecommendations(cur, prev) {
  const recs = [];
  const memberChange = prev ? metricsPctChange(cur.activeMemberCount, prev.activeMemberCount) : null;
  const arpuChange = prev ? metricsPctChange(cur.arpu, prev.arpu) : null;

  if (memberChange !== null && memberChange <= METRICS_THRESHOLDS.memberDeclinePct) {
    recs.push({
      level: 'critical',
      title: '신규 회원 유치 이벤트 추천',
      detail: `총 회원수가 전월 대비 ${(memberChange * 100).toFixed(1)}% 줄었어요(${prev.activeMemberCount}명 → ${cur.activeMemberCount}명). 체험 이벤트, 지인 추천 이벤트 등 신규 유입을 늘리는 이벤트가 필요해 보여요.`
    });
  }

  if (cur.totalCohort > 0 && cur.renewalRate !== null && cur.renewalRate < METRICS_THRESHOLDS.lowRenewalRate) {
    const pendingNote = cur.pending > 0 ? ` (그 중 ${cur.pending}건은 아직 만료 후 30일이 안 지나서 집계중이에요)` : '';
    recs.push({
      level: 'warning',
      title: '재등록 유도 이벤트 추천',
      detail: `이번 달 만료 예정 ${cur.totalCohort}건 중 재등록은 ${cur.renewed}건(${(cur.renewalRate * 100).toFixed(1)}%)에 그쳤어요.${pendingNote} 조기 재등록 할인, 장기 회원 혜택 같은 재등록 유도 이벤트가 필요해 보여요.`
    });
  }

  if (cur.totalCohort > 0 && cur.churnRate !== null && cur.churnRate >= METRICS_THRESHOLDS.highChurnRate) {
    recs.push({
      level: 'critical',
      title: '이탈 방지 · 컴백 이벤트 추천',
      detail: `이번 달 만료 예정 ${cur.totalCohort}건 중 ${cur.churned}건(${(cur.churnRate * 100).toFixed(1)}%)이 만료 후 30일이 지나도록 재등록하지 않았어요. 이탈 회원 대상 컴백 프로모션이 필요해 보여요.`
    });
  }

  if (arpuChange !== null && arpuChange <= METRICS_THRESHOLDS.arpuDeclinePct) {
    recs.push({
      level: 'warning',
      title: '객단가(FC)를 높이는 이벤트 추천',
      detail: `FC(헬스이용권·그룹PT·락커·운동복) 1인당 평균 결제 금액이 전월 대비 ${(arpuChange * 100).toFixed(1)}% 떨어졌어요(${Math.round(prev.arpu).toLocaleString()}원 → ${Math.round(cur.arpu).toLocaleString()}원). 장기권(6·12개월) 업그레이드, 그룹PT(올바른 운동 무제한) 연계 같은 FC 객단가를 높이는 프로모션이 필요해 보여요.`
    });
  }

  // 딱히 위 네 가지에 안 걸리면(=전반적으로 안정적) 총 회원수 기준으로 기본 추천을 하나 보여줌
  // (사용자가 설명한 "총 인원수가 많으면 재등록 이벤트를 해야 한다"는 기본 방향)
  if (recs.length === 0) {
    recs.push({
      level: 'good',
      title: '전반적으로 안정적이에요',
      detail: `총 회원수 ${cur.activeMemberCount}명, 재등록률 ${cur.renewalRate !== null ? (cur.renewalRate * 100).toFixed(1) + '%' : '-'}, 이탈률 ${cur.churnRate !== null ? (cur.churnRate * 100).toFixed(1) + '%' : '-'}로 특별히 위험 신호는 없어요. 이 상태를 유지하면서 기존 회원 대상 재등록·업셀 이벤트를 꾸준히 이어가는 걸 추천해요.`
    });
  }

  return recs;
}
