-- PT 관리(pt.html)의 "트레이너 매출 순위" 막대를 눌렀을 때 뜨는 상세 모달을, 대시보드(dashboard.html)의
-- "트레이너 성과 지표" 상세 모달(목표/달성률, 경로별 매출, 핵심 인사이트, 최근 6개월 추이, 경로별 월별
-- 매출, 이번 달 매출 내역)과 완전히 같은 모습으로 만들어달라는 요청.
--
-- 문제는 그 대시보드 모달이 sales 테이블(RLS: is_manager() or staff_id=auth.uid())을 그대로 조회해서
-- 만드는 화면이라, 트레이너 로그인 상태로 다른 트레이너 걸 열면 사실상 아무 데이터도 안 보였던(권한에
-- 막혀 0건으로 나오던) 화면이었음. 이번엔 "다른 선생님들도 사진과 완전히 동일하게 다 볼 수 있어야 한다"는
-- 확인을 받았으므로, migration_48의 get_pt_trainer_leaderboard()와 같은 패턴으로 - 회원 이름·결제수단까지
-- 포함한 개별 매출 내역을 다른 트레이너도 조회할 수 있게 RLS를 의도적으로 우회하는 함수 3개를 추가함.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

-- 1) 특정 트레이너의 PT매출(pt_new/pt_renewal) 원본 내역 + "유형(경로)" 매칭까지 서버에서 미리 계산해서
-- 반환. dashboard.html의 findMatchingLeadForSale()/sourceForSale()과 완전히 같은 매칭 로직(1순위:
-- converted_sale_id로 정확히 연결된 리드, 2순위: 같은 트레이너+같은 이름+같은 달에 "등록"된 리드) -
-- 매칭되는 리드가 없으면 '미분류'.
create or replace function get_pt_trainer_sales_rows(p_trainer_id uuid, p_range_start date, p_range_end date)
returns table (
  sale_id uuid,
  sale_date date,
  member_name text,
  category text,
  payment_method text,
  amount numeric,
  memo text,
  source text
)
language sql
security definer
set search_path = public
as $$
  select
    s.id as sale_id,
    s.sale_date,
    coalesce(m.name, '-') as member_name,
    s.category,
    s.payment_method,
    s.amount,
    s.memo,
    coalesce(
      (select l.source from pt_leads l where l.converted_sale_id = s.id limit 1),
      (select l.source from pt_leads l
        where l.stage = 'registered' and l.trainer_id = s.staff_id and l.name = m.name
          and (
            (l.contact_date is not null and date_trunc('month', l.contact_date) = date_trunc('month', s.sale_date))
            or (l.ot_date is not null and date_trunc('month', l.ot_date) = date_trunc('month', s.sale_date))
          )
        limit 1),
      '미분류'
    ) as source
  from sales s
  left join members m on m.id = s.member_id
  where s.staff_id = p_trainer_id
    and s.category in ('pt_new', 'pt_renewal')
    and s.sale_date >= p_range_start and s.sale_date < p_range_end
  order by s.sale_date asc;
$$;
grant execute on function get_pt_trainer_sales_rows(uuid, date, date) to authenticated;

-- 2) 특정 트레이너의 월별 목표 전체(pt_targets) - "목표/달성률" 박스와 6개월 추이의 달성률 계산에 필요.
create or replace function get_pt_trainer_targets(p_trainer_id uuid)
returns table (period_type text, period_start date, target_amount numeric)
language sql
security definer
set search_path = public
as $$
  select period_type, period_start, target_amount
  from pt_targets
  where trainer_id = p_trainer_id;
$$;
grant execute on function get_pt_trainer_targets(uuid) to authenticated;

-- 3) "핵심 인사이트"의 "우리 센터 트레이너 N명 중 K위" 계산용 - 딱 dashboard.html의 computeStaffPerf()와
-- 같은 기준(개인PT 신규/재등록만, 지점장 매출은 제외, 매출이 0건인 트레이너도 목록에 포함)으로 이번 달
-- 전체 트레이너 PT매출 합계를 구함.
create or replace function get_pt_trainer_month_rank(p_month_start date, p_month_end date)
returns table (trainer_id uuid, trainer_name text, pt_amount numeric, pt_count integer)
language sql
security definer
set search_path = public
as $$
  select
    p.id as trainer_id,
    p.name as trainer_name,
    coalesce(sum(s.amount) filter (where s.category in ('pt_new', 'pt_renewal')), 0) as pt_amount,
    count(*) filter (where s.category in ('pt_new', 'pt_renewal'))::int as pt_count
  from profiles p
  left join sales s on s.staff_id = p.id and s.sale_date >= p_month_start and s.sale_date < p_month_end
  where p.role = 'trainer'
  group by p.id, p.name
  order by pt_amount desc;
$$;
grant execute on function get_pt_trainer_month_rank(date, date) to authenticated;
