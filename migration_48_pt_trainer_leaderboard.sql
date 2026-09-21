-- PT 관리(pt.html) 매출 카드 4개 아래에 "트레이너 매출 순위" 막대그래프 추가.
-- "다른 선생님들도 다 볼 수 있게"가 핵심 요구사항이라, 트레이너 role도 이 함수를 호출할 수 있어야
-- 함 - 그런데 pt_leads의 기존 RLS 정책("PT리드 조회": is_manager() or trainer_id = auth.uid())은
-- 트레이너가 본인 것만 보게 막아놔서, 그대로면 다른 트레이너 매출은 집계조차 할 수 없음.
-- 그래서 report_shares(migration_41)의 get_report_share()와 같은 패턴으로, "개별 상담자 이름 등
-- 민감한 정보는 절대 안 돌려주고, 트레이너별 합계 숫자만" 돌려주는 SECURITY DEFINER 함수를 새로
-- 만들어서 그 함수에 한해서만 RLS를 우회함(트레이너별 pt_leads 원본 행은 여전히 서로 못 봄).
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

create or replace function get_pt_trainer_leaderboard(p_month_start date, p_month_end date)
returns table (
  trainer_id uuid,
  trainer_name text,
  trainer_role text,
  confirmed_total numeric,
  confirmed_count integer,
  ot_total numeric,
  renewal_total numeric,
  trial_total numeric,
  other_total numeric,
  target_amount numeric
)
language sql
security definer
set search_path = public
as $$
  select
    p.id as trainer_id,
    p.name as trainer_name,
    p.role as trainer_role,
    coalesce(sum(l.expected_amount) filter (where l.stage = 'registered'), 0) as confirmed_total,
    count(*) filter (where l.stage = 'registered')::int as confirmed_count,
    coalesce(sum(l.expected_amount) filter (where l.stage = 'registered' and l.source = '오티'), 0) as ot_total,
    coalesce(sum(l.expected_amount) filter (where l.stage = 'registered' and l.source = '재등록'), 0) as renewal_total,
    coalesce(sum(l.expected_amount) filter (where l.stage = 'registered' and l.source = '무료체험'), 0) as trial_total,
    coalesce(sum(l.expected_amount) filter (
      where l.stage = 'registered' and (l.source is null or l.source not in ('오티', '재등록', '무료체험'))
    ), 0) as other_total,
    coalesce((
      select t.target_amount from pt_targets t
      where t.trainer_id = p.id and t.period_type = 'monthly' and t.period_start = p_month_start
    ), 0) as target_amount
  from profiles p
  left join pt_leads l
    on l.trainer_id = p.id
    -- pt.html의 isLeadInMonth()와 동일한 기준: 상담일 또는 OT일 둘 중 하나라도 이번 달에 걸치면 포함
    and (
      (l.contact_date >= p_month_start and l.contact_date < p_month_end)
      or (l.ot_date >= p_month_start and l.ot_date < p_month_end)
    )
  where p.role in ('trainer', 'manager')
  group by p.id, p.name, p.role
  order by confirmed_total desc;
$$;

-- 트레이너 본인 role이어도 호출 가능해야 순위표가 뜨므로 authenticated 전체에 권한을 줌.
-- (anon에는 안 줌 - 로그인 안 한 사람은 여전히 아무것도 못 봄)
grant execute on function get_pt_trainer_leaderboard(date, date) to authenticated;
