-- 버그 수정: 그룹PT MVP 보너스 "받기"를 누르면 "column reference "bonus_points" is ambiguous" 오류
--
-- 원인: group_pt_mvp_bonus_status/group_pt_mvp_bonus_claim 두 함수 모두 RETURNS TABLE로
-- bonus_points/bonus_year/bonus_month라는 이름의 "출력 컬럼"을 갖고 있는데, 함수 본문 안에서
-- group_pt_mvp_bonus_claims 테이블의 같은 이름 컬럼(bonus_points/bonus_year/bonus_month)을
-- 테이블 별칭 없이 그냥 "bonus_points"처럼 썼음. PL/pgSQL은 기본 설정상 "이게 방금 말한 출력
-- 컬�럼이야, 테이블 컬럼이야?"가 애매하면 바로 에러를 냄 - 그래서 실제로 "받기"를 눌렀을 때만
-- (해당 줄이 실행될 때만) 오류가 났던 것. 지금까지는 실제 Supabase에 대고 진짜로 "받기"를
-- 실행해본 적이 없어서(테스트는 전부 가짜 응답으로 검증) 이 버그를 못 잡고 있었음 - 이호석
-- 테스트 계정으로 실제로 "받기"를 눌러보다가 처음 발견됨.
--
-- 고침: 문제가 되는 모든 곳에 테이블 별칭(c)을 붙여서 "c.bonus_points"처럼 명확하게 구분되게
-- 바꿈. 이 버그는 테스트 계정뿐 아니라 실제 회원이 진짜로 지난달 TOP3 보너스를 받으려 할 때도
-- 똑같이 발생했을 오류라서, migration_57에서 만든 두 함수를 여기서 완전히 새로 고쳐씀
-- (migration_58에서 추가했던 테스트 계정 전용 분기도 이 안에 그대로 포함되어 있음 - 이 파일
-- 하나만 실행하면 두 함수 모두 최신 상태가 됨).

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
  -- 테스트 계정(이호석, 010-6227-7915) - 실제 순위 계산을 건너뛰고 항상 "1등, 안 받음"으로 응답
  select exists (
    select 1 from members mm
    where mm.id = p_member_id
      and regexp_replace(coalesce(mm.phone, ''), '[^0-9]', '', 'g') = '01062277915'
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

  -- 여기가 버그 지점이었음: bonus_year/bonus_month를 별칭 없이 그대로 써서 출력 컬럼과 헷갈렸음 -> c.bonus_year/c.bonus_month로 고침
  select exists (
    select 1 from group_pt_mvp_bonus_claims c
    where c.member_id = p_member_id and c.bonus_year = v_year and c.bonus_month = v_month
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
    select 1 from members mm
    where mm.id = p_member_id
      and regexp_replace(coalesce(mm.phone, ''), '[^0-9]', '', 'g') = '01062277915'
  ) into v_is_test_account;

  if v_is_test_account then
    -- 테스트 계정: claims 테이블에 기록을 남기지 않아서 몇 번이고 다시 받을 수 있음.
    -- 여기가 버그 지점이었음: sum(bonus_points)를 별칭 없이 써서 출력 컬럼과 헷갈렸음 -> sum(c.bonus_points)로 고침
    select coalesce((select count(*) from group_pt_attendance where member_id = p_member_id), 0) * 10
         + coalesce((select sum(c.bonus_points) from group_pt_mvp_bonus_claims c where c.member_id = p_member_id), 0)
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

  -- 여기가 버그 지점이었음: sum(bonus_points)를 별칭 없이 써서 출력 컬럼과 헷갈렸음 -> sum(c.bonus_points)로 고침
  select coalesce((select count(*) from group_pt_attendance where member_id = p_member_id), 0) * 10
       + coalesce((select sum(c.bonus_points) from group_pt_mvp_bonus_claims c where c.member_id = p_member_id), 0)
  into v_total_points;

  return query select true, '보너스 포인트가 지급됐어요!', v_bonus, v_total_points;
end;
$$;
grant execute on function group_pt_mvp_bonus_claim(uuid) to anon;
