-- 그룹PT MVP 보너스 포인트를 1등 100P/2등 70P/3등 50P -> 1등 150P/2등 100P/3등 70P로 변경
-- + 테스트 계정(이호석, 010-6227-7915)이 1등뿐 아니라 2등/3등 화면도 미리 볼 수 있게 옵션 추가
--
-- 배경: "1등 150P, 2등 100P, 3등 70P로 배정될거야" + "이호석 쪽에는 2등,3등도 한번 보고싶어서 볼 수
-- 있게끔 만들어줘" 요청.
--
-- 두 함수(group_pt_mvp_bonus_status/group_pt_mvp_bonus_claim) 모두 새 파라미터
-- p_test_rank integer default null 을 추가함 - 실제 회원(테스트 계정이 아닌 회원)한테는 이 값이 전혀
-- 영향을 안 줌(아래 코드에서 v_is_test_account인 경우에만 참조함). attend.html에서는
-- ?testRank=2 / ?testRank=3 URL 파라미터가 있을 때만 이 값을 보내도록 만들어뒀음.
--
-- 주의: Postgres에서는 매개변수 개수가 다르면(uuid) vs (uuid, integer) 서로 "다른 함수"로 취급돼서,
-- create or replace만 하면 예전 1개짜리 함수가 안 지워지고 새 2개짜리 함수랑 같이 남아있게 됨 - 그러면
-- p_member_id만 보내는 호출이 어느 쪽으로 가야 할지 모호해져서 PostgREST가 오류를 낼 수 있음. 그래서
-- migration_59가 만든 예전 1개짜리 시그니처를 먼저 완전히 지우고 나서 새로 만듦(이 파일 하나만
-- 실행하면 두 함수 모두 최신 상태가 됨 - migration_59를 이 파일이 완전히 대체함).
drop function if exists group_pt_mvp_bonus_status(uuid);
drop function if exists group_pt_mvp_bonus_claim(uuid);

create or replace function group_pt_mvp_bonus_status(p_member_id uuid, p_test_rank integer default null)
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
  -- 테스트 계정(이호석, 010-6227-7915) - 실제 순위 계산을 건너뛰고 항상 "안 받음" 상태로 응답.
  -- p_test_rank가 1/2/3 중 하나로 오면 그 순위로, 안 오거나 범위 밖이면 기본값 1등으로 보여줌.
  select exists (
    select 1 from members mm
    where mm.id = p_member_id
      and regexp_replace(coalesce(mm.phone, ''), '[^0-9]', '', 'g') = '01062277915'
  ) into v_is_test_account;

  if v_is_test_account then
    v_rank := case when p_test_rank in (1, 2, 3) then p_test_rank else 1 end;
    v_bonus := case v_rank when 1 then 150 when 2 then 100 when 3 then 70 end;
    return query select true, false, v_rank, v_bonus, v_year, v_month;
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

  v_bonus := case v_rank when 1 then 150 when 2 then 100 when 3 then 70 end;

  select exists (
    select 1 from group_pt_mvp_bonus_claims c
    where c.member_id = p_member_id and c.bonus_year = v_year and c.bonus_month = v_month
  ) into v_claimed;

  return query select (not v_claimed), v_claimed, v_rank, v_bonus, v_year, v_month;
end;
$$;
grant execute on function group_pt_mvp_bonus_status(uuid, integer) to anon;


create or replace function group_pt_mvp_bonus_claim(p_member_id uuid, p_test_rank integer default null)
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
    select 1 from members mm
    where mm.id = p_member_id
      and regexp_replace(coalesce(mm.phone, ''), '[^0-9]', '', 'g') = '01062277915'
  ) into v_is_test_account;

  if v_is_test_account then
    -- 테스트 계정: claims 테이블에 기록을 남기지 않아서 몇 번이고 다시 받을 수 있음.
    -- p_test_rank로 요청한 순위(1/2/3, 기본값 1)에 맞는 포인트를 그때그때 지급함.
    v_rank := case when p_test_rank in (1, 2, 3) then p_test_rank else 1 end;
    v_bonus := case v_rank when 1 then 150 when 2 then 100 when 3 then 70 end;

    select coalesce((select count(*) from group_pt_attendance where member_id = p_member_id), 0) * 10
         + coalesce((select sum(c.bonus_points) from group_pt_mvp_bonus_claims c where c.member_id = p_member_id), 0)
         + v_bonus
    into v_total_points;

    return query select true, '보너스 포인트가 지급됐어요!', v_bonus, v_total_points;
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

  v_bonus := case v_rank when 1 then 150 when 2 then 100 when 3 then 70 end;

  begin
    insert into group_pt_mvp_bonus_claims (member_id, bonus_year, bonus_month, rank, bonus_points)
    values (p_member_id, v_year, v_month, v_rank, v_bonus);
  exception when unique_violation then
    return query select false, '이미 지난달 보너스를 받으셨어요.', 0, 0;
    return;
  end;

  select coalesce((select count(*) from group_pt_attendance where member_id = p_member_id), 0) * 10
       + coalesce((select sum(c.bonus_points) from group_pt_mvp_bonus_claims c where c.member_id = p_member_id), 0)
  into v_total_points;

  return query select true, '보너스 포인트가 지급됐어요!', v_bonus, v_total_points;
end;
$$;
grant execute on function group_pt_mvp_bonus_claim(uuid, integer) to anon;
