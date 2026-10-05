-- 휴대폰 "전화 왔을 때 자동으로 기록" 연동 기능.
--
-- 익시오 같은 통화요약 앱은 외부 연동(API/웹훅)을 공식적으로 지원하지 않아서, 통화 "내용"까지
-- 100% 자동으로 가져오는 건 불가능함. 대신 안드로이드 자동화 앱(Tasker 등)으로 "전화가 끝났다"는
-- 이벤트와 상대방 번호·통화시간은 자동으로 잡을 수 있어서, 이 부분만 자동화하고 - "무슨 내용이었는지"는
-- 익시오 요약을 복사해서 gym-ops 화면에 붙여넣기만 하면 되도록 함(타이핑은 안 해도 됨).
--
-- 흐름: ① 직원이 staff.html에서 본인 전용 연동 토큰 발급 ② 본인 휴대폰 Tasker에 그 토큰으로 webhook
-- 설정 ③ 전화가 끝나면 Tasker가 log_call_event()를 호출해서 call_events에 자동으로 한 줄 쌓임(번호로
-- 회원 자동 매칭도 됨) ④ expiry.html의 "자동 통화 기록함"에서 그 줄을 보고 익시오 요약을 붙여넣어
-- TM 기록으로 저장(또는 무시)
--
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요.

create table if not exists call_webhook_tokens (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references profiles(id) on delete cascade,
  token text not null unique,
  label text,                      -- 예: '내 갤럭시'
  active boolean not null default true,
  created_at timestamptz default now(),
  last_used_at timestamptz
);

create table if not exists call_events (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references profiles(id),
  phone text,                              -- 통화 상대방 번호(숫자만, normalizePhone과 같은 규칙)
  direction text default 'unknown',        -- incoming/outgoing/missed/unknown - Tasker 설정에 따라 못 보낼 수도 있어서 느슨하게 둠
  duration_seconds int,
  called_at timestamptz not null default now(),
  matched_member_id uuid references members(id),  -- 번호로 자동 매칭된 회원(없으면 null)
  summary_text text,                       -- 사람이 나중에 붙여넣는 익시오 요약
  status text not null default 'new' check (status in ('new','logged','ignored')),
  tm_log_id uuid references tm_logs(id),   -- TM 기록으로 저장했으면 그 tm_logs.id
  created_at timestamptz default now()
);

create index if not exists call_events_staff_idx on call_events(staff_id, called_at desc);
create index if not exists call_events_status_idx on call_events(status);
create index if not exists call_events_matched_member_idx on call_events(matched_member_id);

alter table call_webhook_tokens enable row level security;
alter table call_events enable row level security;

-- 토큰: 본인 것만 보고 만들고 지울 수 있음(각자 자기 휴대폰용 토큰을 직접 발급), 지점장은 전체 조회만 가능
drop policy if exists "통화연동 토큰 조회" on call_webhook_tokens;
create policy "통화연동 토큰 조회" on call_webhook_tokens for select using (is_manager() or staff_id = auth.uid());
drop policy if exists "통화연동 토큰 등록" on call_webhook_tokens;
create policy "통화연동 토큰 등록" on call_webhook_tokens for insert with check (staff_id = auth.uid());
drop policy if exists "통화연동 토큰 수정" on call_webhook_tokens;
create policy "통화연동 토큰 수정" on call_webhook_tokens for update using (is_manager() or staff_id = auth.uid());
drop policy if exists "통화연동 토큰 삭제" on call_webhook_tokens;
create policy "통화연동 토큰 삭제" on call_webhook_tokens for delete using (is_manager() or staff_id = auth.uid());

-- 통화 기록: 지점장은 전체, 트레이너는 본인 담당(staff_id) 것만. insert는 아래 SECURITY DEFINER
-- 함수를 통해서만 이루어지고(Tasker가 로그인 세션 없이 호출) 원본 테이블에는 anon/authenticated
-- insert 권한을 아예 안 줌.
drop policy if exists "통화기록 조회" on call_events;
create policy "통화기록 조회" on call_events for select using (is_manager() or staff_id = auth.uid());
drop policy if exists "통화기록 수정" on call_events;
create policy "통화기록 수정" on call_events for update using (is_manager() or staff_id = auth.uid());

-- Tasker가 로그인 없이(anon 키로) 호출하는 함수. p_token으로 어느 직원 건지 확인하고, 원본
-- 테이블에는 전혀 접근 권한을 안 준 채 이 함수로만 한 줄 추가하게 함(QR 출석 체크용
-- group_pt_checkin과 같은 방식).
create or replace function log_call_event(
  p_token text,
  p_phone text,
  p_duration_seconds int default null,
  p_direction text default 'unknown',
  p_called_at timestamptz default now()
)
returns table(ok boolean, message text, matched_member_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_clean_phone text;
  v_member_id uuid;
  v_member_name text;
begin
  select staff_id into v_staff_id from call_webhook_tokens where token = p_token and active;
  if v_staff_id is null then
    return query select false, '유효하지 않은 토큰이에요. staff.html에서 발급받은 토큰을 다시 확인해주세요.', null::text;
    return;
  end if;

  update call_webhook_tokens set last_used_at = now() where token = p_token;

  v_clean_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_clean_phone) = 10 and left(v_clean_phone, 1) <> '0' then
    v_clean_phone := '0' || v_clean_phone;
  end if;
  if v_clean_phone = '' then
    v_clean_phone := null;
  end if;

  if v_clean_phone is not null then
    select id, name into v_member_id, v_member_name
    from members where phone = v_clean_phone limit 1;
  end if;

  insert into call_events (staff_id, phone, direction, duration_seconds, called_at, matched_member_id)
  values (
    v_staff_id, v_clean_phone, coalesce(nullif(p_direction, ''), 'unknown'),
    p_duration_seconds, coalesce(p_called_at, now()), v_member_id
  );

  return query select
    true,
    case when v_member_id is not null then '기록 완료 (' || v_member_name || '님 자동 매칭됨)'
         else '기록 완료 (번호로 매칭되는 회원이 없어요)' end,
    v_member_name;
end;
$$;

grant execute on function log_call_event(text, text, int, text, timestamptz) to anon;
