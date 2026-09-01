-- PT 관리 기능 추가
-- 1) pt_leads: PT 상담/OT/등록전환 파이프라인 (엑셀로 관리하던 "주간 PT 시트"를 앱으로 옮긴 것)
-- 2) pt_targets: 트레이너별 주간/월간 매출 목표
-- 3) members: PT 잔여횟수 적은 회원 케어용 메모 필드 추가
-- Supabase SQL Editor에서 새 쿼리로 전체 실행해주세요

-- 1) PT 리드(상담/OT) 관리
create table pt_leads (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid references profiles(id) not null,   -- 담당 트레이너
  name text not null,                                 -- 상담자/잠재회원 이름
  phone text,
  source text,                                        -- 유입경로: 워크인, 지인소개, SNS 등 자유입력
  contact_date date default current_date,              -- 최초 상담일
  ot_date date,                                        -- OT(체험) 예정/진행일
  expected_amount numeric,                             -- 예상 매출(등록시 예상 결제금액)
  probability numeric,                                 -- 성사 확률(%), 0~100
  -- in_progress: 상담중, ot_scheduled: OT예정, ot_done: OT완료(등록 대기),
  -- registered: 등록완료, rolled_over: 다음주로 이월, missed: 미스(연락두절/불발)
  stage text not null default 'in_progress' check (stage in ('in_progress','ot_scheduled','ot_done','registered','rolled_over','missed')),
  memo text,
  converted_member_id uuid references members(id),     -- 등록전환 시 연결된 회원
  converted_sale_id uuid references sales(id),          -- 등록전환 시 연결된 매출 기록
  created_at timestamptz default now()
);

-- 2) 트레이너별 매출 목표 (주간/월간)
create table pt_targets (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid references profiles(id) not null,
  period_type text not null check (period_type in ('weekly','monthly')),
  period_start date not null,                           -- 주간이면 그 주의 월요일, 월간이면 해당 월 1일
  target_amount numeric not null,
  created_at timestamptz default now(),
  unique (trainer_id, period_type, period_start)
);

-- 3) PT 잔여횟수 적은 회원 케어 메모 (members 테이블에 컬럼 추가)
alter table members add column if not exists pt_session_focus text;              -- 현재 세션에서 집중하는 부분
alter table members add column if not exists pt_short_term_plan text;            -- 단기 목표/계획
alter table members add column if not exists pt_long_term_plan text;             -- 장기 목표/계획
alter table members add column if not exists pt_expected_renewal_month text;     -- 재등록 예상 시기 (예: '2026-09')
alter table members add column if not exists pt_expected_amount numeric;         -- 재등록 예상 금액
alter table members add column if not exists pt_expected_probability numeric;    -- 재등록 예상 확률(%)

-- ============================================
-- 권한 설정 (RLS)
-- ============================================
alter table pt_leads enable row level security;
alter table pt_targets enable row level security;

-- pt_leads: 지점장은 전체, 트레이너는 본인 담당만
create policy "PT리드 조회" on pt_leads for select using (is_manager() or trainer_id = auth.uid());
create policy "PT리드 등록" on pt_leads for insert with check (is_manager() or trainer_id = auth.uid());
create policy "PT리드 수정" on pt_leads for update using (is_manager() or trainer_id = auth.uid());
create policy "PT리드 삭제" on pt_leads for delete using (is_manager() or trainer_id = auth.uid());

-- pt_targets: 지점장은 전체 조회/설정 가능, 트레이너는 본인 목표만 조회 (설정은 지점장만)
create policy "PT목표 조회" on pt_targets for select using (is_manager() or trainer_id = auth.uid());
create policy "PT목표 등록" on pt_targets for insert with check (is_manager());
create policy "PT목표 수정" on pt_targets for update using (is_manager());
create policy "PT목표 삭제" on pt_targets for delete using (is_manager());
