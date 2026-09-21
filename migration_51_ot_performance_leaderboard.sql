-- OT 관리(ot.html) 화면에 "트레이너별 OT 성과 순위" 섹션을 추가하기 위한 마이그레이션.
-- 목업 이미지로 먼저 방향을 확인받은 뒤(2026-09-21), 지점장은 제외하고 트레이너끼리만
-- 성공률로 순위를 매기기로 확정됨(pt.html의 "트레이너 매출 순위"와 같은 기준).
--
-- pt_leads 테이블은 RLS로 트레이너 본인 것만 보이게 막혀있어서(트레이너가 다른 트레이너의
-- OT 기록을 직접 조회할 수 없음), migration_48/49와 같은 패턴으로 SECURITY DEFINER 함수를 통해
-- "이름 + OT1/OT2 진행·성공·실패·진행중 건수"라는 집계값만 커튼 뒤에서 계산해서 내려줌.
-- (개별 회원 이름/연락처 등 민감한 원본 데이터는 이 함수에서 전혀 내보내지 않음 - 순수 숫자 집계뿐)
--
-- 성공/실패/진행중 판정은 ot.html의 기존 ot_status 값 체계를 그대로 따름:
--   'done'(완료) = 성공, 'missed'(미스) = 실패, 'scheduled'(예정)/'rolled_over'(이월)/null = 진행중
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

create or replace function get_ot_performance_leaderboard(p_month_start date, p_month_end date)
returns table (
  trainer_id uuid,
  trainer_name text,
  trainer_role text,
  ot1_total integer,
  ot1_success integer,
  ot1_fail integer,
  ot1_pending integer,
  ot2_total integer,
  ot2_success integer,
  ot2_fail integer,
  ot2_pending integer
)
language sql
security definer
set search_path = public
as $$
  select
    p.id as trainer_id,
    p.name as trainer_name,
    p.role as trainer_role,
    count(*) filter (
      where l.ot_date >= p_month_start and l.ot_date < p_month_end
    )::int as ot1_total,
    count(*) filter (
      where l.ot_date >= p_month_start and l.ot_date < p_month_end and l.ot_status = 'done'
    )::int as ot1_success,
    count(*) filter (
      where l.ot_date >= p_month_start and l.ot_date < p_month_end and l.ot_status = 'missed'
    )::int as ot1_fail,
    count(*) filter (
      where l.ot_date >= p_month_start and l.ot_date < p_month_end
        and (l.ot_status is null or l.ot_status in ('scheduled', 'rolled_over'))
    )::int as ot1_pending,
    count(*) filter (
      where l.ot2_date >= p_month_start and l.ot2_date < p_month_end
    )::int as ot2_total,
    count(*) filter (
      where l.ot2_date >= p_month_start and l.ot2_date < p_month_end and l.ot2_status = 'done'
    )::int as ot2_success,
    count(*) filter (
      where l.ot2_date >= p_month_start and l.ot2_date < p_month_end and l.ot2_status = 'missed'
    )::int as ot2_fail,
    count(*) filter (
      where l.ot2_date >= p_month_start and l.ot2_date < p_month_end
        and (l.ot2_status is null or l.ot2_status in ('scheduled', 'rolled_over'))
    )::int as ot2_pending
  from profiles p
  left join pt_leads l
    on l.trainer_id = p.id
    and (
      (l.ot_date >= p_month_start and l.ot_date < p_month_end)
      or (l.ot2_date >= p_month_start and l.ot2_date < p_month_end)
    )
  where p.role = 'trainer'  -- 지점장은 순위표에서 제외 (pt.html 매출 순위와 같은 기준)
  group by p.id, p.name, p.role
  order by
    case when (
      count(*) filter (where l.ot_date >= p_month_start and l.ot_date < p_month_end)
      + count(*) filter (where l.ot2_date >= p_month_start and l.ot2_date < p_month_end)
    ) > 0 then
      1.0 * (
        count(*) filter (where l.ot_date >= p_month_start and l.ot_date < p_month_end and l.ot_status = 'done')
        + count(*) filter (where l.ot2_date >= p_month_start and l.ot2_date < p_month_end and l.ot2_status = 'done')
      ) / (
        count(*) filter (where l.ot_date >= p_month_start and l.ot_date < p_month_end)
        + count(*) filter (where l.ot2_date >= p_month_start and l.ot2_date < p_month_end)
      )
    else -1
    end desc;
$$;

grant execute on function get_ot_performance_leaderboard(date, date) to authenticated;
