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
async function getMyProfile() {
  const session = getSession();
  if (!session) return null;
  const token = await getValidAccessToken();
  if (!token) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${session.user.id}&select=id,name,role`,
    {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`
      }
    }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}
