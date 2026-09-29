-- "트레이너 매출 순위" 막대그래프에서 지점장(관리자)은 빼고 트레이너만 보이게 해달라는 요청.
-- migration_48에서 만든 get_pt_trainer_leaderboard()가 profiles.role이 'trainer' 또는 'manager'인
-- 사람을 다 포함하고 있었는데(PT 관리 화면 상단 트레이너 선택 드롭다운이 지점장도 포함하는 것과
-- 같은 기준으로 맞췄던 것), 순위표는 트레이너끼리 경쟁하는 용도라 지점장은 안 보이는 게 맞다는
-- 피드백. dashboard.html "트레이너 성과 지표"(지점장 매출은 원래부터 제외)와도 같은 기준이 됨.
-- 함수 이름/시그니처는 그대로 두고 본문만 고치는 것 -> create or replace로 기존 함수를 덮어씀.
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
    and (
      (l.contact_date >= p_month_start and l.contact_date < p_month_end)
      or (l.ot_date >= p_month_start and l.ot_date < p_month_end)
    )
  where p.role = 'trainer'  -- 지점장은 순위표에서 제외 (2026-09-21)
  group by p.id, p.name, p.role
  order by confirmed_total desc;
$$;

-- grant는 migration_48에서 이미 해뒀지만, 혹시 몰라 한 번 더 확실히 해둠(있어도 오류 안 남)
grant execute on function get_pt_trainer_leaderboard(date, date) to authenticated;
