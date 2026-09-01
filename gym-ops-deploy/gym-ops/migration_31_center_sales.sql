-- 센터 매출(center-sales.html) 신설을 위한 변경
-- 1) 매출 항목에 "일일권"/"양도"를 추가 (기존엔 헬스이용권·PT·그룹PT·락커·운동복만 있었는데,
--    지점장님이 쓰시던 엑셀의 "일일권,락커,운동복,양도 정산표"를 그대로 앱에 옮기려면 이 두 항목도 필요함)
-- 2) center_targets: 센터 전체(FC) 월 목표 매출 — PT 목표는 기존 pt_targets(트레이너별)를 그대로 합산해서 쓰지만,
--    FC 목표는 트레이너별로 나뉘어 관리되던 값이 없어서 센터 전체 기준으로 월 1개씩 새로 관리함
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

-- "transfer"가 아니라 "membership_transfer"로 이름 지은 이유: sales.payment_method 컬럼에 이미
-- 결제수단 값으로 'transfer'(계좌이체)를 쓰고 있어서, 매출 항목(category) 쪽에 또 'transfer'를 쓰면
-- 코드에서 헷갈리기 쉬움 (완전히 다른 의미인데 같은 문자열)
alter table sales drop constraint if exists sales_category_check;
alter table sales add constraint sales_category_check
  check (category in ('membership_new','membership_renewal','pt_new','pt_renewal','group_pt_new','group_pt_renewal','locker','clothes','day_pass','membership_transfer'));

create table if not exists center_targets (
  id uuid primary key default gen_random_uuid(),
  month date not null unique,          -- 항상 그 달 1일 (예: 2026-09-01)
  fc_target_amount numeric not null default 0,
  created_at timestamptz default now()
);

alter table center_targets enable row level security;

-- 조회는 로그인한 직원이면 누구나(센터 매출 화면 자체는 지점장 전용이지만, 데이터 조회 자체를 막을 필요는 없음)
-- 등록/수정은 지점장만
create policy "센터목표 조회" on center_targets for select using (auth.uid() is not null);
create policy "센터목표 등록" on center_targets for insert with check (is_manager());
create policy "센터목표 수정" on center_targets for update using (is_manager());
