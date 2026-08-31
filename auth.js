// Supabase Auth를 라이브러리 설치 없이 REST API로 직접 호출하는 공용 함수 모음
// config.js가 먼저 로드되어 있어야 합니다 (SUPABASE_URL, SUPABASE_ANON_KEY 사용)

const AUTH_STORAGE_KEY = 'gymops_session';

// 회원가입: auth.users에 계정 생성 -> DB 트리거가 profiles에 기본 role='trainer'로 자동 생성
async function signUp(email, password, name) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password, data: { name } })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg || data.error_description || '회원가입에 실패했습니다.');
  return data;
}

// 로그인: 이메일/비밀번호로 access_token 발급받아 브라우저에 저장
async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || '이메일 또는 비밀번호가 올바르지 않습니다.');
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
  return data;
}

// 로그아웃
function signOut() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  location.href = 'login.html';
}

// 저장된 로그인 정보(access_token 등) 가져오기
function getSession() {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

// access_token이 곧 만료되거나 이미 만료됐으면 refresh_token으로 새로 발급받아 저장하고
// 항상 유효한 access_token을 돌려줌 (Supabase 로그인은 기본 1시간이면 만료되는데,
// 지금까지는 이걸 갱신하는 로직이 아예 없어서 로그인한 지 좀 지나면 모든 화면이
// "JWT expired" 오류로 한꺼번에 깨졌음). refresh_token마저 만료/무효면 로그아웃 처리.
async function getValidAccessToken() {
  const session = getSession();
  if (!session || !session.access_token) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const needsRefresh = !session.expires_at || (session.expires_at - nowSec) < 60;
  if (!needsRefresh) return session.access_token;
  if (!session.refresh_token) return session.access_token;

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    if (!res.ok) {
      // refresh_token도 만료/무효 -> 다시 로그인해야 함
      localStorage.removeItem(AUTH_STORAGE_KEY);
      if (!location.pathname.endsWith('login.html')) {
        location.href = 'login.html?expired=1';
      }
      return null;
    }
    const data = await res.json();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
    return data.access_token;
  } catch (e) {
    // 네트워크 오류 등으로 갱신 자체가 안 되면, 일단 기존 토큰으로라도 시도
    return session.access_token;
  }
}

// 로그인 안 되어 있으면 로그인 페이지로 보내기. 대시보드 등 보호된 페이지 맨 위에서 호출.
function requireLogin() {
  const session = getSession();
  if (!session || !session.access_token) {
    location.href = 'login.html';
    return null;
  }
  return session;
}

// 로그인한 사람의 profiles 행(이름, 역할) 조회 — RLS 덕분에 본인 것만 조회됨
// 모든 페이지가 맨 처음에 이 함수부터 호출하므로, 여기서 문제가 생기면 그 여파가 제일 큼:
// 1) 네트워크 오류로 fetch 자체가 throw되면, 그 오류를 안 잡아줄 경우 페이지 전체 초기화 코드가
//    그 자리에서 조용히 멈춰버림(화면은 "로딩 중..."만 뜬 채 텅 빈 그대로, 새로고침 전까진 안 풀림).
// 2) 와이파이가 잠깐 끊기는 등 "일시적인" 오류인 경우가 많아서, 한 번 실패했다고 바로 포기하지 않고
//    잠깐 쉬었다가 한 번 더 시도해봄 — 이러면 사용자가 직접 새로고침 안 해도 저절로 뜨는 경우가 많아짐.
// 그래도 안 되면 예외를 던지지 않고 null을 돌려줘서, 각 페이지가 이미 갖고 있는
// "if (!profile) { ... }" 처리로 자연스럽게(멈추지 않고) 넘어가도록 함.
async function getMyProfile() {
  const session = getSession();
  if (!session) return null;
  const token = await getValidAccessToken();
  if (!token) return null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${session.user.id}&select=id,name,role`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${token}`
          }
        }
      );
      if (!res.ok) {
        if (attempt === 0) { await new Promise(r => setTimeout(r, 500)); continue; }
        return null;
      }
      const rows = await res.json();
      return rows[0] || null;
    } catch (e) {
      if (attempt === 0) { await new Promise(r => setTimeout(r, 500)); continue; }
      return null;
    }
  }
  return null;
}

// 트레이너는 상단 메뉴에서 "매출 입력"/"만료회원 · TM"/"이용권 관리"를 안 보이게 함
// (매출 입력·만료회원 관리는 FC 담당 업무라 트레이너는 대시보드/회원관리/PT관리/업무리스트/직원관리만 쓰면 됨)
// 지점장은 그대로 전체 메뉴가 다 보임. 각 페이지에서 getMyProfile() 이후에 호출.
function applyRoleNav(profile) {
  if (!profile || profile.role === 'manager') return;
  const hideHrefs = ['sales.html', 'expiry.html', 'products.html'];
  // 상단 메뉴(.topnav) 말고도 홈 화면의 바로가기 타일(home.html)이나 대시보드의
  // "+ 매출 등록하기" 같은 인라인 링크(dashboard.html)에도 같은 href가 쓰이고 있어서,
  // .topnav 안쪽만 가리면 트레이너가 그 링크들을 타고 들어가 매출 입력/만료회원/이용권
  // 관리 화면에 그대로 접근할 수 있었음(해당 페이지들 자체엔 role 체크가 없음).
  // 그래서 .topnav a 대신 페이지 전체의 a[href]를 다 검사하도록 넓힘.
  document.querySelectorAll('a[href]').forEach((a) => {
    if (hideHrefs.includes(a.getAttribute('href'))) {
      a.style.display = 'none';
    }
  });
}
