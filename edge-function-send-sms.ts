// Supabase Edge Function: "send-sms"
//
// 신규상담 화면의 "처리 완료 보관함"에서 이월·거부 회원에게 이벤트 문자 등을 보낼 때 호출되는 함수예요.
// Supabase 대시보드 > Edge Functions > "Deploy a new function" > "Via Editor"에서 새 함수를 만들고
// (이름: send-sms) 이 코드를 그대로 붙여넣은 뒤 "Deploy function"을 누르면 됩니다.
// (자세한 순서는 SMS_SETUP.md 참고 - 문자 업체 가입, 발신번호 등록, 비밀값 등록까지 정리해놨어요)
//
// 왜 브라우저가 아니라 이 함수가 보내나요?
//  - 문자 업체 API 키/시크릿은 절대 화면(브라우저)이나 GitHub에 있으면 안 돼서, Supabase 비밀값(Secrets)에만 둠
//  - "지점장만 발송 가능", "(광고) 표기/수신거부 문구 자동 첨부", "밤 9시~아침 8시 발송 차단" 같은 규칙을
//    화면이 아니라 서버에서 강제해야 우회가 안 됨
//
// 필요한 Secrets (Edge Functions > Secrets):
//   SOLAPI_API_KEY      문자 업체(SOLAPI) API Key
//   SOLAPI_API_SECRET   문자 업체(SOLAPI) API Secret
//   SOLAPI_SENDER       문자 업체에 미리 등록·인증해둔 발신번호 (숫자만, 예: 0212345678)
//   CENTER_NAME         문자에 들어갈 업체명 (예: OO휘트니스)
//   OPTOUT_NUMBER       무료수신거부 080 번호 (숫자만 또는 하이픈 포함 모두 가능, 예: 0801234567)
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 는 Supabase가 자동으로 넣어줘요)
//
// ※ 문자 업체 발송 주소/요청 형식(아래 SOLAPI_SEND_URL, messages 배열)은 SOLAPI의 "send-many/detail"
//   형식을 따랐지만, 실제 계정으로 처음 한 명에게 테스트 발송해서 꼭 확인해주세요. 응답 형식이 다르면
//   이 파일의 sendViaSolapi() 부분만 고치면 됩니다.

const SOLAPI_SEND_URL = 'https://api.solapi.com/messages/v4/send-many/detail';
const MAX_RECIPIENTS = 300;     // 한 번에 보낼 수 있는 최대 인원 (실수로 전체 발송하는 것 방지)
const MAX_MESSAGE_CHARS = 1000; // 직원이 쓰는 본문 최대 글자수
const SMS_MAX_BYTES = 90;       // 이 길이 이하면 단문(SMS), 넘으면 장문(LMS)
const LMS_MAX_BYTES = 2000;
const SUBJECT_MAX_BYTES = 40;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ---------------------------------------------------------------------------
// 순수 함수들 (네트워크 안 씀 - 로컬에서 따로 테스트할 수 있게 분리해둠)
// ---------------------------------------------------------------------------

// 한글=2바이트, 영문/숫자/기호/줄바꿈=1바이트로 센 길이 (문자 업체가 쓰는 EUC-KR 방식과 같게 맞춤)
export function byteLength(s: string): number {
  let n = 0;
  for (const ch of s) n += ch.charCodeAt(0) <= 0x7f ? 1 : 2;
  return n;
}

export function truncateBytes(s: string, maxBytes: number): string {
  let out = '';
  let n = 0;
  for (const ch of s) {
    const b = ch.charCodeAt(0) <= 0x7f ? 1 : 2;
    if (n + b > maxBytes) break;
    out += ch;
    n += b;
  }
  return out;
}

// 전화번호를 숫자만 남기고 010... 형식이 맞는지 확인. 맞으면 숫자만, 아니면 null
export function normalizeMobile(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('82') && d.length >= 11) d = '0' + d.slice(2); // +82 10... 형태
  if (d.length === 10 && d[0] !== '0') d = '0' + d;               // 앞 0이 빠진 번호
  return /^01[016789]\d{7,8}$/.test(d) ? d : null;
}

// 한국 시간(KST) 기준 시각 - 서버 시간대와 상관없이 항상 KST로 계산
export function kstHour(now: Date = new Date()): number {
  return new Date(now.getTime() + 9 * 3600 * 1000).getUTCHours();
}
// 정보통신망법: 광고성 문자는 밤 9시 ~ 다음날 아침 8시 사이 발송 금지
export function isNightBlocked(now: Date = new Date()): boolean {
  const h = kstHour(now);
  return h >= 21 || h < 8;
}

// 직원이 쓴 본문에 (광고) 표기, 업체명, 무료수신거부 안내를 붙여 "실제로 나가는 문구"를 만듦
export function buildFinalText(
  message: string, isAd: boolean, centerName: string, optout: string
): { text: string; subject: string; type: 'SMS' | 'LMS'; bytes: number } {
  const body = message.trim();
  let text: string;
  if (isAd) {
    text = `(광고)${centerName}\n${body}\n무료수신거부 ${optout}`;
  } else {
    text = body;
  }
  const bytes = byteLength(text);
  const type = bytes <= SMS_MAX_BYTES ? 'SMS' : 'LMS';
  // 장문(LMS)은 제목이 필요함. 광고면 제목에도 (광고) 표기 (2026-03부터 LMS/MMS 제목에도 필요)
  const subject = truncateBytes(isAd ? `(광고)${centerName}` : centerName, SUBJECT_MAX_BYTES);
  return { text, subject, type, bytes };
}

// "080-123-4567" 같은 입력을 보기 좋게 정리 (그냥 숫자/하이픈만 남김)
export function cleanOptout(raw: string): string {
  return String(raw || '').replace(/[^\d-]/g, '');
}

// SOLAPI 인증 헤더: HMAC-SHA256, 서명 대상 = date + salt, 키 = API Secret (SOLAPI 공식 인증 문서 기준)
export async function solapiAuthHeader(apiKey: string, apiSecret: string, now: Date = new Date()): Promise<string> {
  const date = now.toISOString().replace(/\.\d{3}Z$/, 'Z'); // 예: 2026-10-06T01:02:03Z
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = Array.from(saltBytes, (b) => b.toString(16).padStart(2, '0')).join(''); // 32자
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(date + salt));
  const signature = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

// ---------------------------------------------------------------------------
// 문자 업체(SOLAPI) 호출
// ---------------------------------------------------------------------------
type Recipient = { consult_id: string | null; name: string; phone: string };
type Result = { consult_id: string | null; name: string; phone: string; status: 'sent' | 'failed'; error?: string };

async function sendViaSolapi(
  recipients: Recipient[], built: ReturnType<typeof buildFinalText>,
  apiKey: string, apiSecret: string, sender: string
): Promise<Result[]> {
  const messages = recipients.map((r) => {
    const m: Record<string, string> = { to: r.phone, from: sender, text: built.text, type: built.type };
    if (built.type === 'LMS') m.subject = built.subject;
    return m;
  });

  let res: Response;
  try {
    res = await fetch(SOLAPI_SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': await solapiAuthHeader(apiKey, apiSecret),
      },
      body: JSON.stringify({ messages, showMessageList: true }),
    });
  } catch (e) {
    const msg = '문자 업체에 연결하지 못했어요: ' + (e instanceof Error ? e.message : String(e));
    return recipients.map((r) => ({ ...r, status: 'failed' as const, error: msg }));
  }

  const raw = await res.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch { /* 응답이 JSON이 아니면 raw 그대로 오류로 보여줌 */ }

  if (!res.ok) {
    const msg = (json && (json.errorMessage || json.message || json.errorCode)) || raw.slice(0, 200) || `HTTP ${res.status}`;
    return recipients.map((r) => ({ ...r, status: 'failed' as const, error: String(msg) }));
  }

  // 일부만 실패한 경우: failedMessageList에 들어있는 번호는 실패로, 나머지는 접수 성공으로 처리
  const failedByPhone = new Map<string, string>();
  const failedList = (json && Array.isArray(json.failedMessageList)) ? json.failedMessageList : [];
  for (const f of failedList) {
    const to = String(f.to ?? '').replace(/\D/g, '');
    failedByPhone.set(to, String(f.statusMessage || f.reason || f.errorMessage || f.statusCode || '발송 실패'));
  }
  return recipients.map((r) => {
    const err = failedByPhone.get(r.phone);
    return err ? { ...r, status: 'failed' as const, error: err } : { ...r, status: 'sent' as const };
  });
}

// ---------------------------------------------------------------------------
// 요청 처리
// ---------------------------------------------------------------------------
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST만 가능해요.' }, 405);

  try {
    const env = (k: string) => Deno.env.get(k) || '';
    const SUPABASE_URL = env('SUPABASE_URL');
    const ANON = env('SUPABASE_ANON_KEY');
    const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');
    const API_KEY = env('SOLAPI_API_KEY');
    const API_SECRET = env('SOLAPI_API_SECRET');
    const SENDER = env('SOLAPI_SENDER').replace(/\D/g, '');
    const CENTER_NAME = env('CENTER_NAME').trim();
    const OPTOUT = cleanOptout(env('OPTOUT_NUMBER'));

    const missing = [
      !API_KEY && 'SOLAPI_API_KEY', !API_SECRET && 'SOLAPI_API_SECRET', !SENDER && 'SOLAPI_SENDER',
      !CENTER_NAME && 'CENTER_NAME', !OPTOUT && 'OPTOUT_NUMBER',
    ].filter(Boolean) as string[];

    // 1) 로그인한 사람이 누구인지 확인 + 지점장인지 확인
    const authHeader = req.headers.get('Authorization') || '';
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: authHeader } });
    if (!userRes.ok) return json({ error: '로그인 정보를 확인하지 못했어요. 다시 로그인해주세요.' }, 401);
    const user = await userRes.json();
    const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=id,role`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    const prof = profRes.ok ? (await profRes.json())[0] : null;
    if (!prof || prof.role !== 'manager') return json({ error: '문자 발송은 지점장 계정만 할 수 있어요.' }, 403);

    // 2) 요청 내용 검사
    const body = await req.json().catch(() => null);

    // 화면이 "문자 보내기" 창을 열 때 미리보기용으로 부르는 요청 - 실제로 보내지 않고 업체명/수신거부번호/
    // 지금 발송 가능한 시간인지만 알려줌 (비밀값 자체는 절대 안 내보냄)
    if (body?.action === 'info') {
      return json({
        ok: true, center_name: CENTER_NAME, optout_number: OPTOUT,
        night_blocked: isNightBlocked(), missing,
      });
    }
    if (missing.length) {
      return json({ error: `Supabase Secrets에 ${missing.join(', ')} 값이 아직 없어요. SMS_SETUP.md를 확인해주세요.` }, 500);
    }

    const message = String(body?.message ?? '').trim();
    const isAd = body?.is_ad !== false; // 기본은 광고 문자 (끌 수 있지만 화면에서는 켜둔 채로만 쓰도록 함)
    const rawRecipients: any[] = Array.isArray(body?.recipients) ? body.recipients : [];
    if (!message) return json({ error: '문자 내용이 비어있어요.' }, 400);
    if (message.length > MAX_MESSAGE_CHARS) return json({ error: `문자 내용은 ${MAX_MESSAGE_CHARS}자까지만 가능해요.` }, 400);
    if (rawRecipients.length === 0) return json({ error: '받는 사람이 없어요.' }, 400);
    if (rawRecipients.length > MAX_RECIPIENTS) return json({ error: `한 번에 ${MAX_RECIPIENTS}명까지만 보낼 수 있어요.` }, 400);

    // 3) 광고 문자는 밤 9시~아침 8시(한국 시간) 발송 금지
    if (isAd && isNightBlocked()) {
      return json({ error: '광고성 문자는 밤 9시부터 다음 날 아침 8시까지 보낼 수 없어요(법 규정). 아침 8시 이후에 다시 시도해주세요.' }, 400);
    }

    // 4) 번호 정리: 형식이 틀린 번호는 실패 처리, 중복 번호는 한 번만
    const valid: Recipient[] = [];
    const results: Result[] = [];
    const seen = new Set<string>();
    for (const r of rawRecipients) {
      const phone = normalizeMobile(r?.phone);
      const name = String(r?.name ?? '').slice(0, 50);
      const consult_id = r?.consult_id ? String(r.consult_id) : null;
      if (!phone) { results.push({ consult_id, name, phone: String(r?.phone ?? ''), status: 'failed', error: '휴대폰 번호 형식이 아니에요' }); continue; }
      if (seen.has(phone)) { results.push({ consult_id, name, phone, status: 'failed', error: '같은 번호가 중복돼서 한 번만 보냈어요' }); continue; }
      seen.add(phone);
      valid.push({ consult_id, name, phone });
    }

    const built = buildFinalText(message, isAd, CENTER_NAME, OPTOUT);
    if (built.bytes > LMS_MAX_BYTES) return json({ error: `문자가 너무 길어요(${built.bytes}바이트). 장문 문자는 ${LMS_MAX_BYTES}바이트(한글 약 1000자)까지예요.` }, 400);

    // 5) 실제 발송
    if (valid.length > 0) {
      results.push(...await sendViaSolapi(valid, built, API_KEY, API_SECRET, SENDER));
    }

    // 6) 발송 이력 기록 (서버 권한으로만 쓸 수 있는 표)
    const success = results.filter((r) => r.status === 'sent').length;
    const sbHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    let campaignId: string | null = null;
    try {
      const cRes = await fetch(`${SUPABASE_URL}/rest/v1/sms_campaigns`, {
        method: 'POST', headers: sbHeaders,
        body: JSON.stringify({
          sent_by: user.id, message, final_text: built.text, is_ad: isAd,
          recipient_count: results.length, success_count: success, fail_count: results.length - success,
        }),
      });
      if (cRes.ok) {
        campaignId = (await cRes.json())[0]?.id ?? null;
        if (campaignId) {
          await fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
            method: 'POST', headers: { ...sbHeaders, Prefer: 'return=minimal' },
            body: JSON.stringify(results.map((r) => ({
              campaign_id: campaignId, consult_id: r.consult_id, name: r.name, phone: r.phone,
              status: r.status, error: r.error ?? null,
            }))),
          });
        }
      }
    } catch (_e) { /* 이력 기록이 실패해도 이미 나간 문자 결과는 화면에 알려줘야 하니 여기서 멈추지 않음 */ }

    return json({
      ok: true, type: built.type, bytes: built.bytes, final_text: built.text,
      success_count: success, fail_count: results.length - success, results,
    });
  } catch (e) {
    return json({ error: '문자 발송 중 알 수 없는 문제가 생겼어요: ' + (e instanceof Error ? e.message : String(e)) }, 500);
  }
}

// Deno(Supabase Edge Function)에서만 서버를 띄움 - 로컬 테스트에서 이 파일을 import 해도 안 뜨게 함
// deno-lint-ignore no-explicit-any
if (typeof (globalThis as any).Deno !== 'undefined') {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno.serve(handler);
}
