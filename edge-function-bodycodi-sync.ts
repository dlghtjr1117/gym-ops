// Supabase Edge Function: "bodycodi-sync"
//
// 바디코디(회원관리 프로그램) Open API에서 회원 정보를 읽어와 우리 앱 회원에 반영하는 함수예요.
// Supabase 대시보드 > Edge Functions > "Deploy a new function" > "Via Editor"에서
// 이름을 bodycodi-sync 로 만들고 이 코드를 그대로 붙여넣은 뒤 "Deploy function"을 누르세요.
// (자세한 순서는 BODYCODI_SYNC_SETUP.md 참고)
//
// 왜 브라우저가 아니라 이 함수가 하나요?
//  - 바디코디 API 키는 화면(브라우저)이나 GitHub에 있으면 안 돼서 Supabase 비밀값(Secrets)에만 둠
//  - "지점장만 실행 가능" 같은 규칙을 화면이 아니라 서버에서 강제해야 우회가 안 됨
//
// 필요한 Secrets (Edge Functions > Secrets):
//   BODYCODI_API_KEY      바디코디 개발자센터에서 발급한 API 키 (Bearer 방식)
//   BODYCODI_BASE_URL     (선택) 기본 주소. 없으면 https://openapi.bodycodi.com
//   BODYCODI_SYNC_SECRET  (선택) 자동 실행(예약)용 비밀 문자열. 없으면 자동 실행은 꺼져 있어요.
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 는 Supabase가 자동으로 넣어줘요)
//
// 하는 일 (action):
//   ping     연결 확인. 회원 몇 명이 조회되는지, 이름/전화번호가 가려져 오는지만 알려줘요. 앱 데이터는 안 바꿔요.
//   preview  바디코디 회원과 우리 앱 회원을 매칭해보고 "이렇게 바뀔 예정"만 보여줘요. 앱 데이터는 안 바꿔요.
//   apply    매칭된 회원에 바디코디 회원번호 / 마지막 방문일 / 이용권 상태를 반영해요. (마지막 방문일은 더 최근일 때만)
//
// ※ 바디코디 문서에서 확인한 것: GET /open-api/v1/members, Authorization: Bearer 키, 응답 { data:[...], hasMore, total },
//   조회조건 status / page / withTotal / updatedSince / name / phone. 한 페이지에 몇 명씩 오는지, page가 0부터인지 1부터인지는
//   문서 캡처에 없어서, 이 함수가 직접 확인(detectPageBase)하고 hasMore가 false가 될 때까지 계속 받아요.

const DEFAULT_BASE_URL = 'https://openapi.bodycodi.com';
const MEMBERS_PATH = '/open-api/v1/members';
const MAX_PAGES = 400;          // 무한 반복 방지
const TIME_BUDGET_MS = 110_000; // Edge Function 제한 시간 안에서 멈추기 위한 여유
const WRITE_CONCURRENCY = 8;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ---------------------------------------------------------------------------
// 순수 함수들 (네트워크 안 씀 - 로컬에서 따로 테스트할 수 있게 분리해둠)
// ---------------------------------------------------------------------------
export type BodycodiMember = {
  memberId: string; name: string; phone: string | null; status?: string;
  registeredAt?: string | null; lastVisitAt?: string | null;
  hasActivePass?: boolean; activePassCount?: number; passState?: string | null;
  passCategories?: string[];
};
export type AppMember = {
  id: string; name: string; phone: string | null; join_date: string | null;
  last_visit_date: string | null; bodycodi_member_id: string | null; bodycodi_pass_state?: string | null; status?: string | null;
};

export const digitsOnly = (s: unknown): string => String(s ?? '').replace(/\D/g, '');
export const normName = (s: unknown): string => String(s ?? '').replace(/\s+/g, '').trim();
const MASK_CHARS = /[*＊●○◯•·ㆍ]/;

export function isMaskedName(s: unknown): boolean { return MASK_CHARS.test(String(s ?? '')); }
export function isMaskedPhone(s: unknown): boolean { return /[*＊●○]/.test(String(s ?? '')); }

// 바디코디 번호가 "010-1234-5678"처럼 끝까지 오면 전체 11자리, 가려져 있으면(010-****-5678) 뒤 4자리만 신뢰
export function phoneKey(raw: unknown): { full: string | null; last4: string | null } {
  if (raw === null || raw === undefined || raw === '') return { full: null, last4: null };
  const s = String(raw);
  const d = digitsOnly(s);
  if (!isMaskedPhone(s) && d.length >= 10) return { full: d, last4: d.slice(-4) };
  const m = s.match(/(\d{4})\s*$/);
  return { full: null, last4: m ? m[1] : null };
}

// "홍*동" 처럼 가려진 이름이 "홍길동"과 같은 사람 이름일 수 있는지 (글자 수가 같고, 가려지지 않은 글자는 모두 같아야 함)
export function nameMatches(bodyName: unknown, appName: unknown): boolean {
  const b = normName(bodyName), a = normName(appName);
  if (!b || !a) return false;
  if (!isMaskedName(b)) return a === b;
  const ac = [...a], bc = [...b];
  if (ac.length !== bc.length) return false;
  return bc.every((ch, i) => MASK_CHARS.test(ch) || ch === ac[i]);
}

// "2026-10-16T09:30:00+09:00" -> "2026-10-16" (바디코디 시각은 한국 시간(+09:00)이라 앞 10자리가 그대로 한국 날짜)
export function datePart(v: unknown): string | null {
  const m = String(v ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export type MatchResult = {
  matched: { body: BodycodiMember; app: AppMember; how: 'id' | 'phone' | 'name_last4' }[];
  ambiguous: { body: BodycodiMember; candidates: AppMember[] }[];
  unmatchedBody: BodycodiMember[];
  unmatchedApp: AppMember[];
};

// 바디코디 회원 <-> 앱 회원 매칭.
//  0) 이미 바디코디 회원번호가 저장된 앱 회원은 번호로 바로 연결
//  1) 전화번호 전체가 같고 이름이 맞으면 연결 (번호가 가려져 있지 않을 때)
//  2) 전화 뒤 4자리 + (가려진) 이름이 맞는 후보를 찾고, 후보가 여러 명이면 가입일이 같은 사람으로 좁힘
//  한 명으로 안 좁혀지거나, 앱 회원 한 명을 바디코디 회원 둘이 가리키면 "애매함"으로 두고 자동 반영하지 않음
export function matchMembers(body: BodycodiMember[], app: AppMember[]): MatchResult {
  const byBodyId = new Map<string, AppMember>();
  for (const a of app) if (a.bodycodi_member_id) byBodyId.set(String(a.bodycodi_member_id), a);

  const matched: MatchResult['matched'] = [];
  const ambiguous: MatchResult['ambiguous'] = [];
  const unmatchedBody: BodycodiMember[] = [];
  const claims = new Map<string, { body: BodycodiMember; how: 'phone' | 'name_last4' }[]>(); // 앱 회원 id -> 이 회원을 가리키는 바디코디 회원들
  const linkedAppIds = new Set<string>();

  const unlinkedApp = app.filter((a) => !a.bodycodi_member_id);
  const pending: { body: BodycodiMember; cands: AppMember[]; how: 'phone' | 'name_last4' }[] = [];

  for (const b of body) {
    const direct = byBodyId.get(String(b.memberId));
    if (direct) { matched.push({ body: b, app: direct, how: 'id' }); linkedAppIds.add(direct.id); continue; }

    const pk = phoneKey(b.phone);
    if (!pk.full && !pk.last4) { unmatchedBody.push(b); continue; }
    let how: 'phone' | 'name_last4' = pk.full ? 'phone' : 'name_last4';
    let cands = unlinkedApp.filter((a) => {
      if (!nameMatches(b.name, a.name)) return false;
      const ad = digitsOnly(a.phone);
      if (pk.full) return ad === pk.full;
      return ad.length >= 4 && ad.slice(-4) === pk.last4;
    });
    if (cands.length > 1) {
      const reg = datePart(b.registeredAt);
      const byDate = reg ? cands.filter((a) => datePart(a.join_date) === reg) : [];
      if (byDate.length === 1) cands = byDate;
    }
    if (cands.length === 0) { unmatchedBody.push(b); continue; }
    pending.push({ body: b, cands, how });
  }

  for (const p of pending) {
    if (p.cands.length === 1) {
      const list = claims.get(p.cands[0].id) || [];
      list.push({ body: p.body, how: p.how });
      claims.set(p.cands[0].id, list);
    } else {
      ambiguous.push({ body: p.body, candidates: p.cands });
    }
  }
  const appById = new Map(app.map((a) => [a.id, a]));
  for (const [appId, list] of claims) {
    const a = appById.get(appId)!;
    if (list.length === 1) {
      matched.push({ body: list[0].body, app: a, how: list[0].how });
      linkedAppIds.add(appId);
    } else {
      for (const c of list) ambiguous.push({ body: c.body, candidates: [a] });
    }
  }
  const ambiguousAppIds = new Set(ambiguous.flatMap((x) => x.candidates.map((c) => c.id)));
  const unmatchedApp = app.filter((a) => !linkedAppIds.has(a.id) && !ambiguousAppIds.has(a.id));
  return { matched, ambiguous, unmatchedBody, unmatchedApp };
}

export type Change = { app_id: string; app_name: string; patch: Record<string, unknown>; last_visit: { from: string | null; to: string } | null };

// 매칭된 회원에 실제로 무엇을 바꿀지 계산. 마지막 방문일은 "새 값이 더 최근이거나 기존 값이 비었을 때만" 바꿈.
export function planChanges(matched: MatchResult['matched'], nowIso: string): Change[] {
  const out: Change[] = [];
  for (const { body, app } of matched) {
    const patch: Record<string, unknown> = {};
    if (String(app.bodycodi_member_id ?? '') !== String(body.memberId)) patch.bodycodi_member_id = String(body.memberId);
    const newVisit = datePart(body.lastVisitAt);
    let lv: Change['last_visit'] = null;
    if (newVisit && (!app.last_visit_date || newVisit > app.last_visit_date)) {
      patch.last_visit_date = newVisit;
      lv = { from: app.last_visit_date, to: newVisit };
    }
    if (body.passState !== undefined && (body.passState ?? null) !== (app.bodycodi_pass_state ?? null)) patch.bodycodi_pass_state = body.passState ?? null;
    if (Object.keys(patch).length === 0) continue;
    patch.bodycodi_synced_at = nowIso;
    out.push({ app_id: app.id, app_name: app.name, patch, last_visit: lv });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 바디코디 API 호출
// ---------------------------------------------------------------------------
export class BodycodiError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

type Ctx = { base: string; key: string; fetchFn: typeof fetch };

async function bcGet(ctx: Ctx, path: string, params: Record<string, string | number | boolean | undefined>): Promise<any> {
  const url = new URL(ctx.base.replace(/\/+$/, '') + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await ctx.fetchFn(url.toString(), { headers: { Authorization: `Bearer ${ctx.key}`, Accept: 'application/json' } });
  } catch (e) {
    throw new BodycodiError(0, '바디코디 서버에 연결하지 못했어요: ' + (e instanceof Error ? e.message : String(e)));
  }
  const raw = await res.text();
  let j: any = null;
  try { j = JSON.parse(raw); } catch { /* JSON이 아닌 응답 */ }
  if (!res.ok) {
    const detail = (j && (j.message || j.error || j.errorMessage || j.code)) || raw.slice(0, 150) || '';
    let hint = '';
    if (res.status === 401) hint = ' (API 키가 틀렸거나 폐기됐어요. Supabase Secrets의 BODYCODI_API_KEY를 확인해주세요)';
    else if (res.status === 403) hint = ' (이 API 키에 회원 조회 권한이 없어요)';
    else if (res.status === 404) hint = ' (조회 주소를 찾지 못했어요)';
    else if (res.status === 429) hint = ' (요청이 너무 많아요. 잠시 뒤 다시 시도해주세요)';
    throw new BodycodiError(res.status, `바디코디가 ${res.status} 오류를 돌려줬어요${hint} ${detail}`.trim());
  }
  return j;
}

function rowsOf(j: any): any[] {
  if (Array.isArray(j?.data)) return j.data;
  if (Array.isArray(j?.data?.data)) return j.data.data;
  if (Array.isArray(j)) return j;
  return [];
}

// page가 0부터인지 1부터인지 직접 확인: page 없이 / page=0 / page=1 로 첫 줄 회원번호를 비교
export async function detectPageBase(ctx: Ctx): Promise<0 | 1> {
  const first = async (p: Record<string, number | undefined>) => {
    try { return String(rowsOf(await bcGet(ctx, MEMBERS_PATH, p))[0]?.memberId ?? ''); } catch { return ''; }
  };
  const none = await first({});
  const p0 = await first({ page: 0 });
  const p1 = await first({ page: 1 });
  if (none && p0 && none === p0 && p0 !== p1) return 0;
  return 1;
}

export async function fetchAllMembers(ctx: Ctx, opts: { status?: string; updatedSince?: string } = {}, deadline = Date.now() + TIME_BUDGET_MS) {
  const base = await detectPageBase(ctx);
  const all: BodycodiMember[] = [];
  let total: number | null = null;
  let page = base;
  let truncated = false;
  let prevFirst = '';
  for (let i = 0; i < MAX_PAGES; i++) {
    if (Date.now() > deadline) { truncated = true; break; }
    const j = await bcGet(ctx, MEMBERS_PATH, { page, withTotal: i === 0 ? true : undefined, status: opts.status, updatedSince: opts.updatedSince });
    if (i === 0 && typeof j?.total === 'number') total = j.total;
    const rows = rowsOf(j);
    // 서버가 page 값을 무시하고 같은 페이지를 계속 주는 경우(무한 반복) 방지
    const firstId = String(rows[0]?.memberId ?? '');
    if (i > 0 && firstId && firstId === prevFirst) { truncated = true; break; }
    prevFirst = firstId;
    all.push(...rows);
    const hasMore = j?.hasMore === true;
    if (!hasMore || rows.length === 0) break;
    page += 1;
    if (i === MAX_PAGES - 1) truncated = true;
  }
  return { members: all, total, pageBase: base, truncated };
}

// ---------------------------------------------------------------------------
// 요청 처리
// ---------------------------------------------------------------------------
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function sanitizeBody(b: any) { return { memberId: String(b.memberId), name: b.name, phone: b.phone ?? null, registeredAt: b.registeredAt ?? null, lastVisitAt: b.lastVisitAt ?? null, passState: b.passState ?? null }; }

async function loadAppMembers(SUPABASE_URL: string, SERVICE: string): Promise<AppMember[]> {
  const out: AppMember[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 50_000; from += pageSize) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/members?select=id,name,phone,join_date,last_visit_date,bodycodi_member_id,bodycodi_pass_state,status&order=id.asc`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, Range: `${from}-${from + pageSize - 1}`, 'Range-Unit': 'items' } },
    );
    if (!r.ok) {
      const t = await r.text();
      if (/bodycodi_member_id/.test(t)) throw new Error('DB에 바디코디 칸이 아직 없어요. migration_88_bodycodi_sync.sql을 먼저 실행해주세요.');
      throw new Error('앱 회원 목록을 불러오지 못했어요: ' + t.slice(0, 150));
    }
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST만 가능해요.' }, 405);

  try {
    const env = (k: string) => Deno.env.get(k) || '';
    const SUPABASE_URL = env('SUPABASE_URL');
    const ANON = env('SUPABASE_ANON_KEY');
    const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');
    const KEY = env('BODYCODI_API_KEY').trim();
    const BASE = (env('BODYCODI_BASE_URL').trim() || DEFAULT_BASE_URL);
    const SYNC_SECRET = env('BODYCODI_SYNC_SECRET').trim();

    const body = await req.json().catch(() => null);
    const action = String(body?.action ?? 'ping');

    // 1) 누가 부르는지 확인: 예약 실행(비밀 문자열) 또는 로그인한 지점장
    let runBy: string | null = null;
    const secretHeader = req.headers.get('x-sync-secret') || '';
    const isScheduled = !!SYNC_SECRET && secretHeader === SYNC_SECRET;
    if (!isScheduled) {
      const authHeader = req.headers.get('Authorization') || '';
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: authHeader } });
      if (!userRes.ok) return json({ error: '로그인 정보를 확인하지 못했어요. 다시 로그인해주세요.' }, 401);
      const user = await userRes.json();
      const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=id,role`, {
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      });
      const prof = profRes.ok ? (await profRes.json())[0] : null;
      if (!prof || prof.role !== 'manager') return json({ error: '바디코디 연동은 지점장 계정만 쓸 수 있어요.' }, 403);
      runBy = user.id;
    }

    if (!KEY) {
      return json({ error: 'Supabase Secrets에 BODYCODI_API_KEY 값이 아직 없어요.', missing: ['BODYCODI_API_KEY'] }, 500);
    }
    const ctx: Ctx = { base: BASE, key: KEY, fetchFn: fetch };

    // 2) 연결 확인 - 개인정보는 돌려주지 않고 개수/형식만
    if (action === 'ping') {
      const pageBase = await detectPageBase(ctx);
      const j = await bcGet(ctx, MEMBERS_PATH, { page: pageBase, withTotal: true });
      const rows = rowsOf(j) as BodycodiMember[];
      const passStates: Record<string, number> = {};
      for (const r of rows) { const k = String(r.passState ?? 'null'); passStates[k] = (passStates[k] || 0) + 1; }
      return json({
        ok: true, base_url: BASE, total: typeof j?.total === 'number' ? j.total : null,
        first_page_count: rows.length, has_more: j?.hasMore === true, page_base: pageBase,
        names_masked: rows.length ? rows.filter((r) => isMaskedName(r.name)).length : 0,
        phones_masked: rows.length ? rows.filter((r) => r.phone && isMaskedPhone(r.phone)).length : 0,
        phones_empty: rows.filter((r) => !r.phone).length,
        with_last_visit: rows.filter((r) => !!r.lastVisitAt).length,
        pass_states: passStates,
        fields: rows[0] ? Object.keys(rows[0]) : [],
      });
    }

    if (action !== 'preview' && action !== 'apply') return json({ error: '알 수 없는 요청이에요.' }, 400);
    if (isScheduled && action !== 'apply') return json({ error: '예약 실행은 apply만 가능해요.' }, 400);

    // 3) 바디코디 회원 전체 + 앱 회원 전체를 받아 매칭
    const fetched = await fetchAllMembers(ctx);
    const appMembers = await loadAppMembers(SUPABASE_URL, SERVICE);
    const m = matchMembers(fetched.members, appMembers);
    const nowIso = new Date().toISOString();
    const changes = planChanges(m.matched, nowIso);

    const summary = {
      body_total: fetched.total ?? fetched.members.length, body_fetched: fetched.members.length,
      app_total: appMembers.length,
      matched: m.matched.length,
      matched_by: {
        id: m.matched.filter((x) => x.how === 'id').length,
        phone: m.matched.filter((x) => x.how === 'phone').length,
        name_last4: m.matched.filter((x) => x.how === 'name_last4').length,
      },
      ambiguous: m.ambiguous.length, unmatched_body: m.unmatchedBody.length, unmatched_app: m.unmatchedApp.length,
      will_change: changes.length,
      will_change_last_visit: changes.filter((c) => c.last_visit).length,
      truncated: fetched.truncated, page_base: fetched.pageBase,
    };

    if (action === 'preview') {
      return json({
        ok: true, mode: 'preview', summary,
        samples: {
          changes: changes.slice(0, 15).map((c) => ({ name: c.app_name, last_visit: c.last_visit, link: 'bodycodi_member_id' in c.patch })),
          ambiguous: m.ambiguous.slice(0, 20).map((x) => ({ body: sanitizeBody(x.body), candidates: x.candidates.map((c) => ({ name: c.name, phone_last4: digitsOnly(c.phone).slice(-4), join_date: c.join_date })) })),
          unmatched_body: m.unmatchedBody.slice(0, 20).map(sanitizeBody),
          unmatched_app: m.unmatchedApp.slice(0, 20).map((a) => ({ name: a.name, phone_last4: digitsOnly(a.phone).slice(-4), join_date: a.join_date })),
        },
      });
    }

    // 4) apply: 매칭된 회원만 반영 (애매한 회원 / 못 찾은 회원은 건드리지 않음)
    if (fetched.truncated) {
      return json({ error: '바디코디 회원을 끝까지 다 받지 못해서(시간 제한) 반영하지 않았어요. 잠시 뒤 다시 시도해주세요.', summary }, 504);
    }
    const sb = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    let updated = 0; const errors: string[] = [];
    for (let i = 0; i < changes.length; i += WRITE_CONCURRENCY) {
      const chunk = changes.slice(i, i + WRITE_CONCURRENCY);
      const rs = await Promise.all(chunk.map(async (c) => {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/members?id=eq.${c.app_id}`, { method: 'PATCH', headers: sb, body: JSON.stringify(c.patch) });
        return { c, ok: r.ok, text: r.ok ? '' : await r.text() };
      }));
      for (const x of rs) { if (x.ok) updated++; else errors.push(`${x.c.app_name}: ${x.text.slice(0, 100)}`); }
    }
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/bodycodi_sync_logs`, {
        method: 'POST', headers: sb,
        body: JSON.stringify({
          run_by: runBy, trigger: isScheduled ? 'scheduled' : 'manual', body_total: summary.body_total, matched: summary.matched,
          ambiguous: summary.ambiguous, unmatched_body: summary.unmatched_body, updated, error_count: errors.length,
          error_text: errors.slice(0, 5).join(' / ') || null,
        }),
      });
    } catch (_e) { /* 로그 기록 실패는 결과 전달을 막지 않음 */ }
    return json({ ok: true, mode: 'apply', summary, updated, error_count: errors.length, errors: errors.slice(0, 10), synced_at: nowIso });
  } catch (e) {
    if (e instanceof BodycodiError) return json({ error: e.message, bodycodi_status: e.status }, e.status === 401 || e.status === 403 ? 502 : 500);
    return json({ error: '바디코디 연동 중 문제가 생겼어요: ' + (e instanceof Error ? e.message : String(e)) }, 500);
  }
}

// Deno(Supabase Edge Function)에서만 서버를 띄움 - 로컬 테스트에서 이 파일을 import 해도 안 뜨게 함
// deno-lint-ignore no-explicit-any
if (typeof (globalThis as any).Deno !== 'undefined') {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno.serve(handler);
}
