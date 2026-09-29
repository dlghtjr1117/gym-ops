-- 그룹PT 출석 체크 + 포인트/보상 시스템
-- "그룹PT 참석률을 올리고 싶다"는 요청으로, 회원님이 프런트 QR을 본인 휴대폰으로 스캔하면
--   1) 로그인 없이 이름/전화번호 뒷자리로 본인을 찾고
--   2) 그날 발급된 QR로 스캔했을 때만 오늘 칸에 "출석하기" 버튼이 뜨고
--   3) 누르면 포인트가 쌓이고, 30/60/90일 등 누적 출석일수에 따라 보상(스티커팩/티셔츠/텀블러 등)에
--      얼마나 가까워졌는지 본인 화면에서 바로 확인
-- 할 수 있게 만든 기능. 이 회원용 화면(attend.html)은 지금까지의 다른 모든 화면과 달리 "로그인 없이"
-- 인터넷에 열려있는 화면이라, 아래 함수들은 이 프로젝트에서 처음으로 anon(로그인 안 한 사용자) 권한을
-- 일부 내어주는 예외임 - 그래서 원본 테이블에는 anon 권한을 전혀 주지 않고, 딱 필요한 것만 돌려주는
-- SECURITY DEFINER 함수(get_pt_trainer_leaderboard와 같은 패턴) 4개를 통해서만 접근하게 만듦.

-- ---- 오늘의 출석 QR (관리자 화면 "오늘의 출석 QR 열기" 버튼이 이 테이블에 오늘 날짜 행을 하나 만듦) ----
create table group_pt_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  token_date date not null unique,
  token text not null default gen_random_uuid()::text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);
alter table group_pt_qr_tokens enable row level security;
create policy "출석QR 조회" on group_pt_qr_tokens for select using (auth.uid() is not null);
create policy "출석QR 발급" on group_pt_qr_tokens for insert with check (auth.uid() is not null);

-- ---- 출석 기록 (회원당 하루에 한 번만 - unique 제약으로 중복 출석 방지) ----
create table group_pt_attendance (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  attendance_date date not null,
  method text not null default 'qr' check (method in ('qr', 'manual')),
  checked_in_by uuid references profiles(id), -- 'manual'(직원이 대신 체크)일 때만 채워짐
  created_at timestamptz not null default now(),
  unique (member_id, attendance_date)
);
alter table group_pt_attendance enable row level security;
create policy "그룹PT출석 조회" on group_pt_attendance for select using (auth.uid() is not null);
create policy "그룹PT출석 수동등록" on group_pt_attendance for insert with check (auth.uid() is not null);
create policy "그룹PT출석 삭제" on group_pt_attendance for delete using (auth.uid() is not null);
create index group_pt_attendance_member_idx on group_pt_attendance (member_id, attendance_date desc);

-- ---- 보상 단계 설정 (며칠 출석 시 뭘 주는지 - 관리자 화면에서 직접 수정 가능) ----
create table group_pt_reward_tiers (
  id uuid primary key default gen_random_uuid(),
  days_required integer not null unique check (days_required > 0),
  reward_name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table group_pt_reward_tiers enable row level security;
create policy "보상단계 조회" on group_pt_reward_tiers for select using (auth.uid() is not null);
create policy "보상단계 등록" on group_pt_reward_tiers for insert with check (auth.uid() is not null);
create policy "보상단계 수정" on group_pt_reward_tiers for update using (auth.uid() is not null);
create policy "보상단계 삭제" on group_pt_reward_tiers for delete using (auth.uid() is not null);

-- 처음 상의했던 예시 그대로 기본값 3단계를 넣어둠 - 관리자 화면 "보상 단계 설정"에서 언제든 바꿀 수 있음
insert into group_pt_reward_tiers (days_required, reward_name, sort_order) values
  (30, '스티커팩', 1),
  (60, '티셔츠', 2),
  (90, '스탠리 텀블러', 3);

-- ---- 보상 달성/지급 현황 (출석 체크 시 자동으로 채워지고, 직원이 실물 전달 후 "지급 완료" 처리) ----
create table group_pt_reward_claims (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  tier_id uuid not null references group_pt_reward_tiers(id) on delete cascade,
  achieved_at date not null default current_date,
  fulfilled boolean not null default false,
  fulfilled_at timestamptz,
  fulfilled_by uuid references profiles(id),
  unique (member_id, tier_id)
);
alter table group_pt_reward_claims enable row level security;
create policy "보상수령 조회" on group_pt_reward_claims for select using (auth.uid() is not null);
create policy "보상수령 등록" on group_pt_reward_claims for insert with check (auth.uid() is not null);
create policy "보상수령 수정" on group_pt_reward_claims for update using (auth.uid() is not null);


-- ============================================================================
-- 회원용 공개 함수 4개 - anon 키로 호출됨(로그인 세션 없음). SECURITY DEFINER라 원본 테이블의
-- RLS(auth.uid() is not null 조건)를 우회하지만, 함수가 돌려주는 값 자체를 이름/전화번호 뒷4자리/
-- 본인 출석 기록처럼 민감하지 않은 최소한의 정보로만 제한해서 안전하게 열어둠.
-- ============================================================================

-- 이름 또는 전화번호 뒷자리 4자리로 그룹PT 회원 검색(최초 1회 본인 확인용). 전화번호 전체나 주소·메모
-- 같은 다른 회원 정보는 절대 안 돌려줌
create or replace function group_pt_search_members(p_query text)
returns table (member_id uuid, display_name text, phone_hint text, class_label text)
language sql
security definer
set search_path = public
as $$
  select
    m.id,
    m.name,
    case when m.phone is not null and length(regexp_replace(m.phone, '[^0-9]', '', 'g')) >= 4
      then '010-****-' || right(regexp_replace(m.phone, '[^0-9]', '', 'g'), 4)
      else null end,
    m.group_pt_type
  from members m
  where m.group_pt_type is not null
    and length(trim(p_query)) >= 2
    and (
      m.name ilike '%' || trim(p_query) || '%'
      or (
        length(regexp_replace(p_query, '[^0-9]', '', 'g')) = 4
        and right(regexp_replace(coalesce(m.phone, ''), '[^0-9]', '', 'g'), 4) = regexp_replace(p_query, '[^0-9]', '', 'g')
      )
    )
  order by m.name
  limit 8;
$$;
grant execute on function group_pt_search_members(text) to anon;

-- 오늘 QR로 스캔해서 들어온 게 맞는지 확인(캘린더의 오늘 칸에 "출석하기" 버튼을 보여줄지 결정하는 용도)
create or replace function group_pt_validate_token(p_token text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from group_pt_qr_tokens where token_date = current_date and token = p_token
  );
$$;
grant execute on function group_pt_validate_token(text) to anon;

-- 실제 출석 체크 - 오늘 발급된 토큰이 맞는지, 오늘 이미 체크했는지를 함수 안에서 서버 기준으로
-- 다시 한번 검증함(클라이언트가 보낸 날짜를 그대로 믿지 않음 - current_date는 항상 DB 서버 시각 기준)
create or replace function group_pt_checkin(p_member_id uuid, p_token text)
returns table (ok boolean, message text, points_earned integer, total_points integer, total_days integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valid boolean;
  v_already boolean;
  v_total_days integer;
  v_points_per_checkin constant integer := 10;
begin
  if not exists (select 1 from members where id = p_member_id and group_pt_type is not null) then
    return query select false, '회원 정보를 찾을 수 없어요.', 0, 0, 0;
    return;
  end if;

  select exists (
    select 1 from group_pt_qr_tokens where token_date = current_date and token = p_token
  ) into v_valid;
  if not v_valid then
    return query select false, 'QR이 만료됐어요. 화면의 최신 QR로 다시 스캔해주세요.', 0, 0, 0;
    return;
  end if;

  select exists (
    select 1 from group_pt_attendance where member_id = p_member_id and attendance_date = current_date
  ) into v_already;
  if v_already then
    return query select false, '오늘은 이미 출석 체크하셨어요.', 0, 0, 0;
    return;
  end if;

  insert into group_pt_attendance (member_id, attendance_date, method)
  values (p_member_id, current_date, 'qr');

  select count(*) into v_total_days from group_pt_attendance where member_id = p_member_id;

  -- 이번 출석으로 새로 넘어선 보상 단계가 있으면 "지급 대기"로 자동 등록(관리자 화면 "보상 지급 대기"에 뜸)
  insert into group_pt_reward_claims (member_id, tier_id, achieved_at)
  select p_member_id, t.id, current_date
  from group_pt_reward_tiers t
  where t.days_required <= v_total_days
    and not exists (
      select 1 from group_pt_reward_claims c where c.member_id = p_member_id and c.tier_id = t.id
    );

  return query select true, '출석 체크 완료!', v_points_per_checkin, v_total_days * v_points_per_checkin, v_total_days;
end;
$$;
grant execute on function group_pt_checkin(uuid, text) to anon;

-- 회원 본인의 출석 현황(캘린더/연속·누적 출석/포인트/보상 로드맵) 조회 - "나의 출석 기록" 화면용.
-- QR을 다시 스캔하지 않아도 언제든 불러볼 수 있음(휴대폰에 저장해둔 member_id로 호출)
create or replace function group_pt_get_member_status(p_member_id uuid)
returns table (
  display_name text,
  class_label text,
  total_days integer,
  total_points integer,
  attendance_dates date[],
  tiers jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points_per_checkin constant integer := 10;
begin
  return query
  select
    m.name,
    m.group_pt_type,
    coalesce(a.cnt, 0)::int,
    coalesce(a.cnt, 0)::int * v_points_per_checkin,
    coalesce(a.dates, array[]::date[]),
    coalesce(t.tiers, '[]'::jsonb)
  from members m
  left join (
    select member_id, count(*) as cnt, array_agg(attendance_date order by attendance_date) as dates
    from group_pt_attendance
    where member_id = p_member_id
    group by member_id
  ) a on true
  left join (
    select jsonb_agg(jsonb_build_object(
      'days_required', gt.days_required,
      'reward_name', gt.reward_name,
      'achieved', c.id is not null,
      'fulfilled', coalesce(c.fulfilled, false)
    ) order by gt.days_required) as tiers
    from group_pt_reward_tiers gt
    left join group_pt_reward_claims c on c.tier_id = gt.id and c.member_id = p_member_id
  ) t on true
  where m.id = p_member_id;
end;
$$;
grant execute on function group_pt_get_member_status(uuid) to anon;
