-- PT 회원 관리 표를 "잔여횟수 적은 실제 회원 자동 표시" 방식에서
-- 매달 트레이너가 직접 입력해서 월별로 쌓아가는 기록표 방식으로 바꾸기 위해 신설
-- (기존처럼 회원을 검색해서 고르는 게 아니라, 주차별 매출 기록처럼 그 자리에서 바로 입력)
-- 8월에 쌓은 기록은 그대로 남고, 9월로 넘어가면 9월에 새로 입력한 기록만 보임 - 데이터가 월별로 쌓임
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

create table pt_care_logs (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid references profiles(id) not null,
  member_id uuid references members(id),          -- 나중에 실제 회원과 연결(잔여횟수 자동 연동 등)할 때 쓰려고 남겨둠. 지금은 비워둬도 됨
  period_month text not null,                      -- 이 기록이 속한 달, 'YYYY-MM' 형식
  name text not null,
  pt_remaining_sessions int,
  pt_session_focus text,
  pt_short_term_plan text check (pt_short_term_plan in ('O','X')) default 'X',
  pt_long_term_plan text,
  pt_expected_renewal_month text,                  -- 'YYYY-MM' 형식
  pt_expected_sessions int,
  pt_expected_amount numeric,
  pt_expected_probability numeric,
  created_at timestamptz default now()
);

alter table pt_care_logs enable row level security;

create policy "PT케어기록 조회" on pt_care_logs for select using (is_manager() or trainer_id = auth.uid());
create policy "PT케어기록 등록" on pt_care_logs for insert with check (is_manager() or trainer_id = auth.uid());
create policy "PT케어기록 수정" on pt_care_logs for update using (is_manager() or trainer_id = auth.uid());
create policy "PT케어기록 삭제" on pt_care_logs for delete using (is_manager() or trainer_id = auth.uid());
