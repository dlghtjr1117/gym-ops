-- 그룹PT "이달의 출석왕" MVP 추가 포인트 (1등 100P / 2등 70P / 3등 50P)
-- 처음엔 "월말 넘어가기 전날"에 받게 하려 했는데, 그날 자정까지도 순위가 계속 바뀔 수 있어서
-- (마지막 날 늦은 시간에 출석하는 회원 때문에 순위가 막판에 뒤집힐 수 있음) "다음 달 1일이 되면
-- (그때는 지난달 출석이 더 이상 안 바뀌니까) 지난달 1/2/3등 보상을 받을 수 있게" 하는 방식으로 바꿈.
-- 그래서 여기 함수들은 항상 "지난달(현재 날짜 기준 바로 전 달)" 순위를 다시 서버에서 계산해서
-- 확인하고, 회원이 보낸 등수/포인트는 절대 믿지 않음.

create table group_pt_mvp_bonus_claims (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  bonus_year integer not null,
  bonus_month integer not null,
  rank integer not null check (rank in (1, 2, 3)),
  bonus_points integer not null,
  claimed_at timestamptz not null default now(),
  unique (member_id, bonus_year, bonus_month) -- 회원당 그 달 보너스는 딱 한 번만
);
alter table group_pt_mvp_bonus_claims enable row level security;
create policy "MVP보너스 조회" on group_pt_mvp_bonus_claims for select using (auth.uid() is not null);
-- insert는 아래 group_pt_mvp_bonus_claim() 함수(SECURITY DEFINER)를 통해서만 이뤄짐 -
-- anon에게 이 테이블 자체의 insert 권한은 전혀 안 줌(등수/포인트 조작 방지)

-- 로그인 화면(attend.html)에서 "지난달 보너스가 남아있는지" 확인할 때 씀. 지난달 TOP3였는지,
-- 이미 받았는지를 매번 서버에서 다시 계산해서 돌려줌
create or replace function group_pt_mvp_bonus_status(p_member_id uuid)
returns table (
  available boolean,
  already_claimed boolean,
  rank integer,
  bonus_points integer,
  bonus_year integer,
  bonus_month integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_month_start date := date_trunc('month', current_date - interval '1 month')::date;
  v_prev_month_end date := date_trunc('month', current_date)::date;
  v_year integer := extract(year from v_prev_month_start)::int;
  v_month integer := extract(month from v_prev_month_start)::int;
  v_rank integer;
  v_bonus integer;
  v_claimed boolean;
begin
  select r.rnk into v_rank
  from (
    select a.member_id, row_number() over (order by count(*) desc, a.member_id) as rnk
    from group_pt_attendance a
    join members m on m.id = a.member_id and m.group_pt_type is not null
    where a.attendance_date >= v_prev_month_start and a.attendance_date < v_prev_month_end
    group by a.member_id
  ) r
  where r.member_id = p_member_id and r.rnk <= 3;

  if v_rank is null then
    return query select false, false, null::int, null::int, v_year, v_month;
    return;
  end if;

  v_bonus := case v_rank when 1 then 100 when 2 then 70 when 3 then 50 end;

  select exists (
    select 1 from group_pt_mvp_bonus_claims
    where member_id = p_member_id and bonus_year = v_year and bonus_month = v_month
  ) into v_claimed;

  return query select (not v_claimed), v_claimed, v_rank, v_bonus, v_year, v_month;
end;
$$;
grant execute on function group_pt_mvp_bonus_status(uuid) to anon;

-- 실제로 "받기 → 트로피 탭"까지 마쳤을 때 호출됨. 지난달 등수를 다시 계산해서 진짜 TOP3가 맞는지,
-- 이미 받아간 적 없는지 재검증한 뒤에만 지급함(같은 화면을 두 번 눌러도 unique 제약으로 중복 지급 안 됨)
create or replace function group_pt_mvp_bonus_claim(p_member_id uuid)
returns table (ok boolean, message text, bonus_points integer, new_total_points integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_month_start date := date_trunc('month', current_date - interval '1 month')::date;
  v_prev_month_end date := date_trunc('month', current_date)::date;
  v_year integer := extract(year from v_prev_month_start)::int;
  v_month integer := extract(month from v_prev_month_start)::int;
  v_rank integer;
  v_bonus integer;
  v_total_points integer;
begin
  if not exists (select 1 from members where id = p_member_id and group_pt_type is not null) then
    return query select false, '회원 정보를 찾을 수 없어요.', 0, 0;
    return;
  end if;

  select r.rnk into v_rank
  from (
    select a.member_id, row_number() over (order by count(*) desc, a.member_id) as rnk
    from group_pt_attendance a
    join members m on m.id = a.member_id and m.group_pt_type is not null
    where a.attendance_date >= v_prev_month_start and a.attendance_date < v_prev_month_end
    group by a.member_id
  ) r
  where r.member_id = p_member_id and r.rnk <= 3;

  if v_rank is null then
    return query select false, '지난달 TOP3 기록이 없어서 보너스를 받을 수 없어요.', 0, 0;
    return;
  end if;

  v_bonus := case v_rank when 1 then 100 when 2 then 70 when 3 then 50 end;

  begin
    insert into group_pt_mvp_bonus_claims (member_id, bonus_year, bonus_month, rank, bonus_points)
    values (p_member_id, v_year, v_month, v_rank, v_bonus);
  exception when unique_violation then
    return query select false, '이미 지난달 보너스를 받으셨어요.', 0, 0;
    return;
  end;

  select coalesce((select count(*) from group_pt_attendance where member_id = p_member_id), 0) * 10
       + coalesce((select sum(bonus_points) from group_pt_mvp_bonus_claims where member_id = p_member_id), 0)
  into v_total_points;

  return query select true, '보너스 포인트가 지급됐어요!', v_bonus, v_total_points;
end;
$$;
grant execute on function group_pt_mvp_bonus_claim(uuid) to anon;

-- 회원 본인 화면의 "포인트"가 MVP 보너스까지 합쳐서 보이도록 group_pt_get_member_status를 갱신함
-- (migration_55에서 만든 걸 여기서 create or replace로 덮어씀 - migration_50이 이전 함수를
-- 덮어썼던 것과 같은 방식). 출석 포인트(10P/회) + 지금까지 받은 MVP 보너스 합계로 계산이 바뀜
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
    coalesce(a.cnt, 0)::int * v_points_per_checkin + coalesce(b.bonus_sum, 0)::int,
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
  left join (
    select member_id, sum(bonus_points) as bonus_sum
    from group_pt_mvp_bonus_claims
    where member_id = p_member_id
    group by member_id
  ) b on true
  where m.id = p_member_id;
end;
$$;
grant execute on function group_pt_get_member_status(uuid) to anon;
