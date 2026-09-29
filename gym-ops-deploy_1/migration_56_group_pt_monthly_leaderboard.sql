-- 그룹PT "이달의 출석왕" - 회원님 휴대폰(attend.html)에서 이번 달 출석 횟수 1/2/3등을 보여주기 위한 함수.
-- 새 테이블은 필요 없음(이미 있는 group_pt_attendance 기록을 이번 달 범위로 세어서 순위만 매김).
-- attend.html은 로그인 없는 화면이라 이 함수도 group_pt_search_members 등과 같은 패턴으로
-- SECURITY DEFINER + anon 권한을 씀. 다만 정보 노출을 최소화하기 위해 "TOP 3"와
-- "호출한 본인 회원(p_member_id)"의 순위만 돌려주고, 그 외 회원의 순위/이름은 절대 안 돌려줌.
create or replace function group_pt_monthly_leaderboard(p_member_id uuid default null)
returns table (
  rank integer,
  member_id uuid,
  display_name text,
  phone_hint text,
  attendance_count integer,
  is_requester boolean
)
language sql
security definer
set search_path = public
as $$
  with monthly as (
    select a.member_id, count(*) as cnt
    from group_pt_attendance a
    join members m on m.id = a.member_id and m.group_pt_type is not null
    where a.attendance_date >= date_trunc('month', current_date)::date
      and a.attendance_date < (date_trunc('month', current_date) + interval '1 month')::date
    group by a.member_id
  ),
  ranked as (
    select
      row_number() over (order by monthly.cnt desc, monthly.member_id) as rnk,
      monthly.member_id,
      m.name as display_name,
      case when m.phone is not null and length(regexp_replace(m.phone, '[^0-9]', '', 'g')) >= 4
        then right(regexp_replace(m.phone, '[^0-9]', '', 'g'), 4)
        else null end as phone_hint,
      monthly.cnt as attendance_count
    from monthly
    join members m on m.id = monthly.member_id
  )
  select
    ranked.rnk::int,
    ranked.member_id,
    ranked.display_name,
    ranked.phone_hint,
    ranked.attendance_count::int,
    (ranked.member_id = p_member_id)
  from ranked
  where ranked.rnk <= 3 or ranked.member_id = p_member_id
  order by ranked.rnk;
$$;
grant execute on function group_pt_monthly_leaderboard(uuid) to anon;
