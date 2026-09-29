-- 그룹PT MVP 보너스 - 테스트 계정(이호석, 010-6227-7915)은 실제 순위와 상관없이
-- 몇 번이고 계속 "보상 받기" 화면을 확인할 수 있게 함.
-- "앞으로 임팩트 연출 같은 걸 계속 테스트해봐야 하니, 한 번만 되는 게 아니라 계속 확인 가능하게
-- 해달라"는 요청으로, migration_57에서 만든 group_pt_mvp_bonus_status/claim 두 함수를
-- 이 특정 전화번호 회원에 한해서만 다르게 동작하도록 덮어씀(create or replace, migration_50과
-- 같은 방식). 그 외 모든 실제 회원에게는 기존 로직(지난달 진짜 TOP3 순위, 한 달에 한 번만
-- 지급, DB 유니크 제약으로 중복 방지)이 그대로 적용되고 전혀 영향 없음.
--
-- 이 테스트 계정에 한해서:
--   1) group_pt_mvp_bonus_status는 실제 지난달 출석 순위를 계산하지 않고 항상
--      "1등(100P), 아직 안 받음" 상태로 돌려줌 -> attend.html 캘린더 화면에 보너스 카드가 항상 뜸.
--   2) group_pt_mvp_bonus_claim은 받기를 눌러도 group_pt_mvp_bonus_claims 테이블에
--      기록을 아예 남기지 않음(그래서 dB 유니크 제약에 안 걸리고 계속 다시 받을 수 있음) -
--      화면에는 "현재 포인트 + 100P"로 코인/카운트업 연출만 보여주고, 실제 누적 포인트에는
--      영향이 없음(다음에 화면을 새로고침하면 원래 포인트로 돌아와 있음 - 그래야 테스트할
--      때마다 항상 같은 출발점에서 연출을 볼 수 있음).
--
-- 참고: 이전에 "8월 출석 21건을 채워서 진짜로 1등을 만드는" 1회성 스크립트를 따로 드렸었는데,
-- 이제는 이 마이그레이션으로 순위 계산 자체를 건너뛰기 때문에 그 데이터는 더 이상 필요 없어요.
-- 그대로 둬도 무방하지만, 깔끔하게 정리하고 싶으시면 그 스크립트 맨 아래 주석 처리된 DELETE
-- 문을 실행해서 지우셔도 돼요.

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
  v_is_test_account boolean;
begin
  -- 테스트 계정(전화번호로 식별) - 실제 순위 계산을 건너뛰고 항상 "1등, 안 받음"으로 응답
  select exists (
    select 1 from members
    where id = p_member_id
      and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = '01062277915'
  ) into v_is_test_account;

  if v_is_test_account then
    return query select true, false, 1, 100, v_year, v_month;
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
  v_is_test_account boolean;
begin
  if not exists (select 1 from members where id = p_member_id and group_pt_type is not null) then
    return query select false, '회원 정보를 찾을 수 없어요.', 0, 0;
    return;
  end if;

  select exists (
    select 1 from members
    where id = p_member_id
      and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = '01062277915'
  ) into v_is_test_account;

  if v_is_test_account then
    -- 테스트 계정: claims 테이블에 기록을 남기지 않아서 몇 번이고 다시 받을 수 있음.
    -- 실제 누적 포인트(출석 포인트 + 진짜로 받은 MVP 보너스 합)는 그대로 두고,
    -- 화면 연출(코인 날아가는 애니메이션)용으로만 "+100P"를 더한 값을 돌려줌.
    select coalesce((select count(*) from group_pt_attendance where member_id = p_member_id), 0) * 10
         + coalesce((select sum(bonus_points) from group_pt_mvp_bonus_claims where member_id = p_member_id), 0)
         + 100
    into v_total_points;

    return query select true, '보너스 포인트가 지급됐어요!', 100, v_total_points;
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
